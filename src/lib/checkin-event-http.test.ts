import { describe, expect, it, vi } from "vite-plus/test";
import { handleCheckinEventRequest } from "~/lib/checkin-event-http";
import type { CheckinEventServiceContract } from "~/lib/checkin-event-contract";
import { isCheckinPath } from "~/lib/checkin-privacy";

function request(body: object, roleCookie = "wts_checkin_client=" + "a".repeat(64), origin = "https://wts.example.test") {
  return new Request("https://wts.example.test/api/checkin-events", { method: "POST", headers: { origin, "content-type": "application/json", cookie: roleCookie }, body: JSON.stringify(body) });
}
function dependencies(role = "checkin_operator") {
  const target = {
    catalogue: vi.fn().mockResolvedValue({ state: "complete", events: [], selected: null, context: null, operationsEnabled: false }),
    select: vi.fn().mockResolvedValue({ state: "complete", context: null, operationsEnabled: false }),
    adminCatalogue: vi.fn().mockResolvedValue({ state: "complete", events: [] }),
    adminOptions: vi.fn().mockResolvedValue({ state: "complete", lists: [], questions: [], products: [] }),
    configure: vi.fn().mockResolvedValue({ replayed: false }),
  } satisfies CheckinEventServiceContract;
  return { target, authenticate: vi.fn().mockResolvedValue({ id: "human", role }), service: vi.fn().mockResolvedValue(target) };
}

describe("event command HTTP boundary", () => {
  it("authenticates each catalogue, keeps cookies server-side and protects response privacy", async () => {
    const deps = dependencies();
    const response = await handleCheckinEventRequest(request({ operation: "catalogue" }), deps);
    expect(response.status).toBe(200);
    expect(deps.authenticate).toHaveBeenCalledOnce();
    expect(deps.target.catalogue).toHaveBeenCalledWith("a".repeat(64));
    expect(await response.text()).not.toContain("a".repeat(64));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(isCheckinPath("/api/checkin-events")).toBe(true);
  });
  it.each(["admin_catalogue", "admin_options", "configure"])("denies operator %s before privileged source access", async (operation) => {
    const deps = dependencies();
    const response = await handleCheckinEventRequest(request({ operation, upstreamEventId: "101" }), deps);
    expect(response.status).toBe(403);
    expect(deps.service).not.toHaveBeenCalled();
  });
  it("rejects foreign origins, duplicate identities, malformed IDs and unfinished operations", async () => {
    const deps = dependencies("admin");
    for (const input of [
      request({ operation: "catalogue" }, "", "https://foreign.test"),
      request({ operation: "catalogue" }, "wts_checkin_client=bad"),
      request({ operation: "catalogue" }, `wts_checkin_client=${"a".repeat(64)}; wts_checkin_client=${"b".repeat(64)}`),
      request({ operation: "admin_options", upstreamEventId: " 101" }),
      request({ operation: "admin_options", upstreamEventId: "01" }),
      request({ operation: "context" }), request({ operation: "scan" }),
      request({ operation: "catalogue", bindingToken: "a".repeat(64) }),
    ]) expect((await handleCheckinEventRequest(input, deps)).status).toBeGreaterThanOrEqual(400);
    expect(deps.service).not.toHaveBeenCalled();
  });
  it("bounds streamed bodies and sanitizes diagnostics", async () => {
    const deps = dependencies();
    const large = request({ operation: "catalogue", padding: "x".repeat(9000) });
    expect((await handleCheckinEventRequest(large, deps)).status).toBe(413);
    expect(deps.service).not.toHaveBeenCalled();
    deps.target.catalogue.mockRejectedValueOnce(new Error("Bearer private-server-token person@example.test"));
    const failed = await handleCheckinEventRequest(request({ operation: "catalogue" }), deps);
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toMatch(/Bearer|private-server-token|person@/);
    deps.authenticate.mockResolvedValueOnce({ id: "human", role: "reviewer" });
    expect((await handleCheckinEventRequest(request({ operation: "catalogue" }), deps)).status).toBe(403);
  });
});
