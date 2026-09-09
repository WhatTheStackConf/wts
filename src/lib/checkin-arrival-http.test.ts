import { describe, expect, it, vi } from "vite-plus/test";
import { handleCheckinArrivalRequest } from "~/lib/checkin-arrival-http";
import type { CheckinArrivalServiceContract } from "~/lib/checkin-arrival-contract";
import { isCheckinPath } from "~/lib/checkin-privacy";

const origin = "https://wts.example.test";
function request(body: object, cookie = `wts_checkin_client=${"a".repeat(64)}`) {
  return new Request(`${origin}/api/checkin-arrivals`, { method: "POST", headers: { origin, "content-type": "application/json", cookie }, body: JSON.stringify(body) });
}
function dependencies(role = "checkin_operator") {
  const target = {
    preflight: vi.fn().mockResolvedValue({ state: "already_handled", operationId: "11111111-1111-4111-8111-111111111111", replayed: false, operationsEnabled: false }),
    history: vi.fn().mockResolvedValue({ items: [], nextCursor: null, day: "2026-09-19", operationsEnabled: false }),
  } satisfies CheckinArrivalServiceContract;
  return { target, authenticate: vi.fn().mockResolvedValue({ id: "human", role }), service: vi.fn().mockResolvedValue(target) };
}

const command = { operationId: "11111111-1111-4111-8111-111111111111", qrIdentity: "A-TEST001", affiliationChoice: "fetch", context: { protocolVersion: 1, edition: "WTS2026", eventId: "aaaaaaaaaaaaaaa", eventGeneration: 1, bindingId: "bbbbbbbbbbbbbbb", bindingVersion: 1, selectionVersion: 1, stationId: "wts2026station1", stationGeneration: 1, systemGeneration: 1 } };

describe("arrival HTTP boundary", () => {
  it("passes only validated exact preflight input to the authenticated service", async () => {
    const deps = dependencies();
    const result = await handleCheckinArrivalRequest(request({ operation: "preflight", command }), deps);
    expect(result.status).toBe(200);
    expect(deps.target.preflight).toHaveBeenCalledWith("a".repeat(64), command);
  });
  it("authenticates station work reads and keeps the binding in server-only cookies", async () => {
    const deps = dependencies();
    const result = await handleCheckinArrivalRequest(request({ operation: "history", query: { scope: "station", limit: 20 } }), deps);
    expect(result.status).toBe(200);
    expect(deps.authenticate).toHaveBeenCalledOnce();
    expect(deps.target.history).toHaveBeenCalledWith("a".repeat(64), { scope: "station", limit: 20 });
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.headers.get("referrer-policy")).toBe("no-referrer");
    expect(result.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(await result.text()).not.toContain("a".repeat(64));
    expect(isCheckinPath("/api/checkin-arrivals")).toBe(true);
  });
});
