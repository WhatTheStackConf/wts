import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { confirmCheckinLookup, searchCheckinLookup } from "~/lib/checkin-lookup-client";
import type { CheckinLookupConfirmInput } from "~/lib/checkin-lookup-contract";
const input = (): CheckinLookupConfirmInput => ({ operationId: "11111111-1111-4111-8111-111111111111", attendeeId: "21", qrIdentity: "A-TEST001", affiliationChoice: "fetch", context: { protocolVersion: 1, edition: "WTS2026", eventId: "aaaaaaaaaaaaaaa", eventGeneration: 1, bindingId: "bbbbbbbbbbbbbbb", bindingVersion: 1, selectionVersion: 1, stationId: "wts2026station1", stationGeneration: 1, systemGeneration: 1 } });
const result = () => ({ state: "already_handled", operationId: input().operationId, operationsEnabled: false, replayed: false });
afterEach(() => vi.unstubAllGlobals());
describe("lookup browser client", () => {
 it.each([400, 401, 403, 408, 409, 422, 429, 500, 503])("treats confirmation HTTP %s as ambiguous even on the first response", async status => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
  await expect(confirmCheckinLookup(input())).rejects.toMatchObject({ ambiguous: true, status, kind: status === 401 || status === 403 ? "access" : status === 409 ? "context" : "transport" });
 });
 it.each([401, 403, 409])("classifies search HTTP %s for immediate private-state redaction", async status => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
  await expect(searchCheckinLookup({ context: input().context, query: "Person" })).rejects.toMatchObject({ ambiguous: false, status, kind: status === 409 ? "context" : "access" });
 });
 it("retains byte-identical blank continuation through post-commit denial", async () => {
  const command = { ...input(), priorOperationId: "22222222-2222-4222-8222-222222222222", affiliationChoice: "blank" as const };
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 403 })).mockResolvedValueOnce(Response.json(result()));
  vi.stubGlobal("fetch", fetcher);
  await expect(confirmCheckinLookup(command)).rejects.toMatchObject({ ambiguous: true, kind: "access" });
  await confirmCheckinLookup(command);
  expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
  expect(JSON.parse(fetcher.mock.calls[1][1].body).input).toEqual(command);
 });
 it("uses private POST bodies without storage or URL query and freezes caller changes", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(result())); vi.stubGlobal("fetch", fetcher);
  const command = input(); const pending = confirmCheckinLookup(command); command.attendeeId = "22"; command.context.stationId = "wts2026station2";
  await pending;
  expect(fetcher.mock.calls[0][0]).toBe("/api/checkin-lookup");
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer" });
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ operation: "confirm", input: input() });
 });
 it.each([{ ...result(), operationsEnabled: true }, { ...result(), email: "private@example.test" }, { ...result(), operationId: "22222222-2222-4222-8222-222222222222" }, { state: "accepted" }])("rejects malformed success as unknown mutation outcome", async body => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
  await expect(confirmCheckinLookup(input())).rejects.toMatchObject({ ambiguous: true });
 });
 it.each(["reserved", "existing", "accepted", "admission_pending", "admission_uncertain", "existing_unattributed"])("rejects foreign station workflow in %s", async state => {
  const workflow = { id: "ccccccccccccccc", stationId: "wts2026station2", eventId: input().context.eventId, eventTitle: "Event", state: "accepted", name: "Private name", affiliation: "", profileId: "profile", createdAt: "2026-09-19" };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...result(), state, workflow, ...(state === "accepted" ? { printIntentId: "ddddddddddddddd" } : {}) })));
  await expect(confirmCheckinLookup(input())).rejects.toMatchObject({ ambiguous: true });
 });
 it.each(["partial", "unavailable"])("keeps %s distinct from empty complete search", async state => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ state, context: input().context, items: [], nextOffset: null })));
  expect((await searchCheckinLookup({ context: input().context, query: "Person" })).state).toBe(state);
 });
 it("rejects stale search fences and backwards pagination", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ state: "complete", context: { ...input().context, selectionVersion: 2 }, items: [], nextOffset: null })).mockResolvedValueOnce(Response.json({ state: "complete", context: input().context, items: [], nextOffset: 20 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(searchCheckinLookup({ context: input().context, query: "Person" })).rejects.toMatchObject({ ambiguous: false });
  await expect(searchCheckinLookup({ context: input().context, query: "Person", offset: 20 })).rejects.toMatchObject({ ambiguous: false });
 });
 it("preserves byte-identical explicit retry after lost response and malformed 200", async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error("private")).mockResolvedValueOnce(Response.json({ state: "accepted" })).mockResolvedValueOnce(Response.json(result())); vi.stubGlobal("fetch", fetcher);
  const command = input();
  await expect(confirmCheckinLookup(command)).rejects.toMatchObject({ ambiguous: true });
  await expect(confirmCheckinLookup(command)).rejects.toMatchObject({ ambiguous: true });
  await confirmCheckinLookup(command);
  expect(new Set(fetcher.mock.calls.map(call => call[1].body)).size).toBe(1);
 });
});
