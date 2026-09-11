import { afterAll, beforeAll, expect, it } from "vite-plus/test";
import { startCheckinPocketBase } from "~/lib/checkin-pocketbase-test-helper";
import { Coordinator } from "../../runtime/checkin/coordinator.js";
import { CheckinService } from "~/lib/checkin-service";
import { CheckinAgentService } from "~/lib/checkin-agent-service";
import { CheckinLabelProfileService } from "~/lib/checkin-label-profile-service";
import { SYNTHETIC_LABEL_CONFIG } from "~/lib/checkin-label-render-contract";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

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

it("enforces exact heartbeat and authorization thresholds and scopes secrets, with durable outcome replay after expiry and restart", async () => {
  const f = await ready();
  try {
    const { coordinator: c, issued, stationId } = f; const credential = issued.credential!;
    const work = await c.prepareAttempt(issued.station.agentId!, "b".repeat(64));
    const p = { stationId, attemptId: work.attemptId, payloadHash: work.payloadHash, authorizationHash: "c".repeat(64) };
    expect(await c.machine(credential, "authorize", p)).toMatchObject({ attemptId: work.attemptId });
    expect(await c.machine(credential, "authorize", p)).toMatchObject({ attemptId: work.attemptId });
    await expect(c.machine(credential, "authorize", { ...p, authorizationHash: "d".repeat(64) })).rejects.toThrow();
    await expect(c.machine(credential, "start", { ...p, stationId: "wts2026station2" })).rejects.toThrow();
    f.advance(9999); await c.pulse();
    expect((await c.machine(credential, "status", { stationId })).station.connection).toBe("connected");
    f.advance(1); await expect(c.machine(credential, "start", p)).rejects.toThrow();
    f.advance(4999); await c.pulse();
    expect((await c.machine(credential, "status", { stationId })).station.connection).toBe("connected");
    f.advance(1);
    expect((await c.machine(credential, "status", { stationId })).station.connection).toBe("stale");
    await c.machine(credential, "heartbeat", { ...f.heartbeat, journalSequence: 2 });
    const next = await c.prepareAttempt(issued.station.agentId!, "d".repeat(64));
    const nextP = { ...p, attemptId: next.attemptId, payloadHash: next.payloadHash, authorizationHash: "e".repeat(64) };
    await c.machine(credential, "authorize", nextP);
    await c.machine(credential, "start", nextP);
    await expect(c.machine(credential, "start", nextP)).rejects.toThrow();
    await f.agents.revoke({ operationId: crypto.randomUUID(), stationId, expectedStationVersion: 4, agentId: issued.station.agentId!, reason: "security", note: "Test" });
    await expect(c.machine(credential, "work", { stationId })).rejects.toThrow();
    await c.close(); f.advance(172800000); await f.restart();
    const resumed = new Coordinator(f.pb, { now: f.clock }); await resumed.listenReportingOnly();
    const outcome = { stationId, attemptId: next.attemptId, authorizationHash: nextP.authorizationHash, outcome: "output_uncertain" };
    try {
      expect(await resumed.machine(credential, "outcome", outcome)).toMatchObject({ outcome: "output_uncertain" });
      expect(await resumed.machine(credential, "outcome", outcome)).toMatchObject({ outcome: "output_uncertain" });
      await expect(resumed.machine(credential, "outcome", { ...outcome, authorizationHash: "f".repeat(64) })).rejects.toThrow();
      await expect(resumed.machine(credential, "outcome", { ...outcome, outcome: "protocol_complete" })).rejects.toThrow();
    } finally { await resumed.close(); }
  } finally { await f.cleanup(); }
});

it.each([{ profileId: "wrongprofile000" }, { printerIdentity: "unknown" }, { journalState: "lost" }, { journalState: "corrupt" }, { journalState: "restored" }, { protocolGeneration: 2 }, { journalDigest: "f".repeat(64) }])("keeps quarantine sticky after an invalid identity or journal heartbeat %j", async (change) => {
  const f = await ready();
  try {
    const c = f.coordinator, token = f.issued.credential!;
    expect((await c.machine(token, "heartbeat", { ...f.heartbeat, ...change })).station.journal).toBe("quarantined");
    expect((await c.machine(token, "heartbeat", { ...f.heartbeat, journalSequence: 2 })).station.readyForAuthorization).toBe(false);
    await expect(c.prepareAttempt(f.issued.station.agentId!, "b".repeat(64))).rejects.toThrow();
  } finally { await f.cleanup(); }
});

it.each([false, true])("retains journal watermarks across credential rotation (away and back: %s)", async (away) => {
  const f = await ready();
  try {
    await f.coordinator.machine(f.issued.credential!, "heartbeat", { ...f.heartbeat, journalSequence: 100 });
    let version = 4;
    if (away) {
      const other = await f.agents.issue({ ...f.issue, operationId: crypto.randomUUID(), expectedStationVersion: version++, journalIdentity: "other-journal" });
      expect((await f.coordinator.machine(other.credential!, "heartbeat", { ...f.heartbeat, journalIdentity: "other-journal" })).station.readyForAuthorization).toBe(false);
    }
    const rotated = await f.agents.issue({ ...f.issue, operationId: crypto.randomUUID(), expectedStationVersion: version++ });
    expect(await f.pb.collection("checkin_agents").getOne(rotated.station.agentId!)).toMatchObject({ journal_sequence: 100, journal_digest: "a".repeat(64) });
    if (!away) {
      expect((await f.coordinator.machine(rotated.credential!, "heartbeat", { ...f.heartbeat, journalSequence: 101 })).station.readyForAuthorization).toBe(true);
    }
    const again = await f.agents.issue({ ...f.issue, operationId: crypto.randomUUID(), expectedStationVersion: version });
    const restored = await f.coordinator.machine(again.credential!, "heartbeat", { ...f.heartbeat, journalSequence: 2 });
    expect(restored.station).toMatchObject({ journal: "quarantined", readyForAuthorization: false });
    await expect(f.coordinator.prepareAttempt(again.station.agentId!, "b".repeat(64))).rejects.toThrow();
  } finally { await f.cleanup(); }
});

it("blocks the whole station while output is unresolved, including after agent replacement", async () => {
  const f = await ready();
  try {
    const c = f.coordinator, token = f.issued.credential!, stationId = f.stationId;
    const first = await c.prepareAttempt(f.issued.station.agentId!, "b".repeat(64));
    const second = await c.prepareAttempt(f.issued.station.agentId!, "c".repeat(64));
    const firstPayload = { stationId, attemptId: first.attemptId, payloadHash: first.payloadHash, authorizationHash: "d".repeat(64) };
    const secondPayload = { stationId, attemptId: second.attemptId, payloadHash: second.payloadHash, authorizationHash: "e".repeat(64) };
    await c.machine(token, "authorize", firstPayload);
    await c.machine(token, "authorize", secondPayload);
    await c.machine(token, "start", firstPayload);
    await expect(c.prepareAttempt(f.issued.station.agentId!, "f".repeat(64))).rejects.toThrow();
    await expect(c.machine(token, "start", secondPayload)).rejects.toThrow();
    expect((await c.machine(token, "status", { stationId })).station).toMatchObject({ readyForAuthorization: false, reasons: expect.arrayContaining(["printer_output_unresolved"]) });
    await c.machine(token, "outcome", { stationId, attemptId: first.attemptId, authorizationHash: firstPayload.authorizationHash, outcome: "protocol_complete" });
    await c.machine(token, "start", secondPayload);
    const replacement = await f.agents.issue({ ...f.issue, operationId: crypto.randomUUID(), expectedStationVersion: 4 });
    await c.machine(replacement.credential!, "heartbeat", f.heartbeat);
    await c.machine(token, "outcome", { stationId, attemptId: second.attemptId, authorizationHash: secondPayload.authorizationHash, outcome: "output_uncertain" });
    expect((await c.machine(replacement.credential!, "status", { stationId })).station).toMatchObject({ readyForAuthorization: false, reasons: expect.arrayContaining(["printer_output_unresolved"]) });
    await expect(c.prepareAttempt(replacement.station.agentId!, "f".repeat(64))).rejects.toThrow();
  } finally { await f.cleanup(); }
});

it("does not starve later work behind ten authorized attempts", async () => {
  const f = await ready();
  try {
    const c = f.coordinator, token = f.issued.credential!;
    for (let i = 0; i < 12; i++) {
      const attempt = await c.prepareAttempt(f.issued.station.agentId!, randomBytes(32).toString("hex"));
      await c.machine(token, "authorize", { stationId: f.stationId, attemptId: attempt.attemptId, payloadHash: attempt.payloadHash, authorizationHash: randomBytes(32).toString("hex") });
    }
    const last = await c.prepareAttempt(f.issued.station.agentId!, "e".repeat(64));
    expect(await c.machine(token, "work", { stationId: f.stationId })).toEqual({ attempts: [last] });
  } finally { await f.cleanup(); }
});

it("keeps label catalogue approval and save fences compatible after issuance", async () => {
  const f = await ready();
  try {
    expect((await f.profiles.get(f.identity.profileId)).approval).toBe("approved");
    const catalogue = await f.profiles.list();
    expect(catalogue.profileStationVersions[f.identity.profileId]).toBe(catalogue.stations[0].version);
    // Enforce reservation ordering at the real storage mutation boundary.
    writeFileSync(join(f.root, "pb_hooks", "test-reservation.pb.js"), `onRecordUpdate((e) => {
      if (e.record.original().getInt("profile_config_version") !== 0 && e.record.getInt("profile_config_version") === 0) {
        const pending = e.app.findRecordsByFilter("admin_actions", "operation_kind = 'checkin.configure_label_profile' && status = 'pending'", "", 1, 0);
        if (!pending.length) throw new BadRequestError("Profile configuration changed before reservation.");
      }
      return e.next();
    }, "checkin_stations");`);
    await f.restart();
    await expect(f.profiles.configure({ operationId: crypto.randomUUID(), stationId: f.stationId, expectedVersion: 1, expectedStationVersion: 4, reason: "configuration", note: "Stale pre-restart fence", config: f.config })).rejects.toMatchObject({ code: "conflict" });
    const restoredCatalogue = await f.profiles.list();
    const currentVersion = restoredCatalogue.stations.find(station => station.id === f.stationId)!.version;
    expect(currentVersion).toBeGreaterThan(4);
    const next = await f.profiles.configure({ operationId: crypto.randomUUID(), stationId: f.stationId, expectedVersion: 1, expectedStationVersion: currentVersion, reason: "configuration", note: "Test", config: f.config });
    await f.profiles.approve({ operationId: crypto.randomUUID(), profileId: next.profile.id, expectedVersion: 2, expectedStationVersion: currentVersion, reason: "configuration", note: "Test-only attestation", physicalConfirmation: true });
    expect((await f.profiles.get(next.profile.id)).approval).toBe("approved");
    expect((await f.agents.adminList()).stations.find(station => station.stationId === f.stationId)).toMatchObject({ profile: "mismatch", readyForAuthorization: false });
  } finally { await f.cleanup(); }
});

it("fences stopped and superseded coordinators without replaying stale attempts", async () => {
  const f = await ready();
  try {
    const c = f.coordinator, credential = f.issued.credential!, stationId = f.stationId;
    const attempt = await c.prepareAttempt(f.issued.station.agentId!, "b".repeat(64));
    const p = { stationId, attemptId: attempt.attemptId, payloadHash: attempt.payloadHash, authorizationHash: "c".repeat(64) };
    await c.machine(credential, "authorize", p);
    await f.human.adminControl({ operation: "set_system_enabled", operationId: crypto.randomUUID(), expectedVersion: 2, enabled: false, reason: "maintenance" });
    await expect(c.machine(credential, "start", p)).rejects.toThrow();
    await f.human.adminControl({ operation: "set_system_enabled", operationId: crypto.randomUUID(), expectedVersion: 3, enabled: true, reason: "operations_restored" });
    await expect(c.machine(credential, "start", p)).rejects.toThrow();
    expect(await c.machine(credential, "work", { stationId })).toEqual({ attempts: [] });
    const stale = await c.prepareAttempt(f.issued.station.agentId!, "d".repeat(64));
    f.advance(15000);
    const successor = new Coordinator(f.pb, { now: f.clock }); await successor.listen();
    try {
      await expect(c.pulse()).rejects.toThrow(); await c.close();
      await successor.machine(credential, "heartbeat", { ...f.heartbeat, journalSequence: 2 });
      expect(await successor.machine(credential, "work", { stationId })).toEqual({ attempts: [] });
      await expect(successor.machine(credential, "authorize", { ...p, attemptId: stale.attemptId, payloadHash: stale.payloadHash })).rejects.toThrow();
      await successor.pulse();
    } finally { await successor.close(); }
    f.advance(3600000);
    const expired = new Coordinator(f.pb, { now: f.clock }); await expired.listen();
    try { await expect(expired.machine(credential, "heartbeat", f.heartbeat)).rejects.toThrow(); } finally { await expired.close(); }
  } finally { await f.cleanup(); }
});

it("denies direct collections and binding/login substitution, and atomically rolls back failed issuance", async () => {
  const f = await ready();
  try {
    const stationId = f.stationId;
    const collectionNames = ["checkin_agents", "checkin_coordinator", "checkin_agent_attempts", "checkin_agent_authorizations"];
    for (const name of collectionNames) {
      await expect(f.admin.client.collection(name).getList()).rejects.toThrow();
      await expect(f.admin.client.collection(name).create({})).rejects.toThrow();
      await expect(f.pb.collection(name).create({})).rejects.toThrow();
    }
    await expect(f.pb.collection("checkin_agents").update(f.issued.station.agentId!, { revoked: true })).rejects.toThrow();
    await expect(f.pb.collection("checkin_agents").delete(f.issued.station.agentId!)).rejects.toThrow();
    await expect(f.coordinator.machine("a".repeat(64), "status", { stationId })).rejects.toThrow();
    await expect(f.coordinator.machine(f.admin.client.authStore.token, "status", { stationId })).rejects.toThrow();
    await expect(f.admin.client.send("/api/wts/checkin-agents", { method: "POST", body: { operation: "machine_acquire" } })).rejects.toThrow();
    const auditCollection = await f.pb.collections.getOne("checkin_audit_events");
    const field = auditCollection.fields.find((field: { name: string }) => field.name === "operation");
    if (!field) throw new Error("Required audit operation field missing");
    const original = structuredClone(auditCollection.fields);
    // Force the final append to fail through a real temporary schema constraint.
    field.values = field.values.filter((value: string) => value !== "issue_agent");
    await f.pb.collections.update(auditCollection.id, { fields: auditCollection.fields });
    const before = await f.agents.adminList();
    const actionsBefore = await f.pb.collection("admin_actions").getList(1, 1);
    const command = { ...f.issue, expectedStationVersion: 4, operationId: crypto.randomUUID() };
    await expect(f.agents.issue(command)).rejects.toThrow();
    expect(await f.agents.adminList()).toEqual(before);
    expect((await f.pb.collection("admin_actions").getList(1, 1)).totalItems).toBe(actionsBefore.totalItems + 1);
    const failed = await f.pb.collection("admin_actions").getFirstListItem(`operation_id = '${command.operationId}'`);
    expect(failed).toMatchObject({ status: "failed", failure_code: "storage_failure", failure_message: "Administrative command could not be applied.", after_summary: null, replay_result: null });
    await expect(f.agents.issue({ ...command, note: "Changed" })).rejects.toMatchObject({ code: "conflict" });
    await f.pb.collections.update(auditCollection.id, { fields: original });
    const retry = await f.agents.issue(command);
    expect(retry).toMatchObject({ actionId: failed.id, station: { agentId: failed.target_id } });
    expect(await f.pb.collection("admin_actions").getOne(failed.id)).toMatchObject({ status: "applied", attempt_count: 2, failure_code: "" });
    const outcomes = await Promise.allSettled([f.agents.issue(command), f.agents.issue({ ...command, operationId: crypto.randomUUID() })]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((await f.pb.collection("admin_actions").getList(1, 1)).totalItems).toBe(actionsBefore.totalItems + 1);
    const audits = await f.pb.collection("checkin_audit_events").getFullList({ filter: `operation = 'issue_agent'` });
    expect(audits).toHaveLength(2);
    expect(audits.every(row => row.actor_name === "Test Operator")).toBe(true);
    expect(JSON.stringify(audits)).not.toContain(f.issued.credential);
  } finally { await f.cleanup(); }
});

it.each([
  { operation: "machine_admission_claim", run: (c: Coordinator) => c.claimAdmission(), expected: null },
  { operation: "machine_print_claim", run: (c: Coordinator) => c.claimPrints(), expected: 0 },
  { operation: "machine_reset_claim", run: (c: Coordinator) => c.claimReset(), expected: null },
])("uses backend time when a later heartbeat overtakes $operation", async ({ operation, run, expected }) => {
  const f = await startCheckinPocketBase();
  const coordinator = new Coordinator(f.pb);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const captured = new Promise<void>((resolve) => { entered = resolve; });
  let heldAt = 0;
  let commandBody: Record<string, unknown> = {};
  let pending: Promise<unknown> | undefined;
  try {
    await coordinator.listen();
    const before = await f.pb.collection("checkin_coordinator").getOne("wts2026coord000");
    f.pb.beforeSend = async (url, options) => {
      const body = typeof options.body === "string" ? JSON.parse(options.body) : options.body;
      if (body?.operation === operation) {
        commandBody = body;
        heldAt = Date.now();
        entered();
        await held;
      }
      return { url, options };
    };
    // Real SDK transport barrier: no fake PB responses or backend clock changes.
    pending = run(coordinator).then((value) => ({ value }), (error: unknown) => ({ error }));
    await captured;
    await expect.poll(() => Date.now(), { timeout: 1000, interval: 1 }).toBeGreaterThan(heldAt);
    await coordinator.pulse();
    const after = await f.pb.collection("checkin_coordinator").getOne("wts2026coord000");
    expect(after.owner).toBe(before.owner);
    expect(after.generation).toBe(before.generation);
    expect(Date.parse(after.last_seen_at)).toBeGreaterThan(heldAt);
    expect(Date.now() - Date.parse(after.last_seen_at)).toBeLessThan(after.heartbeat_timeout_ms);
    release();
    expect(await pending).toEqual({ value: expected });
    expect(commandBody).not.toHaveProperty("nowMs");
    await expect(coordinator.pulse()).resolves.toEqual({ generation: after.generation });
  } finally {
    release();
    await pending;
    f.pb.beforeSend = undefined;
    await coordinator.close();
    await f.cleanup();
  }
});

it("preserves explicit command clocks and rejects commands older than the committed lease", async () => {
  const f = await startCheckinPocketBase();
  let now = Date.now() + 60000;
  const coordinator = new Coordinator(f.pb, { now: () => now });
  const clocks: { operation: string; nowMs: number }[] = [];
  f.pb.beforeSend = (url, options) => {
    const body = typeof options.body === "string" ? JSON.parse(options.body) : options.body;
    if (body?.operation?.startsWith("machine_")) clocks.push({ operation: body.operation, nowMs: body.nowMs });
    return { url, options };
  };
  try {
    await coordinator.listen();
    await expect(coordinator.claimAdmission()).resolves.toBeNull();
    await expect(coordinator.claimPrints()).resolves.toBe(0);
    await expect(coordinator.claimReset()).resolves.toBeNull();
    expect(clocks).toEqual([
      { operation: "machine_acquire", nowMs: now },
      { operation: "machine_admission_claim", nowMs: now },
      { operation: "machine_print_claim", nowMs: now },
      { operation: "machine_reset_claim", nowMs: now },
    ]);
    const lease = await f.pb.collection("checkin_coordinator").getOne("wts2026coord000");
    expect(Date.parse(lease.last_seen_at)).toBe(now);
    now--;
    await expect(coordinator.claimAdmission()).rejects.toMatchObject({ status: 503 });
    await expect(coordinator.claimPrints()).rejects.toMatchObject({ status: 503 });
    await expect(coordinator.claimReset()).rejects.toMatchObject({ status: 403 });
    await expect(coordinator.pulse()).rejects.toMatchObject({ status: 503 });
    now += 2;
    await expect(coordinator.pulse()).resolves.toEqual({ generation: lease.generation });
    const renewed = await f.pb.collection("checkin_coordinator").getOne("wts2026coord000");
    expect(Date.parse(renewed.last_seen_at)).toBe(now);
    await coordinator.close();
    expect(clocks.at(-1)).toEqual({ operation: "machine_release", nowMs: now });
  } finally {
    f.pb.beforeSend = undefined;
    await coordinator.close();
    await f.cleanup();
  }
});

let fixture: Awaited<ReturnType<typeof startCheckinPocketBase>>;
beforeAll(async () => { fixture = await startCheckinPocketBase(); });
afterAll(async () => { await fixture?.cleanup(); });
it("owns a real loopback machine endpoint and rejects browser authority and privileged operation injection", async () => {
  const coordinator = new Coordinator(fixture.pb);
  const url = await coordinator.listen();
  try {
    for (const body of [{ operation: "machine_prepare", payload: {} }, { operation: "status", payload: { stationId: "wts2026station1", nowMs: 1 } }, { operation: "status", payload: { stationId: "wts2026station1" }, owner: "a".repeat(64) }]) {
      const response = await fetch(`${url}/v1/agent`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer wts_agent_${"a".repeat(64)}` }, body: JSON.stringify(body) });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Agent request rejected." });
    }
    const deniedHeaders: Record<string, string>[] = [{ cookie: "pb_auth=browser" }, { origin: "http://localhost" }, { authorization: "Bearer browser-login" }];
    for (const headers of deniedHeaders) {
      const response = await fetch(`${url}/v1/agent`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer wts_agent_${"a".repeat(64)}`, ...headers }, body: JSON.stringify({ operation: "status", payload: { stationId: "wts2026station1" } }) });
      expect(response.status).toBe(403);
    }
    await expect(new Coordinator(fixture.pb).listen()).rejects.toThrow();
  } finally { await coordinator.close(); }
  const replacement = new Coordinator(fixture.pb);
  await replacement.listen(); await replacement.close();
});
