import { expect, it } from "vite-plus/test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { setup, ready, context } from "./checkin-recovery-test-helper";
import { CheckinRecoveryService } from "./checkin-recovery-service";
import { recoveryWorkflowSchema, recoveryAttemptHistorySchema } from "./checkin-recovery-client-contract";
import type { RecoveryCommand } from "./checkin-recovery-contract";
import type { CheckinStationId } from "./checkin-contract";

const origin = "wts2026station1", destination = "wts2026station2", unrelated = "wts2026station3";
async function fixture() {
  const t = await setup();
  const first = await ready(t); await first.coordinator.listen(); await first.heartbeat();
  try {
    const initial = await t.service.preflight(t.token, { ...t.command(), context: await context(t) });
    if (initial.state !== "reserved") throw new Error("Initial reservation failed");
    const workflowId = initial.workflow.id;
    await first.coordinator.processAdmissions({ attendee: async () => ({ upstreamAttendeeId: "501", publicId: "A-ABC1234", productId: "401", alreadyCheckedIn: false }), admit: async () => ({ state: "newly_checked_in", fingerprint: "d".repeat(64) }) });
    const raw = async (stationId: CheckinStationId, operation: string, payload: object = {}) => {
      const agent = await t.pb.collection("checkin_agents").getFirstListItem(t.pb.filter("station={:station}", { station: stationId }));
      const coordinator = await t.pb.collection("checkin_coordinator").getOne("wts2026coord000");
      return t.pb.send<any>("/api/wts/checkin-agents", { method: "POST", requestKey: null, body: { operation: `machine_${operation}`, owner: coordinator.owner, nowMs: Date.now(), credentialHash: agent.credential_hash, payload: { stationId, ...payload } } });
    };
    const settle = async (stationId: CheckinStationId, outcome = "protocol_complete") => {
      await first.coordinator.claimPrints();
      const print = await t.pb.collection("checkin_print_attempts").getFirstListItem(t.pb.filter("workflow_id={:workflow} && station_id={:station} && (state='queued' || state='dispatched')", { workflow: workflowId, station: stationId }));
      const attempt = await t.pb.collection("checkin_agent_attempts").getFirstListItem(t.pb.filter("print_attempt_id={:print}", { print: print.id }));
      const payload = { attemptId: attempt.id, payloadHash: attempt.payload_hash, authorizationHash: crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "") };
      await raw(stationId, "authorize", payload); await raw(stationId, "start", payload); await raw(stationId, "outcome", { ...payload, outcome });
      return print.id;
    };
    const initialPrint = await settle(origin);
    const frozenAdmission = await t.pb.collection("checkin_arrival_workflows").getOne(workflowId);
    const second = await ready(t, destination, first.coordinator); await second.heartbeat();
    const token = "e".repeat(64); await t.control.bind(second.code, token, (await t.control.preview(second.code)).confirmation);
    const third = await ready(t, unrelated, first.coordinator);
    const foreignToken = "f".repeat(64); await t.control.bind(third.code, foreignToken, (await t.control.preview(third.code)).confirmation);
    const cross = await t.service.preflight(token, { ...t.command(), context: await context(t, token) });
    if (cross.state !== "accepted" || !cross.printIntentId) throw new Error("Cross-printer replacement failed");
    const printId = cross.printIntentId;
    const source = { reconcile: async () => ({ state: "existing" as const, checkinId: "901", fingerprint: "d".repeat(64) }) };
    const operator = new CheckinRecoveryService(t.pb, t.operator.actor, source), admin = new CheckinRecoveryService(t.pb, t.admin.actor, source);
    const command = async (input: object, binding = token, service = operator) => service.command(binding, { operationId: crypto.randomUUID(), workflowId, expectedVersion: (await admin.get(undefined, workflowId)).version, ...input } as RecoveryCommand);
    return { t, first, second, token, foreignToken, workflowId, printId, initialPrint, frozenAdmission, raw, settle, operator, admin, command, close: async () => { await first.coordinator.close(); await t.cleanup(); } };
  } catch (error) { await first.coordinator.close(); await t.cleanup(); throw error; }
}

it("destination recovery/history/preview use actual profile; origin remains immutable and unrelated printers have no access", async () => {
  const f = await fixture(); try {
    const w = await f.operator.get(f.token, f.workflowId);
    expect(w).toMatchObject({ stationId: destination, admissionStationId: origin, printerOperationsAllowed: true, profile: { id: f.second.saved.profile.id, stationId: destination } });
    expect(w.attempts).toMatchObject([{ id: f.initialPrint, stationId: origin }, { id: f.printId, stationId: destination, profileId: f.second.saved.profile.id }]);
    expect(recoveryWorkflowSchema.safeParse(w).success).toBe(true);
    expect((await f.operator.get(f.t.token, f.workflowId)).printerOperationsAllowed).toBe(false);
    for (const token of [f.token, f.t.token]) expect((await f.operator.history(token)).items.map(w => w.workflowId)).toEqual([f.workflowId]);
    expect((await f.operator.history(f.foreignToken)).items).toEqual([]);
    await expect(f.operator.get(f.foreignToken, f.workflowId)).rejects.toMatchObject({ status: 403 });
    await expect(f.operator.attemptHistory(f.foreignToken, f.workflowId)).rejects.toMatchObject({ status: 403 });
    const page = await f.operator.attemptHistory(f.token, f.workflowId);
    expect(recoveryAttemptHistorySchema.safeParse(page).success).toBe(true);
    expect(page.items.map(a => a.stationId)).toEqual([origin, destination]);
    expect((await f.operator.preview(f.token, f.workflowId, w.name, w.affiliation)).pngBase64).toMatch(/^iVBOR/);
    expect(await f.t.pb.collection("checkin_arrival_workflows").getOne(f.workflowId)).toEqual(f.frozenAdmission);
    expect(f.t.logs()).toContain("json_group_array");
    expect(f.t.logs()).toContain("LIMIT 100 OFFSET");
  } finally { await f.close(); }
});

it("wrong destination denies all physical recovery commands even for admins; actual destination can observe and replace", async () => {
  const f = await fixture(); try {
    await f.settle(destination, "output_uncertain");
    const actions = [{ operation: "observe", printId: f.printId, outcome: "not_printed" }, { operation: "replace", printId: f.printId }, { operation: "handwrite", physicallyIsolated: true }, { operation: "release_isolation", confirmed: true }];
    const before = await f.admin.get(undefined, f.workflowId);
    for (const service of [f.operator, f.admin]) for (const action of actions) await expect(f.command(action, f.t.token, service)).rejects.toMatchObject({ status: 403 });
    expect(await f.admin.get(undefined, f.workflowId)).toEqual(before);
    expect(await f.t.pb.collection("checkin_recovery_isolations").getFullList()).toEqual([]);
    await expect(f.command(actions[1]!)).rejects.toMatchObject({ status: 409 });
    await f.command(actions[0]!);
    const replacement = await f.command(actions[1]!);
    const next = replacement.workflow.attempts.at(-1)!;
    expect(next).toMatchObject({ stationId: destination, profileId: f.second.saved.profile.id, predecessorId: f.printId });
    expect(await f.t.pb.collection("checkin_print_attempts").getOne(next.id)).toMatchObject({ station_id: destination, profile_snapshot: before.profile });
    expect(await f.t.pb.collection("checkin_arrival_workflows").getOne(f.workflowId)).toEqual(f.frozenAdmission);
    expect(await f.t.pb.collection("checkin_arrival_attempts").getFullList()).toHaveLength(1);
  } finally { await f.close(); }
});

it("cancel reaches only the actual printer and cannot be acknowledged by the admission printer", async () => {
  const f = await fixture(); try {
    await f.first.coordinator.claimPrints();
    await expect(f.command({ operation: "cancel", reason: "incident", note: "" })).rejects.toMatchObject({ status: 403 });
    await f.command({ operation: "cancel", reason: "incident", note: "" }, f.t.token, f.admin);
    expect((await f.raw(origin, "cancellations")).cancellations).toEqual([]);
    const items = (await f.raw(destination, "cancellations")).cancellations;
    expect(items).toHaveLength(1);
    const c = items[0];
    expect(await f.t.pb.collection("checkin_recovery_cancellations").getOne(c.cancellationId)).toMatchObject({ station_id: destination, print_id: f.printId, state: "pending" });
    const payload = { cancellationId: c.cancellationId, attemptId: c.work.attemptId, payloadHash: c.work.payloadHash, disposition: "neutralized" };
    await expect(f.raw(origin, "neutralized", payload)).rejects.toMatchObject({ status: 403 });
    await f.raw(destination, "neutralized", payload);
    expect(await f.admin.get(undefined, f.workflowId)).toMatchObject({ decision: "cancelled", fulfillment: "cancelled" });
  } finally { await f.close(); }
});

it("handwriting isolation/release affects only latest printer and preserves cancellation acknowledgement guards", async () => {
  const f = await fixture(); try {
    await f.first.coordinator.claimPrints();
    expect((await f.command({ operation: "handwrite", physicallyIsolated: true })).workflow).toMatchObject({ isolated: true, fulfillment: "handwrite_pending" });
    const isolations = await f.t.pb.collection("checkin_recovery_isolations").getFullList();
    expect(isolations).toHaveLength(1); expect(isolations[0]).toMatchObject({ station_id: destination });
    expect((await f.command({ operation: "handwrite", physicallyIsolated: true })).workflow.fulfillment).toBe("handwritten");
    await expect(f.command({ operation: "release_isolation", confirmed: true })).rejects.toMatchObject({ status: 409 });
    const c = (await f.raw(destination, "cancellations")).cancellations[0];
    await f.raw(destination, "neutralized", { cancellationId: c.cancellationId, attemptId: c.work.attemptId, payloadHash: c.work.payloadHash, disposition: "neutralized" });
    expect((await f.command({ operation: "release_isolation", confirmed: true })).workflow.isolated).toBe(false);
    expect((await f.t.pb.collection("checkin_recovery_isolations").getOne(isolations[0]!.id)).released_at).toBeTruthy();
    expect(await f.t.pb.collection("checkin_arrival_workflows").getOne(f.workflowId)).toEqual(f.frozenAdmission);
  } finally { await f.close(); }
});

it("authoritative latest pointer wins default window ties without reordering explicit history pages", async () => {
  const f = await fixture(); try {
    // Test-only historical timestamp adjustment, never weaken production hooks.
    const db = new DatabaseSync(join(f.t.root, "pb_data/data.db"));
    try { db.prepare("UPDATE checkin_print_attempts SET created=? WHERE id=?").run("2020-01-01 00:00:00.000Z", f.printId); } finally { db.close(); }
    const current = await f.operator.get(f.token, f.workflowId);
    expect(current.attempts.at(-1)!.id).toBe(f.printId);
    expect(current.stationId).toBe(destination);
    expect((await f.operator.attemptHistory(f.token, f.workflowId)).items.map(p => p.id)).toEqual([f.printId, f.initialPrint]);
    expect((await f.command({ operation: "handwrite", physicallyIsolated: false })).workflow.fulfillment).toBe("handwrite_pending");
  } finally { await f.close(); }
});

it("local physical isolation never resolves unobserved terminal output from a foreign printer", async () => {
  const f = await fixture(); try {
    const db = new DatabaseSync(join(f.t.root, "pb_data/data.db"));
    try {
      db.prepare("UPDATE checkin_print_attempts SET state='uncertain' WHERE id=?").run(f.initialPrint);
      db.prepare("UPDATE checkin_agent_authorizations SET outcome='output_uncertain' WHERE attempt_id=(SELECT id FROM checkin_agent_attempts WHERE print_attempt_id=?)").run(f.initialPrint);
    } finally { db.close(); }
    await f.command({ operation: "handwrite", physicallyIsolated: true });
    expect((await f.command({ operation: "handwrite", physicallyIsolated: true })).workflow.fulfillment).toBe("handwrite_pending");
    expect((await f.t.pb.collection("checkin_recovery_isolations").getFullList()).map(i => i.station_id)).toEqual([destination]);
    expect((await f.t.pb.collection("checkin_recovery_cancellations").getFullList()).every(c => c.state === "acknowledged")).toBe(true);
  } finally { await f.close(); }
});

it("local physical isolation never bypasses a foreign printer cancellation still pending", async () => {
  const f = await fixture(); try {
    await f.first.coordinator.claimPrints();
    // Simulate a legacy overlapping attempt using the existing disposable SQL fixture seam.
    // This intentionally violates new creation eligibility to exercise defense in depth.
    const db = new DatabaseSync(join(f.t.root, "pb_data/data.db"));
    try {
      const attempt = db.prepare("SELECT id FROM checkin_agent_attempts WHERE print_attempt_id=?").get(f.initialPrint) as { id: string };
      db.prepare("DELETE FROM checkin_agent_authorizations WHERE attempt_id=?").run(attempt.id);
    } finally { db.close(); }
    await f.command({ operation: "handwrite", physicallyIsolated: true });
    expect((await f.command({ operation: "handwrite", physicallyIsolated: true })).workflow.fulfillment).toBe("handwrite_pending");
    const cancellations = await f.t.pb.collection("checkin_recovery_cancellations").getFullList();
    expect(cancellations.map(c => c.station_id).sort()).toEqual([origin, destination]);
    expect(cancellations.every(c => c.state === "pending")).toBe(true);
    expect((await f.t.pb.collection("checkin_recovery_isolations").getFullList()).map(i => i.station_id)).toEqual([destination]);
  } finally { await f.close(); }
});
