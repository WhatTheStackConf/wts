import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { startCheckinPocketBase } from "./checkin-pocketbase-test-helper";
import { CheckinLifecycleService } from "./checkin-lifecycle-service";
import { CheckinService } from "./checkin-service";

it("purges real persisted rows at deadline, preserves guards and binds offline receipts", async () => {
  const f = await startCheckinPocketBase();
  const tables = ["checkin_agent_authorizations", "checkin_agent_attempts", "checkin_print_attempts", "checkin_arrival_attempts", "checkin_arrival_commands", "checkin_arrival_workflows", "checkin_audit_events"];
  const worker = (body: object) => f.pb.send<any>("/api/wts/checkin-lifecycle-worker", { method: "POST", body, requestKey: null });
  try {
    const admin = await f.user("admin"); const service = new CheckinLifecycleService(f.pb, admin.actor);
    // At-rest corruption/restore fixture injection only. ALL feature/ledger hooks
    // remain installed; their HTTP deletion and mutation guards are tested below.
    const db = new DatabaseSync(join(f.root, "pb_data", "data.db"));
    try {
      for (const table of tables) db.prepare(`INSERT INTO ${table} (id) VALUES (?)`).run("syntheticrow001");
      db.prepare("UPDATE checkin_arrival_workflows SET name=?, upstream_attendee_id=?, state=?").run("Synthetic Attendee Secret", "123", "admission_uncertain");
      db.prepare("INSERT INTO checkin_agents (id,station,journal_identity,credential_hash) VALUES (?,?,?,?)").run("syntheticagent1", "wts2026station1", "journal-test", "c".repeat(64));
    } finally { db.close(); }
    await expect(f.pb.collection("checkin_agent_attempts").delete("syntheticrow001")).rejects.toMatchObject({ status: 403 });
    const closed = await service.close({ operationId: crypto.randomUUID(), confirmEdition: "WTS2026" });
    const nowMs = Date.parse(closed.purgeDeadline!);
    const bound = { credentialHash: "c".repeat(64), stationId: "wts2026station1" };
    const policy = await worker({ operation: "device_policy", ...bound, nowMs: nowMs - 1 });
    expect(policy).toMatchObject({ mode: "purge_only", journalIdentity: "journal-test", completed: false });
    await expect(worker({ operation: "device_complete", ...bound, nowMs: nowMs - 1, ...policy, method: "retired_and_compacted" })).rejects.toMatchObject({ status: 400 });
    expect((await worker({ operation: "tick", nowMs: nowMs - 1 })).centralDeletedAt).toBeNull();
    expect(await f.pb.collection("checkin_arrival_workflows").getFullList()).toHaveLength(1);
    const purged = await worker({ operation: "tick", nowMs }).catch(error => { console.error(f.logs(), error.response); throw error; });
    expect(purged.totals).toEqual({ workflows: 1, prints: 1 });
    for (const table of tables) expect(await f.pb.collection(table).getFullList()).toHaveLength(0);
    expect((await worker({ operation: "tick", nowMs: nowMs + 1000 })).centralDeletedAt).toBe(purged.centralDeletedAt);
    await expect(f.pb.collection("checkin_arrival_workflows").create({ id: "lateattendee001" })).rejects.toThrow();
    expect((await worker({ operation: "compact", nowMs })).centralCompactedAt).toBeTruthy();
    const control = new CheckinService(f.pb, admin.actor);
    const delayed = { operation: "set_system_enabled" as const, enabled: false, operationId: crypto.randomUUID(), expectedVersion: (await f.pb.collection("checkin_system").getOne("wts2026system00")).version, reason: "maintenance" as const, note: "Synthetic Attendee private note" };
    for (const command of [delayed, delayed, { ...delayed, operationId: crypto.randomUUID() }]) await expect(control.adminControl(command)).rejects.toThrow();
    expect(await f.pb.collection("checkin_audit_events").getFullList()).toHaveLength(0);
    expect(await f.pb.collection("admin_actions").getFullList({ filter: "target_collection~'checkin_'" })).toHaveLength(0);
    expect((await worker({ operation: "tick", nowMs: nowMs + 1000 })).centralDeletedAt).toBe(purged.centralDeletedAt);
    await expect(worker({ operation: "device_complete", ...bound, nowMs, ...policy, purgeToken: "wrong", method: "retired_and_compacted" })).rejects.toMatchObject({ status: 400 });
    await expect(worker({ operation: "device_complete", ...bound, nowMs, ...policy, journalIdentity: "foreign", method: "retired_and_compacted" })).rejects.toMatchObject({ status: 400 });
    const receipt = { operation: "device_complete", ...bound, nowMs, ...policy, method: "retired_and_compacted" };
    expect((await worker(receipt)).completed).toBe(true);
    expect((await worker(receipt)).completed).toBe(true);
    expect(await f.pb.collection("checkin_lifecycle_audit").getFullList({ filter: "operation='device_retired'" })).toHaveLength(1);
    await f.restart();
    expect((await service.status()).purgeDeadline).toBe(closed.purgeDeadline);
    expect((await service.status()).devices.some(d => d.completedAt === null)).toBe(true);
  } finally { await f.cleanup(); }
});
it("requires current restore evidence and approval, never implicitly enabling or replaying", async () => {
  const f = await startCheckinPocketBase();
  try {
    const admin = await f.user("admin"); const service = new CheckinLifecycleService(f.pb, admin.actor);
    await f.restart();
    const status = await service.status(); expect(status.restoreRequired).toBe(true);
    const command = { generation: status.restoreGeneration, confirmEdition: "WTS2026" as const };
    await expect(service.approveRestore(command)).rejects.toMatchObject({ status: 409 });
    const body = { operation: "reconcile_restore", generation: status.restoreGeneration, evidenceDigest: "e".repeat(64), identitiesReconciled: true, hiEventsReconciled: true, unresolved: 0 };
    await f.pb.send("/api/wts/checkin-lifecycle-worker", { method: "POST", body });
    await f.restart();
    await expect(service.approveRestore(command)).rejects.toMatchObject({ status: 409 });
    const latest = await service.status();
    await f.pb.send("/api/wts/checkin-lifecycle-worker", { method: "POST", body: { ...body, generation: latest.restoreGeneration } });
    const approval = { ...command, generation: latest.restoreGeneration };
    const approved = await service.approveRestore(approval);
    expect(approved.restoreRequired).toBe(false);
    expect(await service.approveRestore(approval)).toEqual(approved);
    expect(await f.pb.collection("checkin_lifecycle_audit").getFullList({ filter: "operation='approve_restore'" })).toHaveLength(1);
    expect((await f.pb.collection("checkin_stations").getFullList()).every(s => !s.enabled)).toBe(true);
    await service.close({ operationId: crypto.randomUUID(), confirmEdition: "WTS2026" });
    await expect(service.approveRestore(approval)).rejects.toMatchObject({ status: 409 });
    expect((await f.pb.collection("checkin_system").getOne("wts2026system00")).enabled).toBe(false);
  } finally { await f.cleanup(); }
});
