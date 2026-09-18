import { expect, it, vi } from "vite-plus/test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { setup, ready, context } from "./checkin-recovery-test-helper";
import { checkinEventBindingHash } from "./checkin-event-service";
import type { CheckinStationId } from "./checkin-contract";

// Real disposable PocketBase, coordinator, approved profiles and protocol
// authorizations; upstream eligibility and printer outcome are synthetic seams.
async function fixture(upstreamExisting = false) {
  const t = await setup();
  const r = await ready(t);
  await r.coordinator.listen(); await r.heartbeat();
  if (upstreamExisting) t.source.resolve = async () => ({ state: "eligible", attendee: { upstreamAttendeeId: "501", publicId: "A-ABC1234", productId: "401", name: "Тест Attendee", alreadyCheckedIn: true } });
  const affiliation = vi.spyOn(t.source, "affiliation");
  const resolve = vi.spyOn(t.source, "resolve");
  const initial = { ...t.command(), context: await context(t) };
  const first = await t.service.preflight(t.token, initial);
  if (!("workflow" in first)) throw new Error("Missing initial workflow");
  let posts = 0;
  const processor = { attendee: async () => ({ upstreamAttendeeId: "501", publicId: "A-ABC1234", productId: "401", alreadyCheckedIn: false }), admit: async () => { posts++; return { state: "newly_checked_in" as const, fingerprint: "d".repeat(64) }; } };
  const settle = async (stationId: CheckinStationId = "wts2026station1", outcome = "protocol_complete") => {
    await r.coordinator.claimPrints();
    const attempts = await t.pb.collection("checkin_agent_attempts").getFullList({ sort: "created,id" });
    // Select by queued print rather than equal-millisecond random record IDs.
    const prints = await t.pb.collection("checkin_print_attempts").getFullList({ filter: `workflow_id='${first.workflow.id}' && station_id='${stationId}' && (state='queued' || state='dispatched')` });
    const a = attempts.find(a => prints.some(p => p.id === a.print_attempt_id));
    if (!a) throw new Error("No unsettled claimed print");
    const agent = (await t.pb.collection("checkin_agents").getFullList({ filter: `station='${stationId}'` }))[0]!;
    const owner = (await t.pb.collection("checkin_coordinator").getOne("wts2026coord000")).owner;
    const payload = { stationId, attemptId: a.id, payloadHash: a.payload_hash, authorizationHash: crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "") };
    for (const operation of ["authorize", "start", "outcome"]) await t.pb.send("/api/wts/checkin-agents", { method: "POST", requestKey: null, body: { operation: `machine_${operation}`, owner, nowMs: Date.now(), credentialHash: agent.credential_hash, payload: operation === "outcome" ? { ...payload, outcome } : payload } });
    return a.print_attempt_id as string;
  };
  const next = async (token = t.token) => ({ ...t.command(), context: await context(t, token) });
  const recovery = async (command: object) => {
    const projection = (await t.pb.collection("checkin_recovery_workflows").getFullList({ filter: `workflow_id='${first.workflow.id}'` }))[0];
    return t.pb.send("/api/wts/checkin-recovery", { method: "POST", requestKey: null, body: { operation: "command", actorUserId: t.operator.actor.userId, identityHash: checkinEventBindingHash(t.token), command: { operationId: crypto.randomUUID(), workflowId: first.workflow.id, expectedVersion: projection?.version ?? 0, ...command } } });
  };
  return { t, r, initial, first, affiliation, resolve, processor, settle, next, recovery, posts: () => posts, close: async () => { await r.coordinator.close(); await t.cleanup(); } };
}


import { createHash } from "node:crypto";
import { CheckinArrivalResumeService } from "./checkin-arrival-resume-service";
import { CheckinLookupService } from "./checkin-lookup-service";

function sql(f: Awaited<ReturnType<typeof fixture>>, query: string, ...args: any[]) {
  const db = new DatabaseSync(join(f.t.root, "pb_data", "data.db"));
  try { db.prepare(query).run(...args); } finally { db.close(); }
}
function send(f: Awaited<ReturnType<typeof fixture>>, route: string, body: object) {
  return f.t.pb.send<any>(`/api/wts/${route}`, { method: "POST", requestKey: null, body: { actorUserId: f.t.operator.actor.userId, identityHash: checkinEventBindingHash(f.t.token), sourceKey: f.t.source.sourceKey, ...body } });
}
const hashQR = (qr: string) => createHash("sha256").update(`wts2026:arrival:${qr}`).digest("hex");
const history = (f: Awaited<ReturnType<typeof fixture>>, day: string) => send(f, "checkin-arrivals", { operation: "history", day, query: { scope: "station", limit: 100 } });

for (const mode of ["resume", "lookup"] as const) for (const failed of [false, true]) it(`${mode}: reload ${failed ? "failed-read retry" : "pending replay"} of reprint does not confuse historical work with command-owned work`, async () => {
  const f = await fixture();
  try {
    await f.r.coordinator.processAdmissions(f.processor); await f.settle();
    const command = await f.next();
    const { qrIdentity, ...rest } = command;
    const opaque = { ...rest, priorOperationId: "", qrHash: hashQR(qrIdentity) };
    if (mode === "lookup") await send(f, "checkin-lookup-commands", { operation: "bind", operationId: command.operationId, command: { ...opaque, attendeeId: "501" } });
    const begun = await send(f, "checkin-arrivals", { operation: "begin", command: opaque });
    expect(begun.snapshot).toBeDefined();
    if (failed) await send(f, "checkin-arrivals", { operation: "finish", command: opaque, readiness: begun.readiness, resolution: { state: "unavailable" } });
    // New service instances represent a phone reload, not a PB restore epoch.
    const resume = new CheckinArrivalResumeService(f.t.pb, f.t.operator.actor, f.t.source);
    const lookup = new CheckinLookupService(f.t.pb, f.t.operator.actor, { sourceKey: f.t.source.sourceKey, identity: async () => ({ state: "complete", attendees: [{ attendeeId: "501", publicId: qrIdentity, name: "Test Attendee", email: "test@example.test" }] }), search: async () => ({ state: "complete", attendees: [] }) }, f.t.source);
    const state = mode === "resume" ? await resume.get(f.t.token, command.operationId) : await lookup.getRecovery(f.t.token, command.operationId);
    expect(state.actions).toContain(failed ? "retry" : "replay");
    const input = failed ? { operationId: command.operationId, action: "retry" as const, nextOperationId: crypto.randomUUID() } : { operationId: command.operationId, action: "replay" as const };
    const result = mode === "resume" ? await resume.resume(f.t.token, { ...input, qrIdentity }) : await lookup.recover(f.t.token, input);
    expect(result).toMatchObject({ state: "accepted", requestedPrint: { purpose: "replacement", state: "queued" } });
    expect(mode === "resume" ? await resume.resume(f.t.token, { ...input, qrIdentity }) : await lookup.recover(f.t.token, input)).toMatchObject({ replayed: true, printIntentId: (result as any).printIntentId });
    if (input.action === "retry") await expect(mode === "resume" ? resume.resume(f.t.token, { ...input, nextOperationId: crypto.randomUUID(), qrIdentity }) : lookup.recover(f.t.token, { ...input, nextOperationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "conflict" });
    expect(await f.r.coordinator.processAdmissions(f.processor)).toBe(0);
    expect(f.posts()).toBe(1);
    expect(await f.t.pb.collection("checkin_print_attempts").getFullList()).toHaveLength(2);
    expect(await f.t.pb.collection("checkin_arrival_attempts").getFullList()).toHaveLength(1);
  } finally { await f.close(); }
});

it("legacy empty-pointer duplicate keeps initial print across cross-printer replacement status, replay and history", async () => {
  const f = await fixture();
  try {
    await f.r.coordinator.processAdmissions(f.processor); const initial = await f.settle();
    const legacy = await f.next();
    // Reconstruct a migrated historical duplicate with its immutable original result.
    const { qrIdentity, ...rest } = legacy;
    await send(f, "checkin-arrivals", { operation: "begin", command: { ...rest, priorOperationId: "", qrHash: hashQR(qrIdentity) } });
    const original = await f.t.pb.collection("checkin_arrival_commands").getFirstListItem(`operation_id='${f.initial.operationId}'`);
    const saved = { ...original.result }; delete saved.requestedPrint;
    sql(f, "UPDATE checkin_arrival_commands SET status='final',workflow_id=?,result=?,requested_print_id='',history_visible=true WHERE operation_id=?", f.first.workflow.id, JSON.stringify(saved), legacy.operationId);
    const second = await ready(f.t, "wts2026station2", f.r.coordinator); await second.heartbeat();
    const token = "e".repeat(64); await f.t.control.bind(second.code, token, (await f.t.control.preview(second.code)).confirmation);
    const replacement = await f.t.service.preflight(token, await f.next(token));
    expect(replacement).toMatchObject({ state: "accepted", requestedPrint: { purpose: "replacement", state: "queued" } });
    for (const settled of [false, true]) {
      if (settled) await f.settle("wts2026station2");
      const expected = { printIntentId: initial, workflow: { printState: "completed" }, requestedPrint: { id: initial, purpose: "initial", state: "completed" } };
      expect(await f.t.service.status(f.t.token, legacy.operationId)).toMatchObject({ result: expected });
      expect(await f.t.service.preflight(f.t.token, legacy)).toMatchObject(expected);
      expect((await f.t.service.history(f.t.token)).items.find(i => i.operationId === legacy.operationId)).toMatchObject({ result: expected, completedAt: expect.any(String) });
      expect((await history(f, "2099-01-01")).items.some((i: any) => i.operationId === legacy.operationId)).toBe(false);
    }
  } finally { await f.close(); }
});

it("later replacement recovery does not terminalize the earlier unprinted command", async () => {
  const f = await fixture();
  try {
    await f.r.coordinator.processAdmissions(f.processor); const initial = await f.settle("wts2026station1", "output_uncertain");
    await f.recovery({ operation: "observe", printId: initial, outcome: "not_printed" });
    const next = await f.next(); await f.t.service.preflight(f.t.token, next);
    const replacement = await f.settle("wts2026station1", "output_uncertain");
    await f.recovery({ operation: "observe", printId: replacement, outcome: "printed" });
    sql(f, "UPDATE checkin_recovery_observations SET created='2020-01-01 12:00:00.000Z' WHERE print_id=?", replacement);
    sql(f, "UPDATE checkin_recovery_workflows SET completed_day='2020-01-01',updated_at='2020-01-01T12:00:00Z' WHERE workflow_id=?", f.first.workflow.id);
    expect((await history(f, "2020-01-02")).items).toMatchObject([{ operationId: f.initial.operationId, completedAt: null, result: { requestedPrint: { id: initial, state: "uncertain" } } }]);
    expect((await history(f, "2020-01-02")).items).toHaveLength(1);
    expect((await history(f, "2020-01-01")).items.find((i: any) => i.operationId === next.operationId)).toMatchObject({ completedAt: expect.any(String), result: { requestedPrint: { id: replacement, state: "uncertain" } } });
  } finally { await f.close(); }
});

it("printed observation completes only its requested print and survives later replacement without inventing device completion", async () => {
  const f = await fixture();
  try {
    await f.r.coordinator.processAdmissions(f.processor); const initial = await f.settle("wts2026station1", "output_uncertain");
    await f.recovery({ operation: "observe", printId: initial, outcome: "printed" });
    sql(f, "UPDATE checkin_recovery_observations SET created='2020-01-01 12:00:00.000Z' WHERE print_id=?", initial);
    sql(f, "UPDATE checkin_recovery_workflows SET completed_day='2020-01-01',updated_at='2020-01-01T12:00:00Z' WHERE workflow_id=?", f.first.workflow.id);
    expect((await history(f, "2020-01-02")).items).toHaveLength(0);
    expect((await history(f, "2020-01-01")).items).toMatchObject([{ completedAt: expect.any(String), result: { requestedPrint: { id: initial, state: "uncertain" }, workflow: { printState: "uncertain" } } }]);
    const next = await f.next(); await f.t.service.preflight(f.t.token, next);
    expect((await history(f, "2020-01-02")).items).toMatchObject([{ operationId: next.operationId, completedAt: null }]);
    await f.settle();
    expect((await history(f, "2020-01-01")).items).toMatchObject([{ operationId: f.initial.operationId }]);
    expect((await history(f, "2020-01-02")).items).toHaveLength(0);
    expect(await f.t.pb.collection("checkin_print_attempts").getOne(initial)).toMatchObject({ state: "uncertain", fulfillment_completed_at: "" });
  } finally { await f.close(); }
});

for (const terminal of ["handwritten", "cancelled", "denied", "reset"] as const) it(`requested-print history scopes ${terminal} evidence and acknowledged cancellation`, async () => {
  const f = await fixture(true);
  try {
    const initial = (f.first as any).printIntentId;
    // Real recovery creates cancellation evidence without changing raw queued output.
    await f.recovery({ operation: "handwrite", physicallyIsolated: false });
    await f.recovery({ operation: "handwrite", physicallyIsolated: false });
    sql(f, "UPDATE checkin_recovery_workflows SET fulfillment=?,completed_day='2020-01-01',updated_at='2020-01-01T12:00:00Z' WHERE workflow_id=?", terminal, f.first.workflow.id);
    sql(f, "UPDATE checkin_recovery_cancellations SET acknowledged_at='2020-01-01T12:00:00Z' WHERE print_id=?", initial);
    expect((await history(f, "2020-01-02")).items).toHaveLength(0);
    expect((await history(f, "2020-01-01")).items).toMatchObject([{ completedAt: expect.any(String), result: { requestedPrint: { state: "queued" } } }]);
    // Without cancellation evidence only an exact latest pointer may complete it.
    sql(f, "DELETE FROM checkin_recovery_cancellations WHERE print_id=?", initial);
    expect((await history(f, "2020-01-02")).items).toHaveLength(0);
    sql(f, "UPDATE checkin_recovery_workflows SET latest_print_id='foreignprint000' WHERE workflow_id=?", f.first.workflow.id);
    expect((await history(f, "2020-01-02")).items).toMatchObject([{ completedAt: null }]);
  } finally { await f.close(); }
});
