import { expect, it, vi } from "vite-plus/test";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { setup, ready, context } from "~/lib/checkin-recovery-test-helper";
import { CheckinAgentService } from "~/lib/checkin-agent-service";
import { CheckinRecoveryService } from "~/lib/checkin-recovery-service";
import { AgentJournal } from "../../runtime/checkin/journal";
import { AgentRuntime, HttpAgentTransport, type AgentTransport } from "../../runtime/checkin/agent";
import { main } from "../../runtime/checkin/cli";
import { SimulatedNiimbotPrinter } from "../../runtime/checkin/printer";

async function fixture() {
  const t = await setup();
  try {
    const r = await ready(t); const url = await r.coordinator.listen();
    const identity = { stationId: "wts2026station1" as const, agentIdentity: "test-pi", printerIdentity: "test-printer", journalIdentity: "test-journal", profileId: r.saved.profile.id };
    const journalPath = join(t.root, "cli-recovery.sqlite");
    AgentJournal.provision(journalPath, identity);
    const journal = new AgentJournal(journalPath, identity);
    let journalClosed = false;
    const closeJournal = () => { if (!journalClosed) { journal.close(); journalClosed = true; } };
    const transport = new HttpAgentTransport(url, r.issued.credential!);
    const agent = new AgentRuntime(identity, journal, transport);
    await agent.heartbeat();
    const result = await t.service.preflight(t.token, { ...t.command(), context: await context(t) });
    if (result.state !== "reserved") throw new Error("Synthetic reservation failed");
    await r.coordinator.processAdmissions({ attendee: async () => ({ upstreamAttendeeId: "501", publicId: "A-ABC1234", productId: "401", alreadyCheckedIn: false }), admit: async () => ({ state: "newly_checked_in", fingerprint: "d".repeat(64) }) });
    await r.coordinator.claimPrints(); const [work] = (await agent.work()).attempts;
    if (!work) throw new Error("Synthetic work missing");
    const credentialPath = join(t.root, "synthetic-agent-credential");
    const configPath = join(t.root, "synthetic-agent-config.json");
    writeFileSync(credentialPath, r.issued.credential!, { mode: 0o600 });
    writeFileSync(configPath, JSON.stringify({ identity, journalPath, coordinatorUrl: url, agentCredentialFile: credentialPath, printerMode: "simulated", once: true }), { mode: 0o600 });
    return { t, r, identity, journalPath, journal, closeJournal, transport, agent, work, configPath, workflowId: result.workflow.id };
  } catch (error) { await t.cleanup(); throw error; }
}

it("actual agent CLI resumes a still-live prestart authorization with a new monotonic deadline", async () => {
  const f = await fixture();
  const print = vi.spyOn(SimulatedNiimbotPrinter.prototype, "print");
  try {
    await f.agent.authorize(f.work);
    f.closeJournal();
    await main(["agent", f.configPath]);
    expect(print).toHaveBeenCalledTimes(1); // Simulated driver only; no serial device.
    const restored = new AgentJournal(f.journalPath, f.identity);
    try { expect(restored.get(f.work.attemptId)).toMatchObject({ state: "reported", outcome: "protocol_complete" }); }
    finally { restored.close(); }
    expect(await f.t.pb.collection("checkin_agent_authorizations").getFullList()).toHaveLength(1);
  } finally { print.mockRestore(); f.closeJournal(); await f.r.coordinator.close(); await f.t.cleanup(); }
}, 30000);

it("actual CLI neutralizes a rejected start only from the server cancellation proof", async () => {
  const f = await fixture(); const print = vi.spyOn(SimulatedNiimbotPrinter.prototype, "print");
  try {
    await f.agent.authorize(f.work);
    const station = await f.t.pb.collection("checkin_stations").getOne(f.identity.stationId);
    await f.t.control.adminControl({ operation: "set_station_enabled", operationId: crypto.randomUUID(), stationId: f.identity.stationId, expectedVersion: station.version, enabled: false, reason: "incident" });
    await expect(f.agent.start(f.work.attemptId)).rejects.toThrow();
    const recovery = new CheckinRecoveryService(f.t.pb, f.t.admin.actor, { reconcile: async () => ({ state: "unavailable" }) });
    await recovery.command(undefined, { operation: "cancel", operationId: crypto.randomUUID(), workflowId: f.workflowId, expectedVersion: 0, reason: "incident", note: "Synthetic rejected start" });
    f.closeJournal(); await main(["agent", f.configPath]);
    const restored = new AgentJournal(f.journalPath, f.identity);
    try { expect(restored.get(f.work.attemptId)).toMatchObject({ state: "cancelled", cancellation: { acknowledged: true, startState: "not_started" } }); }
    finally { restored.close(); }
    expect(print).not.toHaveBeenCalled();
    const [authorization] = await f.t.pb.collection("checkin_agent_authorizations").getFullList();
    expect(authorization.started_at).toBe(""); expect(authorization.outcome).toBe("");
  } finally { print.mockRestore(); f.closeJournal(); await f.r.coordinator.close(); await f.t.cleanup(); }
}, 30000);

for (const revoked of [false, true]) it(`actual agent CLI drains a lost outcome acknowledgement before heartbeat (revoked: ${revoked})`, async () => {
  const f = await fixture();
  try {
    const lost: AgentTransport = { request: async (operation, payload) => {
      const result = await f.transport.request(operation, payload);
      if (operation === "outcome") throw new Error("Synthetic response lost after durable commit");
      return result;
    } };
    const original = new AgentRuntime(f.identity, f.journal, lost);
    await expect(original.process(f.work, new SimulatedNiimbotPrinter(f.identity.printerIdentity))).rejects.toThrow("Synthetic response lost");
    expect(f.journal.get(f.work.attemptId)).toMatchObject({ state: "possibly_printing", outcome: "protocol_complete" });
    expect((await f.t.pb.collection("checkin_agent_authorizations").getFullList())[0].outcome).toBe("protocol_complete");
    f.closeJournal();
    if (revoked) {
      const station = await f.t.pb.collection("checkin_stations").getOne(f.identity.stationId);
      await new CheckinAgentService(f.t.pb, f.t.admin.actor).revoke({ operationId: crypto.randomUUID(), stationId: f.identity.stationId, agentId: f.r.issued.station.agentId!, expectedStationVersion: station.version, reason: "security", note: "Synthetic revocation" });
    }
    const print = vi.spyOn(SimulatedNiimbotPrinter.prototype, "print");
    try {
      if (revoked) await expect(main(["agent", f.configPath])).rejects.toThrow();
      else await main(["agent", f.configPath]);
      expect(print).not.toHaveBeenCalled();
    } finally { print.mockRestore(); }
    const restored = new AgentJournal(f.journalPath, f.identity);
    try { expect(restored.get(f.work.attemptId)).toMatchObject({ state: "reported", outcome: "protocol_complete" }); }
    finally { restored.close(); }
    expect(await f.t.pb.collection("checkin_agent_authorizations").getFullList()).toHaveLength(1);
  } finally { f.closeJournal(); await f.r.coordinator.close(); await f.t.cleanup(); }
}, 30000);
