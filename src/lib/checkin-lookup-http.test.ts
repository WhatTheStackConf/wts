import { describe, expect, it, vi } from "vite-plus/test";
import { handleCheckinLookupRequest } from "~/lib/checkin-lookup-http";
import { isCheckinPath } from "~/lib/checkin-privacy";
const context = { protocolVersion: 1, edition: "WTS2026", eventId: "aaaaaaaaaaaaaaa", eventGeneration: 1, bindingId: "bbbbbbbbbbbbbbb", bindingVersion: 1, selectionVersion: 1, stationId: "wts2026station1", stationGeneration: 1, systemGeneration: 1 };
const origin = "https://wts.example.test";
const input = { context, query: "person@example.test" };
function request(body: unknown = { operation: "search", input }, cookie = `wts_checkin_client=${"a".repeat(64)}`, extra: Record<string, string> = {}) {
 return new Request(`${origin}/api/checkin-lookup`, { method: "POST", headers: { origin, "content-type": "application/json", cookie, ...extra }, body: JSON.stringify(body) });
}
function deps(role = "checkin_operator") {
 const target = { search: vi.fn().mockResolvedValue({ state: "complete", context, items: [], nextOffset: null }), confirm: vi.fn(), getRecovery: vi.fn(), recover: vi.fn() };
 return { target, authenticate: vi.fn().mockResolvedValue({ id: "human", role }), service: vi.fn().mockResolvedValue(target) };
}
describe("authenticated private lookup HTTP", () => {
 it("dispatches validated opaque recovery without exposing raw identities", async () => {
  const d = deps(); const operationId = crypto.randomUUID();
  const descriptor = { operationId, context, attendeeId: "21", state: "dependency_unavailable", recovery: "available", actions: ["retry"] };
  d.target.getRecovery.mockResolvedValue(descriptor);
  const response = await handleCheckinLookupRequest(request({ operation: "recovery_get", input: { operationId } }), d);
  expect(response.status).toBe(200); expect(await response.json()).toEqual(descriptor);
  expect(d.target.getRecovery).toHaveBeenCalledWith("a".repeat(64), operationId);
  expect(d.target.confirm).not.toHaveBeenCalled(); expect(d.target.recover).not.toHaveBeenCalled();
 });
 it("preserves the caller's recovery UUID and validates the resulting operation", async () => {
  const d = deps(); const operationId = crypto.randomUUID(); const nextOperationId = crypto.randomUUID();
  d.target.getRecovery.mockResolvedValue({ operationId, context, attendeeId: "21", state: "dependency_unavailable", recovery: "available", actions: ["retry"] });
  const input = { operationId, action: "retry", nextOperationId };
  d.target.recover.mockResolvedValue({ operationId: nextOperationId, state: "dependency_unavailable", replayed: false, operationsEnabled: false });
  const response = await handleCheckinLookupRequest(request({ operation: "recover", input }), d);
  expect(response.status).toBe(200); expect(d.target.recover).toHaveBeenCalledWith("a".repeat(64), input);
  d.target.recover.mockResolvedValue({ operationId, state: "dependency_unavailable", replayed: false, operationsEnabled: false });
  expect((await handleCheckinLookupRequest(request({ operation: "recover", input }), d)).status).toBe(503);
 });
 it("refuses private or mismatched opaque recovery descriptors", async () => {
  const d = deps(); const operationId = crypto.randomUUID();
  for (const extra of [{ email: "synthetic-private@example.test" }, { operationId: crypto.randomUUID() }]) {
   d.target.getRecovery.mockResolvedValue({ operationId, context, attendeeId: "21", state: "pending", recovery: "available", actions: ["replay"], ...extra });
   const response = await handleCheckinLookupRequest(request({ operation: "recovery_get", input: { operationId } }), d);
   expect(response.status).toBe(503); expect(await response.text()).not.toContain("synthetic-private");
  }
 });
 it("authenticates before resolving the service and sends only private parsed input", async () => {
  const d = deps(); const result = await handleCheckinLookupRequest(request(), d);
  expect(result.status).toBe(200);
  expect(d.authenticate.mock.invocationCallOrder[0]).toBeLessThan(d.service.mock.invocationCallOrder[0]);
  expect(d.target.search).toHaveBeenCalledWith("a".repeat(64), { ...input, offset: 0 });
  expect(d.target.confirm).not.toHaveBeenCalled();
  expect(result.headers.get("cache-control")).toBe("private, no-store");
  expect(result.headers.get("referrer-policy")).toBe("no-referrer");
  expect(isCheckinPath("/api/checkin-lookup")).toBe(true);
  expect(await result.text()).not.toMatch(/person@|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
 });
 it.each(["user", "reviewer", "", "agent"])("denies %s before service creation", async role => {
  const d = deps(role); expect((await handleCheckinLookupRequest(request(), d)).status).toBe(403); expect(d.service).not.toHaveBeenCalled();
 });
 it("denies a failed session and cross-origin mutation", async () => {
  const d = deps(); d.authenticate.mockRejectedValue(new Error("private"));
  expect((await handleCheckinLookupRequest(request(), d)).status).toBe(403);
  expect((await handleCheckinLookupRequest(request(undefined, undefined, { origin: "https://evil.test" }), d)).status).toBe(403);
  expect(d.service).not.toHaveBeenCalled();
 });
 it.each(["wts_checkin_client=bad", `wts_checkin_client=${"a".repeat(64)}; wts_checkin_client=${"b".repeat(64)}`, ""])("rejects invalid/missing/duplicate binding cookies", async cookie => {
  const d = deps(); expect((await handleCheckinLookupRequest(request(undefined, cookie), d)).status).toBe(403); expect(d.service).not.toHaveBeenCalled();
 });
 it("rejects invalid and oversized inputs without constructing services", async () => {
  const d = deps();
  expect((await handleCheckinLookupRequest(request({ operation: "search", input: { ...input, token: "secret" } }), d)).status).toBe(400);
  expect((await handleCheckinLookupRequest(request({ x: "x".repeat(9000) }), d)).status).toBe(413);
  expect(d.service).not.toHaveBeenCalled();
 });
 it("sanitizes service errors and refuses malformed/private success payloads", async () => {
  const d = deps(); d.target.search.mockRejectedValueOnce(new Error("person@example.test Bearer secret"));
  const failed = await handleCheckinLookupRequest(request(), d);
  expect(failed.status).toBe(503); expect(await failed.text()).not.toMatch(/person@|Bearer|secret/);
  d.target.search.mockResolvedValueOnce({ state: "partial", context, items: [{ email: "person@example.test" }], nextOffset: null });
  const malformed = await handleCheckinLookupRequest(request(), d); expect(malformed.status).toBe(503); expect(await malformed.text()).not.toContain("person@");
 });
});
