import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vite-plus/test";
import { crewRaffleResponse, type CrewRaffleRow } from "~/lib/crew-raffle";

const token = "a".repeat(43);
const config = { tokenSha256: createHash("sha256").update(token).digest("hex"), expiresAt: "2026-09-20T10:00:00Z" };
const now = () => Date.parse("2026-09-19T12:00:00Z");
const row: CrewRaffleRow = { accountId: "account1", name: "Example Player", email: "player@example.test", username: "player", publicHandle: "Agent ABC", role: "user", xp: 20, achievements: 1 };
const request = (key = token, method = "GET", path = "/api/crew-raffle") => new Request(`https://wts.test${path}`, { method, headers: key ? { Authorization: `Bearer ${key}` } : {} });

describe("crew share HTTP contract", () => {
  it("requires the exact capability before touching storage", async () => {
    const load = vi.fn(async () => [row]);
    for (const key of ["", "b".repeat(43), token + "x", "short"]) {
      const response = await crewRaffleResponse(request(key), load, config, now);
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
    expect(load).not.toHaveBeenCalled();
  });

  it("rejects query-only credentials and cookies", async () => {
    const load = vi.fn(async () => [row]);
    const response = await crewRaffleResponse(new Request(`https://wts.test/api/crew-raffle?key=${token}`, { headers: { cookie: `token=${token}` } }), load, config, now);
    expect(response.status).toBe(404); expect(load).not.toHaveBeenCalled();
  });

  it("fails closed with absent, invalid or expired configuration", async () => {
    const load = vi.fn(async () => [row]);
    for (const value of [{}, { ...config, tokenSha256: "bad" }, { ...config, expiresAt: "not-a-date" }, { ...config, expiresAt: new Date(now()).toISOString() }]) {
      expect((await crewRaffleResponse(request(), load, value, now)).status).toBe(404);
    }
    expect(load).not.toHaveBeenCalled();
  });

  it("allowlists positive-scoring accounts, retains admins/opt-outs and orders ties deterministically", async () => {
    const response = await crewRaffleResponse(request(), async () => [
      { ...row, accountId: "z", secret: "must not leak" },
      { ...row, accountId: "a", name: "", role: "admin" },
      { ...row, accountId: "leader", xp: 40 },
      { ...row, accountId: "zero", xp: 0 },
    ], config, now);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(3);
    expect(body.rows.map((r: CrewRaffleRow) => r.accountId)).toEqual(["leader", "a", "z"]);
    expect(body.rows[1].name).toBe(""); expect(body.rows[1].role).toBe("admin");
    expect(JSON.stringify(body)).not.toContain("must not leak");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("checks expiry again after storage and sanitizes failures", async () => {
    let clock = now();
    const expired = await crewRaffleResponse(request(), async () => { clock = Date.parse(config.expiresAt); return [row]; }, config, () => clock);
    expect(expired.status).toBe(404);
    const failed = await crewRaffleResponse(request(), async () => { throw new Error("private upstream secret"); }, config, now);
    expect(failed.status).toBe(503); expect(await failed.text()).not.toContain("secret");
    const duplicate = await crewRaffleResponse(request(), async () => [row, row], config, now);
    expect(duplicate.status).toBe(503);
  });

  it("serves an identity-free isolated shell and rejects writes", async () => {
    const load = vi.fn(async () => [row]);
    const shell = await crewRaffleResponse(request("", "GET", "/crew-raffle"), load, config, now);
    const html = await shell.text();
    expect(shell.status).toBe(200); expect(html).toContain("Raffle leaderboard");
    expect(html).not.toContain(row.email); expect(html).not.toContain("umami");
    expect(shell.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect((await crewRaffleResponse(request(token, "POST"), load, config, now)).status).toBe(405);
    const head = await crewRaffleResponse(request(token, "HEAD"), load, config, now);
    expect(await head.text()).toBe(""); expect(load).not.toHaveBeenCalled();
  });
});
