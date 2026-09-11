import { expect, it, vi } from "vite-plus/test";
import { handleCheckinLifecycleRequest } from "./checkin-lifecycle-http";
import type { LifecycleStatus } from "./checkin-lifecycle-contract";

const openStatus: LifecycleStatus = { edition: "WTS2026", closedAt: null, purgeDeadline: null, centralDeletedAt: null, centralCompactedAt: null, totals: null, restoreRequired: false, restoreGeneration: 0, reconciledAt: null, approvedAt: null, devices: [] };
const request = (body: unknown, headers: Record<string, string> = {}) => new Request("https://wts.test/api/checkin-lifecycle", { method: "POST", headers: { origin: "https://wts.test", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
function fixture(role = "admin") {
  const service = { status: vi.fn().mockResolvedValue(openStatus), close: vi.fn(), approveRestore: vi.fn() };
  const deps = { authenticate: vi.fn().mockResolvedValue({ id: "admin-user", role }), service: vi.fn().mockResolvedValue(service) };
  return { service, deps };
}
it("denies operator truth access and cross-origin requests before opening the service", async () => {
  for (const operation of ["status", "close", "approve_restore"]) {
    const { deps } = fixture("checkin_operator");
    expect((await handleCheckinLifecycleRequest(request({ operation }), deps)).status).toBe(403);
    expect(deps.service).not.toHaveBeenCalled();
  }
  const { deps } = fixture();
  expect((await handleCheckinLifecycleRequest(request({ operation: "status" }, { origin: "https://foreign.test" }), deps)).status).toBe(403);
  expect(deps.authenticate).not.toHaveBeenCalled();
});
it("rejects missing sessions, forged identities, non-POST and missing-origin requests", async () => {
  const { deps } = fixture();
  deps.authenticate.mockRejectedValueOnce(new Error("secret diagnostics"));
  const denied = await handleCheckinLifecycleRequest(request({ operation: "status" }), deps);
  expect(denied.status).toBe(403); expect(await denied.text()).not.toContain("secret");
  for (const headers of [{ origin: "", "sec-fetch-site": "same-origin" }, { origin: "https://wts.test", "sec-fetch-site": "cross-site" }]) expect((await handleCheckinLifecycleRequest(request({ operation: "status" }, headers), deps)).status).toBe(403);
  expect((await handleCheckinLifecycleRequest(new Request("https://wts.test/api/checkin-lifecycle", { headers: { origin: "https://wts.test" } }), deps)).status).toBe(403);
  expect((await handleCheckinLifecycleRequest(request({ operation: "status", actorUserId: "admin" }), deps)).status).toBe(400);
  expect(deps.service).not.toHaveBeenCalled();
});
it("rejects strict-schema violations and bounded-body overflow before side effects", async () => {
  const { deps } = fixture();
  for (const body of [
    { operation: "close", command: { operationId: "a".repeat(36), confirmEdition: "WTS2026" } },
    { operation: "close", command: { operationId: crypto.randomUUID(), confirmEdition: "WTS2027" } },
    { operation: "close", command: { operationId: crypto.randomUUID(), confirmEdition: "WTS2026", extendDeadline: true } },
    { operation: "approve_restore", command: { generation: -1, confirmEdition: "WTS2026" } },
    { operation: "approve_restore", command: { generation: 1.5, confirmEdition: "WTS2026" } },
    { operation: "purge" }, { operation: "reopen" }, { operation: "status", stationId: "foreign" },
  ]) expect((await handleCheckinLifecycleRequest(request(body), deps)).status).toBe(400);
  expect((await handleCheckinLifecycleRequest(request({ extra: "x".repeat(4096) }), deps)).status).toBe(413);
  expect((await handleCheckinLifecycleRequest(request({ operation: "status" }, { "content-type": "application/json-malicious" }), deps)).status).toBe(415);
  expect(deps.service).not.toHaveBeenCalled();
});
it("validates service responses before exposing any fields and sanitizes backend failures", async () => {
  const { deps, service } = fixture();
  for (const value of [{ ...openStatus, attendeeEmail: "private@example.test" }, { ...openStatus, edition: "WTS2027" }, { ...openStatus, centralCompactedAt: "2026-10-20T00:00:00Z" }]) {
    service.status.mockResolvedValueOnce(value);
    const result = await handleCheckinLifecycleRequest(request({ operation: "status" }), deps);
    expect(result.status).toBe(503); expect(await result.text()).not.toContain("private@example.test");
  }
  service.status.mockRejectedValueOnce(new Error("password=secret attendee@example.test"));
  const result = await handleCheckinLifecycleRequest(request({ operation: "status" }), deps);
  expect(result.status).toBe(503); expect(await result.text()).not.toMatch(/password|attendee@/);
});
it("forwards only the exact close command and requires confirmed closure", async () => {
  const { deps, service } = fixture();
  const command = { operationId: crypto.randomUUID(), confirmEdition: "WTS2026" };
  service.close.mockResolvedValueOnce(openStatus);
  expect((await handleCheckinLifecycleRequest(request({ operation: "close", command }), deps)).status).toBe(503);
  expect(service.close).toHaveBeenCalledExactlyOnceWith(command);
  service.close.mockResolvedValueOnce({ ...openStatus, closedAt: "2026-09-19T18:00:00.000Z", purgeDeadline: "2026-10-19T18:00:00.000Z" });
  expect((await handleCheckinLifecycleRequest(request({ operation: "close", command }), deps)).status).toBe(200);
});
it("returns private, bounded lifecycle status without changing cookies", async () => {
  const { deps } = fixture();
  const result = await handleCheckinLifecycleRequest(request({ operation: "status" }), deps);
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual(openStatus);
  expect(result.headers.get("cache-control")).toBe("private, no-store");
  expect(result.headers.get("referrer-policy")).toBe("no-referrer");
  expect(result.headers.get("set-cookie")).toBeNull();
});
