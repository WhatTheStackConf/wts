import { expect, it } from "vite-plus/test";
import { join } from "node:path";
import { setup, ready, context } from "./checkin-recovery-test-helper";
import { CheckinRecoveryService } from "./checkin-recovery-service";
import { CheckinAgentService } from "./checkin-agent-service";
import { AgentJournal } from "../../runtime/checkin/journal";
import { AgentRuntime, HttpAgentTransport } from "../../runtime/checkin/agent";
import type { AgentIdentity } from "../../runtime/checkin/protocol";

it("real PB denies an authorized stale generation before physical output", async () => {
  const f = await provision();
  try {
    await f.agent.authorize(f.work);
    const station = await f.t.pb.collection("checkin_stations").getOne(f.identity.stationId);
    await f.t.control.adminControl({ operation: "set_station_enabled", operationId: crypto.randomUUID(), stationId: f.identity.stationId, expectedVersion: station.version, enabled: false, reason: "incident" });
    await expect(f.agent.start(f.work.attemptId)).rejects.toThrow();
    expect(f.journal.get(f.work.attemptId)?.state).toBe("possibly_starting");
    await expect(f.agent.start(f.work.attemptId)).rejects.toThrow("start_blocked");
    expect((await f.t.pb.collection("checkin_agent_authorizations").getFullList())[0].started_at).toBe("");
  } finally { f.journal.close(); await f.r.coordinator.close(); await f.t.cleanup(); }
}, 20000);
it("real PB reset worker fences the exact DELETE identity and never retries a lost external response", async () => {
  const f = await provision();
  try {
    await f.agent.process(f.work, { printerIdentity: "test-printer", print: async () => undefined });
    const system = await f.t.pb.collection("checkin_system").getOne("wts2026system00");
    await f.t.control.adminControl({ operation: "set_system_enabled", operationId: crypto.randomUUID(), expectedVersion: system.version, enabled: false, reason: "incident" });
    await f.r.coordinator.close();
    const service = new CheckinRecoveryService(f.t.pb, f.t.admin.actor, { reconcile: async () => ({ state: "existing", checkinId: "901", fingerprint: "e".repeat(64) }) });
    const read = await service.reconcile(f.workflowId);
    await service.command(undefined, { operationId: crypto.randomUUID(), workflowId: f.workflowId, expectedVersion: (await service.get(undefined, f.workflowId)).version, operation: "reset", readId: read.id, checkinId: "901", confirmed: true, producersQuiescent: true, reason: "erroneous_checkin", note: "Synthetic reset" });
    await f.r.coordinator.listen(); let effects = 0;
    const transport = { reset: async (job: import("../../runtime/checkin/protocol").ResetJob, beforeDelete: () => Promise<void>): Promise<"deleted"> => {
      const stored = await f.t.pb.collection("checkin_recovery_resets").getOne(job.resetId);
      expect(stored.state).toBe("possibly_sent"); expect(stored.send_boundary_at).not.toBe("");
      expect(job).toMatchObject({ workflowId: f.workflowId, upstreamEventId: "101", upstreamListId: "201", upstreamAttendeeId: "501", checkinId: "901", fingerprint: "e".repeat(64) });
      await beforeDelete(); effects++; throw new Error("Synthetic lost DELETE response");
    } };
    expect(await f.r.coordinator.processResets(transport)).toBe(1); expect(await f.r.coordinator.processResets(transport)).toBe(0); expect(effects).toBe(1);
    expect((await f.t.pb.collection("checkin_recovery_resets").getFullList())[0].state).toBe("uncertain");
  } finally { f.journal.close(); await f.r.coordinator.close(); await f.t.cleanup(); }
}, 20000);
async function provision() {
  const t = await setup();
  try {
    const r = await ready(t); const url = await r.coordinator.listen();
    const identity: AgentIdentity & { stationId: "wts2026station1" } = { stationId: "wts2026station1", agentIdentity: "test-pi", printerIdentity: "test-printer", journalIdentity: "test-journal", profileId: r.saved.profile.id };
    const file = join(t.root, "recovery.sqlite"); AgentJournal.provision(file, identity); const journal = new AgentJournal(file, identity);
    const transport = new HttpAgentTransport(url, r.issued.credential!); const agent = new AgentRuntime(identity, journal, transport); await agent.heartbeat();
    const first = await t.service.preflight(t.token, { ...t.command(), context: await context(t) }); if (first.state !== "reserved") throw new Error("reservation failed");
    await r.coordinator.processAdmissions({ attendee: async () => ({ upstreamAttendeeId: "501", publicId: "A-ABC1234", productId: "401", alreadyCheckedIn: false }), admit: async () => ({ state: "newly_checked_in", fingerprint: "d".repeat(64) }) });
    await r.coordinator.claimPrints(); const [work] = (await agent.work()).attempts; expect(work).toBeDefined();
    const recovery = new CheckinRecoveryService(t.pb, t.admin.actor, { reconcile: async () => ({ state: "unavailable" }) });
    return { t, r, url, identity, file, journal, transport, agent, work, recovery, workflowId: first.workflow.id };
  } catch (error) { await t.cleanup(); throw error; }
}
it("real PB and file journal: revoked old agent neutralizes retained cancelled output after rotation without losing watermark", async () => {
  const f = await provision(); let journal = f.journal;
  try {
    const [print] = await f.t.pb.collection("checkin_print_attempts").getFullList();
    await f.recovery.command(undefined, { operationId: crypto.randomUUID(), workflowId: f.workflowId, expectedVersion: 0, operation: "cancel", reason: "incident", note: "" });
    const service = new CheckinAgentService(f.t.pb, f.t.admin.actor);
    const station = await f.t.pb.collection("checkin_stations").getOne(f.identity.stationId);
    const issued = await service.issue({ ...f.identity, operationId: crypto.randomUUID(), expectedStationVersion: station.version, reason: "maintenance", note: "Synthetic rotation", credentialLifetimeHours: 1 });
    const prior = await f.t.pb.collection("checkin_agents").getOne(f.r.issued.station.agentId!);
    const current = await f.t.pb.collection("checkin_agents").getOne(issued.station.agentId!);
    expect(current.journal_sequence).toBe(prior.journal_sequence); expect(current.journal_digest).toBe(prior.journal_digest);
    await expect(f.agent.authorize(f.work)).rejects.toThrow();
    const watermark = journal.snapshot(); journal.close(); journal = new AgentJournal(f.file, f.identity); expect(journal.snapshot()).toEqual(watermark);
    const old = new AgentRuntime(f.identity, journal, f.transport);
    expect((await old.recover()).acknowledged).toBe(1);
    expect((await f.t.pb.collection("checkin_recovery_cancellations").getFullList())[0].state).toBe("acknowledged");
    expect((await f.t.pb.collection("checkin_print_attempts").getOne(print.id)).payload_hash).toBe(print.payload_hash);
    const next = new AgentRuntime(f.identity, journal, new HttpAgentTransport(f.url, issued.credential!)); await next.heartbeat();
    await expect(next.process(f.work, { printerIdentity: "test-printer", print: async () => { throw new Error("must not print"); } })).rejects.toThrow("attempt_cancelled");
  } finally { journal.close(); await f.r.coordinator.close(); await f.t.cleanup(); }
}, 20000);
it("real PB: replacement uses immutable payload while revoked original can report late output", async () => {
  const f = await provision(); let journal = f.journal;
  try {
    let prints = 0; const printer = { printerIdentity: "test-printer", print: async () => { prints++; } };
    expect(await f.agent.process(f.work, printer)).toBe("protocol_complete");
    const [first] = await f.t.pb.collection("checkin_print_attempts").getFullList();
    await f.recovery.command(f.t.token, { operationId: crypto.randomUUID(), workflowId: f.workflowId, expectedVersion: (await f.recovery.get(undefined, f.workflowId)).version, operation: "replace", printId: first.id });
    await f.r.coordinator.claimPrints(); const [replacement] = (await f.agent.work()).attempts;
    expect(replacement.payload?.purpose).toBe("replacement"); expect(replacement.attemptId).not.toBe(f.work.attemptId);
    const print = (await f.t.pb.collection("checkin_print_attempts").getFullList()).find(p => p.purpose === "replacement")!; expect(print.predecessor_attempt_id).toBe(first.id);
    await f.agent.authorize(replacement); await f.agent.start(replacement.attemptId);
    const station = await f.t.pb.collection("checkin_stations").getOne(f.identity.stationId);
    await new CheckinAgentService(f.t.pb, f.t.admin.actor).revoke({ operationId: crypto.randomUUID(), stationId: f.identity.stationId, agentId: f.r.issued.station.agentId!, expectedStationVersion: station.version, reason: "security", note: "Synthetic revocation" });
    journal.close(); journal = new AgentJournal(f.file, f.identity); const recovered = new AgentRuntime(f.identity, journal, f.transport);
    expect((await recovered.recover()).reported).toBe(1); expect(journal.get(replacement.attemptId)).toMatchObject({ state: "reported", outcome: "output_uncertain" });
    expect(await recovered.process(replacement, printer)).toBe("output_uncertain"); expect(prints).toBe(1);
    expect((await f.t.pb.collection("checkin_print_attempts").getOne(print.id)).state).toBe("uncertain");
  } finally { journal.close(); await f.r.coordinator.close(); await f.t.cleanup(); }
}, 20000);
