import { expect, it } from "vite-plus/test";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { startCheckinPocketBase } from "./checkin-pocketbase-test-helper";
import { Coordinator } from "../../runtime/checkin/coordinator";
import { CheckinService } from "./checkin-service";
import { CheckinAgentService } from "./checkin-agent-service";
import { CheckinLabelProfileService } from "./checkin-label-profile-service";
import { SYNTHETIC_LABEL_CONFIG } from "./checkin-label-render-contract";
import { CheckinLifecycleService } from "./checkin-lifecycle-service";
async function ready() {
  const f = await startCheckinPocketBase();
  const admin = await f.user("admin", "Test Operator");
  const human = new CheckinService(f.pb, admin.actor);
  const agents = new CheckinAgentService(f.pb, admin.actor);
  const profiles = new CheckinLabelProfileService(f.pb, admin.actor);
  const stationId = "wts2026station1" as const;
  await human.adminControl({ operation: "configure_station", operationId: crypto.randomUUID(), expectedVersion: 1, stationId, label: "Test", location: "Test", printerRef: "test-printer", reason: "configuration" });
  await human.adminControl({ operation: "set_station_enabled", operationId: crypto.randomUUID(), expectedVersion: 2, stationId, enabled: true, reason: "configuration" });
  await human.adminControl({ operation: "set_system_enabled", operationId: crypto.randomUUID(), expectedVersion: 1, enabled: true, reason: "configuration" });
  const config = { ...SYNTHETIC_LABEL_CONFIG, synthetic: false, printerRef: "test-printer", stockRef: "test-stock" };
  const profile = await profiles.configure({ operationId: crypto.randomUUID(), stationId, expectedVersion: 0, expectedStationVersion: 3, reason: "configuration", note: "Test only", config });
  await profiles.approve({ operationId: crypto.randomUUID(), profileId: profile.profile.id, expectedVersion: 1, expectedStationVersion: 3, reason: "configuration", note: "Test-only attestation, not actual calibration", physicalConfirmation: true });
  const identity = { stationId, agentIdentity: "test-pi", printerIdentity: "test-printer", journalIdentity: "test-journal", profileId: profile.profile.id };
  const issue = { ...identity, operationId: crypto.randomUUID(), expectedStationVersion: 3, reason: "configuration" as const, note: "Test only", credentialLifetimeHours: 1 };
  const issued = await agents.issue(issue);
  let now = Date.now();
  const coordinator = new Coordinator(f.pb, { now: () => now });
  const url = await coordinator.listen();
  const heartbeat = { ...identity, protocolGeneration: 1, schemaGeneration: 1, journalSequence: 1, journalDigest: "a".repeat(64), journalState: "healthy" };
  await coordinator.machine(issued.credential!, "heartbeat", heartbeat);
  return { ...f, admin, human, agents, profiles, config, identity, issue, issued, stationId, coordinator, url, heartbeat, advance: (ms: number) => { now += ms; }, clock: () => now, cleanup: async () => { await coordinator.close(); await f.cleanup(); } };
}

it("records original started print outcomes across close and replacement, but never new starts or post-purge reports", async () => {
  const f = await ready();
  try {
    const c = f.coordinator, credential = f.issued.credential!, stationId = f.stationId;
    const work = await c.prepareAttempt(f.issued.station.agentId!, "b".repeat(64));
    const second = await c.prepareAttempt(f.issued.station.agentId!, "d".repeat(64));
    const p = { stationId, attemptId: work.attemptId, payloadHash: work.payloadHash, authorizationHash: "c".repeat(64) };
    const unstarted = { ...p, attemptId: second.attemptId, payloadHash: second.payloadHash, authorizationHash: "a".repeat(64) };
    await c.machine(credential, "authorize", p);
    await c.machine(credential, "authorize", unstarted);
    await c.machine(credential, "start", p);
    const service = new CheckinLifecycleService(f.pb, f.admin.actor);
    const closed = await service.close({ operationId: crypto.randomUUID(), confirmEdition: "WTS2026" });
    const outcome = { stationId, attemptId: p.attemptId, authorizationHash: p.authorizationHash, outcome: "protocol_complete" };
    await expect(c.machine(credential, "start", unstarted)).rejects.toThrow();
    await expect(c.machine(credential, "outcome", { ...outcome, authorizationHash: "e".repeat(64) })).rejects.toThrow();
    expect(await c.machine(credential, "outcome", outcome)).toMatchObject({ outcome: "protocol_complete" });
    await c.close();
    const replacement = new Coordinator(f.pb, { now: f.clock }); await replacement.listenReportingOnly();
    try {
      expect(await replacement.machine(credential, "outcome", outcome)).toMatchObject({ outcome: "protocol_complete" });
      await expect(replacement.machine(credential, "outcome", { ...outcome, attemptId: second.attemptId })).rejects.toThrow();
      await expect(replacement.machine(credential, "start", unstarted)).rejects.toThrow();
      await expect(replacement.prepareAttempt(f.issued.station.agentId!, "f".repeat(64))).rejects.toThrow();
      expect((await f.pb.collection("checkin_agent_authorizations").getFullList({ filter: `attempt_id='${work.attemptId}'` }))[0].outcome).toBe("protocol_complete");
      await f.pb.send("/api/wts/checkin-lifecycle-worker", { method: "POST", body: { operation: "tick", nowMs: Date.parse(closed.purgeDeadline!) } });
      await expect(replacement.machine(credential, "outcome", outcome)).rejects.toThrow();
      expect(await f.pb.collection("checkin_agent_authorizations").getFullList()).toHaveLength(0);
    } finally { await replacement.close(); }
  } finally { await f.cleanup(); }
});
it.each([false, true])("binds delayed admission evidence to its original owner without closed-edition printing (first report after replacement: %s)", async (reportAfterReplacement) => {
  const f = await ready();
  try {
    const runtime = await f.pb.collection("checkin_coordinator").getOne("wts2026coord000");
    const owner = runtime.owner;
    const send = (body: object) => f.pb.send<any>("/api/wts/checkin-arrivals", { method: "POST", body: { owner, nowMs: f.clock(), ...body }, requestKey: null });
    // Synthetic reserved snapshot, not a real attendee or external admission.
    // Claims, send boundaries, closure and results all run through real hooks.
    const db = new DatabaseSync(join(f.root, "pb_data", "data.db"));
    try {
      db.prepare("INSERT INTO checkin_arrival_commands (id,operation_id,status,actor_user_id,station_id,context) VALUES (?,?,?,?,?,?)").run("latecommand0001", crypto.randomUUID(), "final", f.admin.actor.userId, f.stationId, "{}");
      db.prepare("INSERT INTO checkin_arrival_workflows (id,operation_id,station_id,state,name) VALUES (?,?,?,?,?)").run("lateworkflow001", db.prepare("SELECT operation_id FROM checkin_arrival_commands WHERE id=?").get("latecommand0001")!.operation_id, f.stationId, "not_submitted", "Synthetic Late Attendee");
      db.prepare("UPDATE checkin_arrival_commands SET payload_hash=?,qr_hash=?,source_key=?,affiliation_choice='fetch',event_id='syntheticevent1'").run("a".repeat(64), "b".repeat(64), "c".repeat(64));
      db.prepare("UPDATE checkin_arrival_workflows SET edition='WTS2026',upstream_event_id='101',upstream_attendee_id='501',event_id='syntheticevent1',event_title='Synthetic',list_id='201',source_key=?,profile_id=?").run("c".repeat(64), f.identity.profileId);
    } finally { db.close(); }
    const { job } = await send({ operation: "machine_admission_claim" }); expect(job).toBeTruthy();
    const claimed = await f.pb.collection("checkin_arrival_attempts").getOne(job.attemptId);
    expect(claimed.claim_owner_hash).toBe(createHash("sha256").update(owner).digest("hex"));
    expect(claimed.outcome_digest).toBe("");
    await expect(send({ operation: "machine_admission_result", attemptId: job.attemptId, outcome: { state: "newly_checked_in", fingerprint: "e".repeat(64) } })).rejects.toThrow();
    await expect(send({ operation: "machine_admission_fence", owner: "f".repeat(64), attemptId: job.attemptId, coordinatorGeneration: job.coordinatorGeneration })).rejects.toThrow();
    await expect(send({ operation: "machine_admission_fence", attemptId: job.attemptId, coordinatorGeneration: job.coordinatorGeneration + 1 })).rejects.toThrow();
    await send({ operation: "machine_admission_fence", attemptId: job.attemptId, coordinatorGeneration: job.coordinatorGeneration });
    const service = new CheckinLifecycleService(f.pb, f.admin.actor);
    const closed = await service.close({ operationId: crypto.randomUUID(), confirmEdition: "WTS2026" });
    const result = { operation: "machine_admission_result", attemptId: job.attemptId, outcome: { state: "newly_checked_in", fingerprint: "e".repeat(64) } };
    await expect(send({ ...result, owner: "f".repeat(64) })).rejects.toThrow();
    await expect(send({ operation: "machine_admission_fence", attemptId: job.attemptId, coordinatorGeneration: job.coordinatorGeneration })).rejects.toThrow();
    if (!reportAfterReplacement) expect(await send(result)).toMatchObject({ state: "accepted" });
    await f.coordinator.close();
    const replacement = new Coordinator(f.pb, { now: f.clock }); await replacement.listenReportingOnly();
    try {
      const newOwner = (await f.pb.collection("checkin_coordinator").getOne("wts2026coord000")).owner;
      expect(newOwner).toBe(""); // Replacement gateway cannot reacquire a closed producer.
      await expect(send({ ...result, owner: newOwner })).rejects.toThrow();
      expect(await send(result)).toMatchObject({ state: "accepted" });
      expect(await send(result)).toMatchObject({ state: "accepted" });
      expect((await f.pb.collection("checkin_arrival_workflows").getOne(job.workflowId))).toMatchObject({ state: "accepted", print_intent_id: "" });
      expect(await f.pb.collection("checkin_print_attempts").getFullList()).toHaveLength(0);
      expect(await f.pb.collection("checkin_audit_events").getFullList({ filter: `operation='admission_result' && workflow_id='${job.workflowId}'` })).toHaveLength(1);
      await expect(send({ ...result, outcome: { state: "uncertain" } })).rejects.toThrow();
      await expect(send({ ...result, nowMs: Date.parse(closed.purgeDeadline!) })).rejects.toThrow();
      expect(await f.pb.collection("checkin_arrival_attempts").getFullList()).toHaveLength(1);
      await expect(send({ operation: "machine_admission_claim", owner: newOwner })).rejects.toThrow();
      await f.pb.send("/api/wts/checkin-lifecycle-worker", { method: "POST", body: { operation: "tick", nowMs: Date.parse(closed.purgeDeadline!) } });
      await expect(send(result)).rejects.toThrow();
      expect(await f.pb.collection("checkin_arrival_attempts").getFullList()).toHaveLength(0);
      expect(await f.pb.collection("checkin_audit_events").getFullList()).toHaveLength(0);
    } finally { await replacement.close(); }
  } finally { await f.cleanup(); }
});
