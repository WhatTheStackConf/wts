import { afterEach, expect, it, vi } from "vite-plus/test";
import { handleCheckinArrivalResumeRequest } from "~/lib/checkin-arrival-resume-http";
import { getCheckinArrivalResume, resumeCheckinArrival } from "~/lib/checkin-arrival-resume-client";
import { checkinArrivalResumeSchema } from "~/lib/checkin-arrival-resume-contract";

const origin = "https://wts.example.test";
const operationId = "11111111-1111-4111-8111-111111111111";
const nextOperationId = "22222222-2222-4222-8222-222222222222";
const context = { protocolVersion: 1, edition: "WTS2026", eventId: "aaaaaaaaaaaaaaa", eventGeneration: 1, bindingId: "bbbbbbbbbbbbbbb", bindingVersion: 1, selectionVersion: 1, stationId: "wts2026station1", stationGeneration: 1, systemGeneration: 1 };
const dto = { operationId, context, status: "final", state: "needs_affiliation_choice", affiliationChoice: "fetch", recovery: "available", actions: ["retry", "blank"], operationsEnabled: false };
function request(body: object, extra: Record<string, string> = {}) { return new Request(`${origin}/api/checkin-arrival-resume`, { method: "POST", headers: { origin, "content-type": "application/json", cookie: `wts_checkin_client=${"a".repeat(64)}`, ...extra }, body: JSON.stringify(body) }); }
function deps() {
 const target = { get: vi.fn().mockResolvedValue(dto), resume: vi.fn().mockResolvedValue({ operationId: nextOperationId, state: "dependency_unavailable", operationsEnabled: false, replayed: false }) };
 return { target, authenticate: vi.fn().mockResolvedValue({ id: "human", role: "checkin_operator" }), service: vi.fn().mockResolvedValue(target) };
}
afterEach(() => vi.unstubAllGlobals());
it("authenticates same-origin reads with a server cookie and no-store privacy", async () => {
 const d = deps(); const response = await handleCheckinArrivalResumeRequest(request({ operation: "get", operationId }), d);
 expect(response.status).toBe(200);
 expect(d.target.get).toHaveBeenCalledWith("a".repeat(64), operationId);
 expect(response.headers.get("cache-control")).toBe("private, no-store");
 expect(response.headers.get("referrer-policy")).toBe("no-referrer");
 expect(await response.json()).toEqual(dto);
});
it("denies cross-origin, stale roles, duplicate cookies and browser-supplied context/hash", async () => {
 const invalidHeaders: Record<string, string>[] = [{ origin: "https://foreign.example" }, { cookie: `wts_checkin_client=${"a".repeat(64)}; wts_checkin_client=${"b".repeat(64)}` }];
 for (const extra of invalidHeaders) {
  const d = deps(); expect((await handleCheckinArrivalResumeRequest(request({ operation: "get", operationId }, extra), d)).status).toBe(403); expect(d.service).not.toHaveBeenCalled();
 }
 const d = deps(); d.authenticate.mockResolvedValue({ id: "human", role: "user" });
 expect((await handleCheckinArrivalResumeRequest(request({ operation: "get", operationId }), d)).status).toBe(403);
 for (const injection of [{ context }, { qrHash: "b".repeat(64) }, { nextOperationId: operationId }]) {
  const d = deps(); expect((await handleCheckinArrivalResumeRequest(request({ operation: "resume", command: { action: "retry", operationId, nextOperationId, qrIdentity: "A-ABC1234", ...injection } }), d)).status).toBe(400); expect(d.service).not.toHaveBeenCalled();
 }
 expect((await handleCheckinArrivalResumeRequest(request({ operation: "get", operationId, padding: "a".repeat(9000) }), deps())).status).toBe(413);
});
it("validates opaque browser responses and preserves caller continuation UUID across retry", async () => {
 const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(dto))); vi.stubGlobal("fetch", fetcher);
 expect(await getCheckinArrivalResume(operationId)).toEqual(dto);
 expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ operation: "get", operationId });
 const input = { action: "blank" as const, operationId, nextOperationId, qrIdentity: "A-ABC1234" };
 for (let i = 0; i < 2; i++) {
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ state: "dependency_unavailable", operationId: nextOperationId, replayed: i > 0, operationsEnabled: false })));
  expect((await resumeCheckinArrival(input)).operationId).toBe(nextOperationId);
 }
 expect(fetcher.mock.calls.slice(1).map(c => JSON.parse(c[1].body))).toEqual([{ operation: "resume", command: input }, { operation: "resume", command: input }]);
 fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...dto, qrHash: "b".repeat(64) })));
 await expect(getCheckinArrivalResume(operationId)).rejects.toMatchObject({ ambiguous: true });
 fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...dto, operationId: nextOperationId })));
 await expect(getCheckinArrivalResume(operationId)).rejects.toMatchObject({ ambiguous: true });
 expect(checkinArrivalResumeSchema.safeParse({ ...dto, qrIdentity: "A-ABC1234" }).success).toBe(false);
});
