import { describe, expect, it, vi } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { handleRegistrations } from "./registrations-http";
import { readRegistrations } from "./registrations-source";
import { isCheckinPath } from "./checkin-privacy";
const request = () => new Request("https://wts.test/api/registrations", { method: "POST", headers: { origin: "https://wts.test" } });
const empty = { refreshedAt: "2026-09-12T10:00:00.000Z", registrations: [] };
const operator = { id: "synthetic-operator", role: "checkin_operator" };
// Entirely synthetic IDs, token and attendee identities. Never production data.
const token = `e30.${Buffer.from(JSON.stringify({ account_id: 999 })).toString("base64url")}.fake`;
const config = { apiUrl: "https://upstream.test/api", apiKey: token, accountId: "999" };
function page(current: number, product = 15) {
 const endpoint = "https://upstream.test/events/5/attendees";
 const link = (n: number) => `${endpoint}?page=${n}`;
 return { data: [{ id: 90000 + current, event_id: 5, product_id: product, first_name: "Synthetic", last_name: "Person", email: "fixture@example.invalid", status: "ACTIVE", short_id: "never-expose", check_ins: [{ short_id: "never-expose" }] }], meta: { current_page: current, last_page: 2, total: 2, per_page: 1, from: current, to: current, path: endpoint }, links: { first: link(1), last: link(2), prev: current === 1 ? null : link(1), next: current === 2 ? null : link(2) } };
}
describe("private registrations", () => {
 it.each(["user", "reviewer"])("denies %s without reading upstream", async role => {
  const read = vi.fn(); const result = await handleRegistrations(request(), { authenticate: async () => ({ id: "fixture", role }), read });
  expect(result.status).toBe(403); expect(read).not.toHaveBeenCalled();
 });
 it("denies missing authentication and cross-site requests", async () => {
  const read = vi.fn(); const authenticate = vi.fn(async () => { throw new Error(); });
  expect((await handleRegistrations(request(), { authenticate, read })).status).toBe(403);
  expect((await handleRegistrations(new Request("https://wts.test/api/registrations", { method: "POST", headers: { origin: "https://foreign.test" } }), { authenticate, read })).status).toBe(403);
  expect(read).not.toHaveBeenCalled();
 });
 it.each(["admin", "checkin_operator"])("allows %s with no station and revalidates", async role => {
  const authenticate = vi.fn(async () => ({ ...operator, role }));
  const result = await handleRegistrations(request(), { authenticate, read: async () => empty });
  expect(result.status).toBe(200); expect(authenticate).toHaveBeenCalledTimes(2);
  expect(result.headers.get("cache-control")).toBe("private, no-store");
  expect(result.headers.get("content-security-policy")).toContain("connect-src 'self'");
 });
 it("redacts if authority changes during upstream read", async () => {
  const authenticate = vi.fn().mockResolvedValueOnce(operator).mockResolvedValueOnce({ ...operator, role: "user" });
  const result = await handleRegistrations(request(), { authenticate, read: async () => empty });
  expect(result.status).toBe(403); expect(await result.text()).not.toContain("registrations");
 });
 it("withholds a populated roster until post-await authority is verified", async () => {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let actor = operator;
  const authenticate = vi.fn(async () => actor);
  const pending = handleRegistrations(request(), { authenticate, read: async () => {
   await waiting;
   return { ...empty, registrations: [{ id: "90001", programmeId: "15", name: "Synthetic Private", email: "redact@example.invalid", ticketStatus: "ACTIVE" }] };
  } });
  await vi.waitFor(() => expect(authenticate).toHaveBeenCalledTimes(1));
  actor = { ...operator, id: "different-operator" };
  release();
  const result = await pending;
  expect(result.status).toBe(403);
  expect(await result.text()).not.toMatch(/Synthetic Private|redact@example.invalid|90001/);
 });
 it("rejects malformed DTOs without leaking upstream fields", async () => {
  const read = async () => ({ ...empty, secret: "never-expose" });
  const result = await handleRegistrations(request(), { authenticate: async () => operator, read });
  expect(result.status).toBe(503);
  expect(await result.text()).not.toContain("never-expose");
 });
 it("distinguishes failure from empty", async () => {
  const result = await handleRegistrations(request(), { authenticate: async () => operator, read: async () => { throw new Error("private upstream detail"); } });
  expect(result.status).toBe(503); expect(await result.text()).not.toContain("private upstream detail");
 });
 it("reads every page using GET and emits only configured product DTOs", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(page(1))).mockResolvedValueOnce(Response.json(page(2, 999)));
  const result = await readRegistrations(config, fetcher);
  expect(fetcher).toHaveBeenCalledTimes(2); expect(fetcher.mock.calls.every(c => c[1].method === "GET")).toBe(true);
  expect(fetcher.mock.calls.every(c => c[0].endsWith("&sort_by=id&sort_direction=asc"))).toBe(true);
  expect(result.registrations).toHaveLength(1); expect(JSON.stringify(result)).not.toMatch(/short_id|never-expose|check_ins|arrival/);
 });
 it("rejects duplicate identities and incomplete pagination instead of partial roster", async () => {
  const second = page(2); second.data[0].id = 90001;
  await expect(readRegistrations(config, vi.fn().mockResolvedValueOnce(Response.json(page(1))).mockResolvedValueOnce(Response.json(second)))).rejects.toThrow();
  await expect(readRegistrations(config, vi.fn().mockResolvedValueOnce(Response.json(page(1))).mockResolvedValueOnce(Response.json({}, { status: 403 })))).rejects.toThrow();
 });
 it("rejects foreign events, oversized rosters and malformed included attendee data", async () => {
  const foreign = page(1); foreign.data[0].event_id = 6;
  const oversized = page(1); oversized.meta.total = 1001;
  const malformed = page(1); malformed.data[0].email = "x".repeat(501);
  for (const response of [foreign, oversized, malformed]) {
   await expect(readRegistrations(config, vi.fn().mockResolvedValue(Response.json(response)))).rejects.toThrow();
  }
 });
 it.each(["/registrations", "/REGISTRATIONS/", "/%72egistrations///", "/api/REGISTRATIONS/"])("protects route variant %s", path => expect(isCheckinPath(path)).toBe(true));
 it("uses native role-gated entry links", () => {
  const source = readFileSync(new URL("../components/Navbar.tsx", import.meta.url), "utf8");
  expect(source.match(/href="\/registrations" target="_self"/g)).toHaveLength(2);
  expect(source.match(/<Show when=\{canCheckin\(\)\}>\s*<li><a href="\/registrations"/g)).toHaveLength(2);
 });
});
