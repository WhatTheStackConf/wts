import { expect, it, vi } from "vite-plus/test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { setup, ready, context } from "./checkin-recovery-test-helper";
import { checkinEventBindingHash } from "./checkin-event-service";
import { checkinArrivalResultSchema } from "./checkin-arrival-client";
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

it("deliberate same-printer arrival appends one replacement; exact UUID and status retain their own output", async () => {
  const f = await fixture();
  try {
    await f.r.coordinator.processAdmissions(f.processor);
    const initialPrint = await f.settle();
    const frozenWorkflow = await f.t.pb.collection("checkin_arrival_workflows").getOne(f.first.workflow.id);
    const frozenCommand = await f.t.pb.collection("checkin_arrival_commands").getFirstListItem(`operation_id='${f.initial.operationId}'`);
    await f.recovery({ operation: "correct", name: "Corrected Attendee", affiliation: "Corrected affiliation" });
    const command = await f.next();
    const replacement = await f.t.service.preflight(f.t.token, command);
    expect(replacement).toMatchObject({ state: "accepted", workflow: { id: f.first.workflow.id, printState: "queued" }, requestedPrint: { stationId: "wts2026station1", purpose: "replacement", state: "queued" } });
    expect(checkinArrivalResultSchema.safeParse(replacement).success).toBe(true);
    if (replacement.state !== "accepted" || !replacement.printIntentId) throw new Error("Missing replacement");
    expect(replacement.printIntentId).not.toBe(initialPrint);
    expect(await f.t.pb.collection("checkin_print_attempts").getOne(replacement.printIntentId)).toMatchObject({ predecessor_attempt_id: initialPrint, name: "Corrected Attendee", affiliation: "Corrected affiliation" });
    const reads = f.resolve.mock.calls.length;
    expect(await f.t.service.preflight(f.t.token, command)).toMatchObject({ replayed: true, printIntentId: replacement.printIntentId, requestedPrint: { id: replacement.printIntentId } });
    expect(f.resolve.mock.calls.length).toBe(reads);
    expect(await f.t.service.status(f.t.token, f.initial.operationId)).toMatchObject({ result: { printIntentId: initialPrint, workflow: { printState: "completed" } } });
    expect(await f.t.service.status(f.t.token, command.operationId)).toMatchObject({ result: { printIntentId: replacement.printIntentId, workflow: { printState: "queued" } } });
    expect(await f.t.pb.collection("checkin_arrival_workflows").getOne(f.first.workflow.id)).toEqual(frozenWorkflow);
    expect(await f.t.pb.collection("checkin_arrival_commands").getOne(frozenCommand.id)).toEqual(frozenCommand);
    await f.settle();
    expect(await f.t.service.status(f.t.token, command.operationId)).toMatchObject({ result: { requestedPrint: { state: "completed" } } });
    expect(await f.r.coordinator.processAdmissions(f.processor)).toBe(0);
    expect(f.posts()).toBe(1);
    expect(await f.t.pb.collection("checkin_arrival_attempts").getFullList()).toHaveLength(1);
  } finally { await f.close(); }
});

it("cross-printer replacement uses selected approved profile and command-local history/authorization", async () => {
  const f = await fixture();
  try {
    await f.r.coordinator.processAdmissions(f.processor); const initialPrint = await f.settle();
    const second = await ready(f.t, "wts2026station2", f.r.coordinator); await second.heartbeat();
    const token = "e".repeat(64); await f.t.control.bind(second.code, token, (await f.t.control.preview(second.code)).confirmation);
    const command = await f.next(token);
    const replacement = await f.t.service.preflight(token, command);
    expect(replacement).toMatchObject({ state: "accepted", workflow: { stationId: "wts2026station1", printState: "queued" }, requestedPrint: { stationId: "wts2026station2", profileId: second.saved.profile.id, purpose: "replacement" } });
    expect(checkinArrivalResultSchema.safeParse(replacement).success).toBe(true);
    if (replacement.state !== "accepted" || !replacement.printIntentId) throw new Error("Missing replacement");
    expect(await f.t.pb.collection("checkin_print_attempts").getOne(replacement.printIntentId)).toMatchObject({ station_id: "wts2026station2", profile_id: second.saved.profile.id, profile_snapshot: { stationId: "wts2026station2" }, predecessor_attempt_id: initialPrint });
    expect(await f.t.service.status(token, command.operationId)).toMatchObject({ result: { printIntentId: replacement.printIntentId } });
    expect((await f.t.service.status(f.t.token, command.operationId)).result).toBeNull();
    expect((await f.t.service.history(token)).items).toMatchObject([{ operationId: command.operationId, stationId: "wts2026station2", result: { requestedPrint: { id: replacement.printIntentId } } }]);
    expect((await f.t.service.history(f.t.token)).items.some(i => i.operationId === command.operationId)).toBe(false);
    await f.settle("wts2026station2");
    expect(await f.t.service.status(token, command.operationId)).toMatchObject({ result: { requestedPrint: { state: "completed" } } });
    expect(f.posts()).toBe(1);
  } finally { await f.close(); }
});

it("concurrent deliberate UUIDs serialize to one successor and one blocked command", async () => {
  const f = await fixture();
  try {
    await f.r.coordinator.processAdmissions(f.processor); await f.settle();
    const a = await f.next(), b = { ...a, operationId: crypto.randomUUID() };
    const results = await Promise.all([f.t.service.preflight(f.t.token, a), f.t.service.preflight(f.t.token, b)]);
    expect(results.map(r => r.state).sort()).toEqual(["accepted", "print_blocked"]);
    expect(results.find(r => r.state === "print_blocked")).toMatchObject({ reason: "in_progress" });
    expect(await f.t.pb.collection("checkin_print_attempts").getFullList()).toHaveLength(2);
    expect(await f.t.pb.collection("checkin_arrival_workflows").getFullList()).toHaveLength(1);
    expect(f.posts()).toBe(1);
  } finally { await f.close(); }
});

it("pending admission/output and uncertain output are blocked until terminal observation", async () => {
  const f = await fixture();
  try {
    expect(await f.t.service.preflight(f.t.token, await f.next())).toMatchObject({ state: "print_blocked", reason: "in_progress" });
    await f.r.coordinator.processAdmissions(f.processor);
    expect(await f.t.service.preflight(f.t.token, await f.next())).toMatchObject({ state: "print_blocked", reason: "in_progress" });
    const printId = await f.settle("wts2026station1", "output_uncertain");
    expect(await f.t.service.preflight(f.t.token, await f.next())).toMatchObject({ state: "print_blocked", reason: "uncertain" });
    expect(await f.t.pb.collection("checkin_print_attempts").getFullList()).toHaveLength(1);
    await f.recovery({ operation: "observe", printId, outcome: "not_printed" });
    expect(await f.t.service.preflight(f.t.token, await f.next())).toMatchObject({ state: "accepted", requestedPrint: { purpose: "replacement" } });
    expect(f.posts()).toBe(1);
  } finally { await f.close(); }
});

it("authoritative upstream existing arrival prints affiliation without any local admission attempt or POST", async () => {
  const f = await fixture(true);
  try {
    expect(f.first).toMatchObject({ state: "accepted", requestedPrint: { purpose: "initial", state: "queued" } });
    expect(f.affiliation).toHaveBeenCalledOnce();
    expect(await f.t.pb.collection("checkin_arrival_workflows").getOne(f.first.workflow.id)).toMatchObject({ admission_basis: "upstream_existing", state: "accepted", admission_attempt_id: "" });
    expect(await f.r.coordinator.processAdmissions(f.processor)).toBe(0);
    expect(f.posts()).toBe(0);
    expect(await f.t.pb.collection("checkin_arrival_attempts").getFullList()).toHaveLength(0);
    expect((await f.t.pb.collection("checkin_print_attempts").getFullList())[0]).toMatchObject({ affiliation: "Test organisation" });
    await f.settle();
    expect(await f.t.service.preflight(f.t.token, await f.next())).toMatchObject({ state: "accepted", requestedPrint: { purpose: "replacement" } });
    expect(f.posts()).toBe(0);
  } finally { await f.close(); }
});

it("fresh actions revalidate upstream entitlement; unknown local admission wins over upstream-existing evidence", async () => {
  const f = await fixture();
  try {
    await f.r.coordinator.processAdmissions({ ...f.processor, admit: async () => ({ state: "uncertain" }) });
    f.t.source.resolve = async () => ({ state: "eligible", attendee: { upstreamAttendeeId: "501", publicId: "A-ABC1234", productId: "401", name: "Тест Attendee", alreadyCheckedIn: true } });
    // Different QR exercises attendee-ID convergence rather than prior QR path.
    expect(await f.t.service.preflight(f.t.token, { ...await f.next(), qrIdentity: "A-DEF1234" })).toMatchObject({ state: "print_blocked", reason: "uncertain" });
    expect(await f.t.pb.collection("checkin_print_attempts").getFullList()).toHaveLength(0);
  } finally { await f.close(); }
  const g = await fixture();
  try {
    await g.r.coordinator.processAdmissions(g.processor); await g.settle();
    g.t.source.resolve = async () => ({ state: "rejected", reason: "cancelled" });
    expect(await g.t.service.preflight(g.t.token, await g.next())).toMatchObject({ state: "rejected", reason: "cancelled" });
    expect(await g.t.pb.collection("checkin_print_attempts").getFullList()).toHaveLength(1);
    expect(await g.t.service.preflight(g.t.token, g.initial)).toMatchObject({ state: "accepted", replayed: true, requestedPrint: { purpose: "initial", state: "completed" } });
  } finally { await g.close(); }
});
