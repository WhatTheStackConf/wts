import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { CheckinArrivalRequestError, checkinArrivalStatus, checkinArrivalHistory, preflightCheckinArrival } from "~/lib/checkin-arrival-client";
import type { CheckinArrivalInput } from "~/lib/checkin-arrival-contract";

const input = (): CheckinArrivalInput => ({ operationId: "11111111-1111-4111-8111-111111111111", qrIdentity: "EXACT_QR_1", affiliationChoice: "fetch", context: { protocolVersion: 1, edition: "WTS2026", eventId: "aaaaaaaaaaaaaaa", eventGeneration: 1, bindingId: "bbbbbbbbbbbbbbb", bindingVersion: 1, selectionVersion: 1, stationId: "wts2026station1", stationGeneration: 1, systemGeneration: 1 } });
afterEach(() => vi.unstubAllGlobals());
describe("arrival browser transport", () => {
  it("status sends only its UUID and validates the returned identity without treating absence as no-send",async()=>{
    const body={operationId:input().operationId,result:null,operationsEnabled:false};
    const fetcher=vi.fn().mockResolvedValueOnce(Response.json(body)).mockResolvedValueOnce(Response.json({...body,operationId:crypto.randomUUID()}));
    vi.stubGlobal("fetch",fetcher);
    expect(await checkinArrivalStatus(body.operationId)).toEqual(body);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({operation:"status",operationId:body.operationId});
    await expect(checkinArrivalStatus(body.operationId)).rejects.toMatchObject({ambiguous:true});
  });
  it.each([401,403])("classifies status denial %s without parsing messages",async status=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("private",{status})));
    await expect(checkinArrivalStatus(input().operationId)).rejects.toMatchObject({status,denied:true});
  });
  it("accepts a resolved exception projection without treating its immutable failure as current work", async () => {
    const item = { id: "ccccccccccccccc", operationId: input().operationId, stationId: "wts2026station1", eventId: "aaaaaaaaaaaaaaa", createdAt: "2026-09-19T11:00:00Z", completedAt: "2026-09-19T12:00:00Z", resolvedByOperationId: "22222222-2222-4222-8222-222222222222", result: { state: "needs_affiliation_choice" } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ items: [item], nextCursor: null, day: "2026-09-19", operationsEnabled: false })));
    expect((await checkinArrivalHistory()).items).toEqual([item]);
  });
  it("posts a private immutable command and validates operation identity", async () => {
    const command = input();
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ state: "already_handled", operationId: command.operationId, replayed: false, operationsEnabled: false })));
    vi.stubGlobal("fetch", fetcher);
    const pending = preflightCheckinArrival(command);
    command.qrIdentity = "CHANGED"; command.context.eventId = "ccccccccccccccc"; command.affiliationChoice = "blank";
    expect(await pending).toMatchObject({ state: "already_handled" });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/checkin-arrivals");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer" });
    expect(JSON.parse(init.body)).toEqual({ operation: "preflight", command: input() });
  });

  it.each([
    { state: "already_handled", operationId: "22222222-2222-4222-8222-222222222222", replayed: false, operationsEnabled: false },
    { state: "already_handled", operationId: input().operationId, replayed: false, operationsEnabled: true },
    { state: "already_handled", operationId: input().operationId, replayed: false, operationsEnabled: false, name: "Private foreign name" },
    { state: "rejected", operationId: input().operationId, replayed: false, operationsEnabled: false, reason: "raw_private_diagnostic" },
    { state: "reserved", operationId: input().operationId, replayed: false, operationsEnabled: false },
  ])("treats malformed or mismatched success as an unknown saved outcome", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    await expect(preflightCheckinArrival(input())).rejects.toMatchObject({ ambiguous: true });
  });
  it.each(["eventId", "stationId"])("checks immutable workflow %s against the submitted context", async (field) => {
    const workflow = { id: "ccccccccccccccc", stationId: "wts2026station1", eventId: "aaaaaaaaaaaaaaa", eventTitle: "Event", state: "not_submitted", name: "Test attendee", affiliation: "", profileId: "ddddddddddddddd", createdAt: "2026-09-19T12:00:00Z", [field]: field === "eventId" ? "eeeeeeeeeeeeeee" : "wts2026station2" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ state: "reserved", operationId: input().operationId, replayed: false, operationsEnabled: false, workflow }))));
    await expect(preflightCheckinArrival(input())).rejects.toMatchObject({ ambiguous: true });
  });
  it("does not let a caller's later mutation alter response identity validation", async () => {
    const command = input();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ state: "already_handled", operationId: "22222222-2222-4222-8222-222222222222", replayed: false, operationsEnabled: false }))));
    const pending = preflightCheckinArrival(command);
    command.operationId = "22222222-2222-4222-8222-222222222222";
    await expect(pending).rejects.toMatchObject({ ambiguous: true });
  });
  it.each([401, 403, 409, 500, 503])("does not expose raw non-OK %s response text", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Bearer secret person@example.test A-TEST001" }), { status })));
    const error = await preflightCheckinArrival(input()).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(CheckinArrivalRequestError);
    expect((error as Error).message).not.toMatch(/Bearer|secret|person@|A-TEST001/);
    expect(error).toMatchObject({ ambiguous: status >= 500 });
  });
  it("retries a lost response only when explicitly called with the exact original command", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("transport private detail")).mockResolvedValueOnce(new Response(JSON.stringify({ state: "already_handled", operationId: input().operationId, replayed: true, operationsEnabled: false })));
    vi.stubGlobal("fetch", fetcher);
    const command = input();
    command.affiliationChoice = "blank";
    command.priorOperationId = "22222222-2222-4222-8222-222222222222";
    await expect(preflightCheckinArrival(command)).rejects.toMatchObject({ ambiguous: true });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(await preflightCheckinArrival(command)).toMatchObject({ replayed: true });
    expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[0][1].body);
  });
  it("validates paginated history and rejects extra private fields", async () => {
    const clean = { items: [], nextCursor: "2026-09-19 12:00:00.000Z|ccccccccccccccc", day: "2026-09-19", operationsEnabled: false };
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(clean))).mockResolvedValueOnce(new Response(JSON.stringify({ ...clean, email: "private@example.test" })));
    vi.stubGlobal("fetch", fetcher);
    expect(await checkinArrivalHistory({ scope: "all", limit: 30 })).toEqual(clean);
    await expect(checkinArrivalHistory({ cursor: clean.nextCursor })).rejects.toMatchObject({ ambiguous: true });
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ operation: "history", query: { cursor: clean.nextCursor } });
  });
});
