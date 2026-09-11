import { expect, it, vi } from "vite-plus/test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { setup, ready, context } from "./checkin-recovery-test-helper";
import { CheckinRecoveryService } from "./checkin-recovery-service";
import { handleCheckinRecoveryRequest } from "./checkin-recovery-http";
import { recoveryResultSchema, recoveryWorkflowSchema } from "./checkin-recovery-client-contract";
import { CheckinReadError } from "./checkin-upstream-read";

it("owning operator grants one audited safe-read budget through recovery HTTP; lost response replay never grants another", async () => {
  const t = await setup(); const runtime = await ready(t);
  const source = { reconcile: vi.fn(async () => ({ state: "unavailable" as const })) };
  const http = (body: unknown, token = t.token, admin = false) => handleCheckinRecoveryRequest(new Request("https://wts.test/api/checkin-recovery", {
    method: "POST", headers: { origin: "https://wts.test", "content-type": "application/json", cookie: `wts_checkin_client=${token}` }, body: JSON.stringify(body),
  }), { authenticate: async () => ({ id: admin ? t.admin.actor.userId : t.operator.actor.userId, role: admin ? "admin" : "checkin_operator" }), service: async actor => new CheckinRecoveryService(t.pb, { userId: actor.id, role: actor.role }, source) });
  const sql = (query: string) => { const db = new DatabaseSync(join(t.root, "pb_data/data.db")); try { db.exec(query); } finally { db.close(); } };
  const attendee = vi.fn(async () => { throw new CheckinReadError("transport"); });
  const admit = vi.fn(async () => { throw new Error("POST forbidden"); });
  try {
    await runtime.coordinator.listen(); await runtime.heartbeat();
    const reserved = await t.service.preflight(t.token, { ...t.command(), context: await context(t) });
    if (reserved.state !== "reserved") throw new Error("Expected reservation");
    const workflowId = reserved.workflow.id;
    const get = async () => recoveryWorkflowSchema.parse(await (await http({ operation: "get", workflowId })).json());
    const command = { operation: "retry_admission_reads", operationId: crypto.randomUUID(), workflowId, expectedVersion: 0 };
    const send = (value = command, token = t.token, admin = false) => http({ operation: "command", command: value }, token, admin);
    expect((await get()).admissionReadRetryEligible).toBe(false);
    expect((await send()).status).toBe(409);
    async function exhaust() {
      for (let i = 0; i < 3; i++) {
        sql("UPDATE checkin_arrival_attempts SET next_retry_at = ''");
        await runtime.heartbeat();
        await runtime.coordinator.processAdmissions({ attendee, admit }, 1);
      }
      expect(await runtime.coordinator.claimAdmission()).toBeNull();
    }
    await exhaust();
    expect((await get()).admissionReadRetryEligible).toBe(true);
    expect((await send({ ...command, expectedVersion: 1 })).status).toBe(409);
    // Audit failure must roll the budget, version and command receipt back together.
    sql("CREATE TRIGGER reject_retry_audit BEFORE INSERT ON checkin_recovery_audit BEGIN SELECT RAISE(ABORT, 'synthetic audit outage'); END");
    expect((await send()).status).toBe(400);
    expect((await get()).admissionReadRetryEligible).toBe(true);
    expect(await t.pb.collection("checkin_recovery_commands").getFullList()).toHaveLength(0);
    expect(await t.pb.collection("checkin_recovery_workflows").getFullList()).toHaveLength(0);
    expect((await t.pb.collection("checkin_arrival_attempts").getFullList())[0].pre_send_failures).toBe(3);
    sql("DROP TRIGGER reject_retry_audit");
    const [first, duplicate] = await Promise.all([send(), send()]);
    expect(first.status).toBe(200); expect(duplicate.status).toBe(200);
    const receipts = [recoveryResultSchema.parse(await first.json()), recoveryResultSchema.parse(await duplicate.json())];
    expect(receipts.map(r => r.replayed).sort()).toEqual([false, true]);
    expect(receipts[0].commandId).toBe(receipts[1].commandId);
    expect(receipts[0].workflow).toMatchObject({ admissionState: "not_submitted", version: 1, admissionReadRetryEligible: false, attempts: [] });
    let attempt = (await t.pb.collection("checkin_arrival_attempts").getFullList())[0];
    expect(attempt).toMatchObject({ state: "pre_send_failed", pre_send_failures: 0, send_boundary_at: "" });
    const ledger = (await t.pb.collection("checkin_recovery_commands").getFullList())[0];
    expect(ledger.result).toMatchObject({ operation: command.operation, commandVersion: 1, workflowId });
    expect(ledger.result).not.toHaveProperty("workflow");
    expect(Buffer.byteLength(JSON.stringify(ledger.result))).toBeLessThan(1024);
    const audit = await t.pb.collection("checkin_recovery_audit").getFullList();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ operation: command.operation, command_id: ledger.id, actor_id: t.operator.actor.userId, station_id: "wts2026station1", before: { admissionReadRetryEligible: true }, after: { admissionReadRetryEligible: false } });
    // Simulate a committed response lost to the caller, then consume the renewed budget.
    await exhaust();
    const replay = recoveryResultSchema.parse(await (await send()).json());
    expect(replay).toMatchObject({ replayed: true, commandId: ledger.id, commandVersion: 1, workflow: { admissionReadRetryEligible: true } });
    attempt = await t.pb.collection("checkin_arrival_attempts").getOne(attempt.id);
    expect(attempt.pre_send_failures).toBe(3);
    expect(await runtime.coordinator.claimAdmission()).toBeNull();
    expect((await t.pb.collection("checkin_recovery_commands").getOne(ledger.id)).result).toEqual(ledger.result);
    expect(await t.pb.collection("checkin_recovery_audit").getFullList()).toHaveLength(1);
    // Foreign active binding, absent binding, and revoked original binding cannot
    // grant OR replay, even for an admin. Admin global evidence is read-only here.
    const stationId = "wts2026station2";
    const foreignCode = (await t.control.adminControl({ operation: "rotate_provision_code", operationId: crypto.randomUUID(), expectedVersion: 1, stationId, reason: "configuration" })).provisionCode!;
    await t.control.adminControl({ operation: "set_station_enabled", operationId: crypto.randomUUID(), expectedVersion: 2, stationId, enabled: true, reason: "configuration" });
    const foreign = "e".repeat(64);
    await t.control.bind(foreignCode, foreign, (await t.control.preview(foreignCode)).confirmation);
    const next = { ...command, operationId: crypto.randomUUID(), expectedVersion: 1 };
    for (const value of [command, next]) for (const token of [foreign, "f".repeat(64)]) for (const admin of [false, true]) expect((await send(value, token, admin)).status).toBe(403);
    const foreignEvidence = recoveryWorkflowSchema.parse(await (await http({ operation: "get", workflowId }, foreign, true)).json());
    expect(foreignEvidence.admissionReadRetryEligible).toBe(false);
    sql("UPDATE checkin_bindings SET revoked=1 WHERE station='wts2026station1'");
    expect((await send()).status).toBe(403);
    sql("UPDATE checkin_bindings SET revoked=0 WHERE station='wts2026station1'");
    // Both public schemas and the privileged hook reject injected authority fields.
    expect((await http({ operation: "command", command: { ...next, pre_send_failures: 0 } })).status).toBe(400);
    await expect(t.pb.send("/api/wts/checkin-recovery", { method: "POST", body: { operation: "command", actorUserId: t.operator.actor.userId, identityHash: (await import("./checkin-event-service")).checkinEventBindingHash(t.token), command: { ...next, pre_send_failures: 0 } } })).rejects.toMatchObject({ status: 400 });
    // An old UUID with changed payload cannot masquerade as a new grant.
    expect((await send({ ...command, expectedVersion: 1 })).status).toBe(409);
    // Test even inconsistent persisted evidence: a boundary is never cleared.
    for (const update of [
      "UPDATE checkin_arrival_workflows SET state='admission_pending'",
      "UPDATE checkin_arrival_workflows SET state='admission_uncertain'",
      "UPDATE checkin_arrival_workflows SET state='accepted'",
      "UPDATE checkin_arrival_attempts SET state='possibly_sent'",
      "UPDATE checkin_arrival_attempts SET send_boundary_at='2026-09-11T00:00:00.000Z'",
      "UPDATE checkin_arrival_attempts SET pre_send_failures=2",
      "UPDATE checkin_recovery_workflows SET decision='cancelled'",
      "UPDATE checkin_recovery_workflows SET decision='reset_pending'",
      "UPDATE checkin_lifecycle SET closed_at='2026-09-11T00:00:00.000Z'",
      "UPDATE checkin_lifecycle SET restore_required=1",
    ]) {
      sql(update);
      expect((await get()).admissionReadRetryEligible, update).toBe(false);
      expect((await send(next)).status, update).toBe(409);
      sql("UPDATE checkin_arrival_workflows SET state='not_submitted'; UPDATE checkin_arrival_attempts SET state='pre_send_failed',pre_send_failures=3,send_boundary_at=''; UPDATE checkin_recovery_workflows SET decision=''; UPDATE checkin_lifecycle SET closed_at='',restore_required=0");
    }
    // A fresh explicit UUID after another exhaustion grants exactly one budget.
    expect((await send(next)).status).toBe(200);
    expect((await send({ ...next, operationId: crypto.randomUUID(), expectedVersion: 2 })).status).toBe(409);
    expect(await t.pb.collection("checkin_recovery_audit").getFullList()).toHaveLength(2);
    // Real restart enters restore-required mode. Receipt replay stays read-only;
    // no newly eligible retry or admission claim is created by restart/replay.
    await runtime.coordinator.close(); await t.restart();
    expect((await get()).admissionReadRetryEligible).toBe(false);
    const restartedReplay = recoveryResultSchema.parse(await (await send()).json());
    expect(restartedReplay).toMatchObject({ replayed: true, commandId: ledger.id, commandVersion: 1, workflow: { version: 2 } });
    expect((await t.pb.collection("checkin_arrival_attempts").getOne(attempt.id)).pre_send_failures).toBe(0);
    expect((await t.pb.collection("checkin_recovery_commands").getOne(ledger.id)).result).toEqual(ledger.result);
    expect(attendee).toHaveBeenCalledTimes(6); expect(admit).not.toHaveBeenCalled(); expect(source.reconcile).not.toHaveBeenCalled();
    expect(await t.pb.collection("checkin_print_attempts").getFullList()).toHaveLength(0);
  } finally { await runtime.coordinator.close(); await t.cleanup(); }
}, 60000);
