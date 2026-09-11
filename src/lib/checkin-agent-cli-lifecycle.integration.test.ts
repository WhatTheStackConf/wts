import { expect, it } from "vite-plus/test";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { join, resolve } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync, symlinkSync, lstatSync, unlinkSync, linkSync } from "node:fs";
import { setup, ready, context } from "./checkin-recovery-test-helper";
import { CheckinLifecycleService } from "./checkin-lifecycle-service";
import { AgentJournal } from "../../runtime/checkin/journal";
import { AgentRuntime, HttpAgentTransport } from "../../runtime/checkin/agent";
import { Coordinator } from "../../runtime/checkin/coordinator";

function run(config: string) {
  return new Promise<{ code: number | null; output: string }>((done) => {
    const child = spawn(process.execPath, [resolve('.output/checkin-runtime/runtime/checkin/cli.js'), 'agent', config]);
    let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
    child.on('exit', code => done({ code, output }));
  });
}
it('compiled CLI caches authenticated closure, retires offline, replays receipt and rejects unsafe paths', async () => {
  const t = await setup(); const r = await ready(t); let coordinator = r.coordinator;
  try {
    let url = await coordinator.listen();
    const identity = { stationId: 'wts2026station1', agentIdentity: 'test-pi', printerIdentity: 'test-printer', journalIdentity: 'test-journal', profileId: r.saved.profile.id };
    const root = join(t.root, 'agent'); mkdirSync(root, { mode: 0o700 });
    const journalPath = join(root, 'agent.sqlite'); AgentJournal.provision(journalPath, identity);
    mkdirSync(join(root, 'spool')); writeFileSync(join(root, 'spool', 'test.bin'), 'synthetic attendee raster');
    const credential = join(t.root, 'credential'); writeFileSync(credential, r.issued.credential!, { mode: 0o600 });
    const config = join(t.root, 'agent.json');
    const configure = () => writeFileSync(config, JSON.stringify({ identity, journalPath, coordinatorUrl: url, agentCredentialFile: credential, printerMode: 'simulated', once: true }), { mode: 0o600 }); configure();
    const liveJournal = new AgentJournal(journalPath, identity);
    const liveAgent = new AgentRuntime(identity, liveJournal, new HttpAgentTransport(url, r.issued.credential!));
    await liveAgent.heartbeat();
    await t.service.preflight(t.token, { ...t.command(), context: await context(t) });
    await coordinator.processAdmissions({ attendee: async () => ({ upstreamAttendeeId: "501", publicId: "A-ABC1234", productId: "401", alreadyCheckedIn: false }), admit: async () => ({ state: "newly_checked_in", fingerprint: "d".repeat(64) }) });
    await coordinator.claimPrints();
    const [work] = (await liveAgent.work()).attempts; expect(work).toBeDefined();
    liveJournal.put({ ...work, state: "received" }); liveJournal.close();
    const lifecycle = new CheckinLifecycleService(t.pb, t.admin.actor);
    await lifecycle.close({ operationId: crypto.randomUUID(), confirmEdition: 'WTS2026' });
    // Move only the disposable test DB clock/deadline; no production mutation.
    const db = new DatabaseSync(join(t.root, 'pb_data', 'data.db'));
    const deadline = new Date(Date.now() + 2000).toISOString();
    db.prepare("UPDATE checkin_lifecycle SET purge_deadline=?").run(deadline);
    db.exec("UPDATE checkin_agents SET revoked=true, expires_at='2020-01-01 00:00:00.000Z'"); db.close();
    const transport = new HttpAgentTransport(url, r.issued.credential!);
    await expect(transport.request('policy', { stationId: identity.stationId, journalIdentity: 'foreign' })).rejects.toThrow();
    await expect(transport.request('policy', { stationId: 'wts2026station2', journalIdentity: identity.journalIdentity })).rejects.toThrow();
    await expect(new HttpAgentTransport(url, 'wts_agent_' + '0'.repeat(64)).request('policy', { stationId: identity.stationId, journalIdentity: identity.journalIdentity })).rejects.toThrow();
    const closed = await run(config); expect(closed.code, closed.output).toBe(0); expect(closed.output).toContain('agent_purge_only');
    expect(await t.pb.collection('checkin_agent_authorizations').getFullList()).toHaveLength(0);
    const unprinted = new AgentJournal(journalPath, identity);
    expect(unprinted.get(work.attemptId)?.state).toBe('received'); unprinted.close();
    const fence = join(root, 'lifecycle-fence.json'); expect(JSON.parse(readFileSync(fence, 'utf8')).purgeDeadline).toBe(deadline);
    expect(lstatSync(fence).mode & 0o777).toBe(0o600);
    expect(readFileSync(fence, 'utf8')).not.toContain(r.issued.credential!);
    await coordinator.close(); await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(deadline) - Date.now() + 30)));
    const offline = await run(config); expect(offline.code, offline.output).toBe(0); expect(offline.output).toContain('agent_purge_receipt_pending');
    expect(existsSync(join(root, 'spool', 'test.bin'))).toBe(false);
    const retired = new DatabaseSync(journalPath, { readOnly: true }); expect(retired.prepare("SELECT name FROM sqlite_master WHERE name='journal'").get()).toBeUndefined(); retired.close();
    expect((await lifecycle.status()).devices.find(d => d.journalIdentity === identity.journalIdentity)?.completedAt).toBeNull();
    coordinator = new Coordinator(t.pb); url = await coordinator.listenReportingOnly(); configure();
    expect((await t.pb.collection("checkin_coordinator").getOne("wts2026coord000")).owner).toBe("");
    symlinkSync(credential, join(root, 'spool', 'unsafe.bin'));
    const unsafe = await run(config); expect(unsafe.code, unsafe.output).toBe(78); expect(unsafe.output).not.toContain('agent_purge_complete');
    expect((await lifecycle.status()).devices.find(d => d.journalIdentity === identity.journalIdentity)?.completedAt).toBeNull();
    unlinkSync(join(root, 'spool', 'unsafe.bin'));
    const retiredBytes = readFileSync(journalPath);
    for (const kind of ['missing', 'corrupt', 'foreign', 'hardlink']) {
      unlinkSync(journalPath);
      if (kind === 'corrupt') writeFileSync(journalPath, 'not sqlite');
      if (kind === 'foreign') AgentJournal.provision(journalPath, { ...identity, journalIdentity: 'foreign-journal' });
      if (kind === 'hardlink') { writeFileSync(journalPath, retiredBytes); linkSync(journalPath, join(root, 'alias.sqlite')); }
      const blocked = await run(config); expect(blocked.code, `${kind}: ${blocked.output}`).toBe(78);
      expect(blocked.output).not.toContain('agent_purge_complete');
      expect((await lifecycle.status()).devices.find(d => d.journalIdentity === identity.journalIdentity)?.completedAt).toBeNull();
      if (kind === 'hardlink') unlinkSync(join(root, 'alias.sqlite'));
      if (existsSync(journalPath)) unlinkSync(journalPath);
      writeFileSync(journalPath, retiredBytes, { mode: 0o600 });
    }
    const receipt = await run(config); expect(receipt.code, receipt.output).toBe(0); expect(receipt.output).toContain('agent_purge_complete');
    expect((await lifecycle.status()).devices.find(d => d.journalIdentity === identity.journalIdentity)?.completedAt).not.toBeNull();
  } finally { await coordinator.close(); await t.cleanup(); }
}, 30000);
