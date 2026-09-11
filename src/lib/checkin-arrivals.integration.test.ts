import { expect, it } from "vite-plus/test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import PocketBase from "pocketbase";
import { CheckinAgentService } from "~/lib/checkin-agent-service";
import { CheckinLabelProfileService } from "~/lib/checkin-label-profile-service";
import { SYNTHETIC_LABEL_CONFIG } from "~/lib/checkin-label-render-contract";
import { Coordinator } from "../../runtime/checkin/coordinator";
import { AgentJournal } from "../../runtime/checkin/journal";
import { AgentRuntime, HttpAgentTransport } from "../../runtime/checkin/agent";
import { SimulatedNiimbotPrinter } from "../../runtime/checkin/printer";
import type { CheckinStationId } from "~/lib/checkin-contract";
import type { CheckinArrivalSource } from "~/lib/checkin-arrival-source";
import type { CheckinEventContext } from "~/lib/checkin-event-contract";
import { CheckinArrivalService } from "~/lib/checkin-arrival-service";
import { CheckinEventService, type CheckinEventSource } from "~/lib/checkin-event-service";
import { CheckinService } from "~/lib/checkin-service";
import { startCheckinPocketBase } from "~/lib/checkin-pocketbase-test-helper";

const events: CheckinEventSource = {
  sourceKey: "a".repeat(64),
  discover: async () => ({ state: "complete", events: [{ id: "101", title: "Synthetic conference" }] }),
  options: async () => ({ state: "complete", lists: [{ id: "201", title: "Synthetic list" }], products: [{ id: "401", title: "Test ticket" }], questions: [{ id: "301", title: "Test affiliation", productIds: ["401"] }] }),
};
const qrIdentity = "A-ABC1234";
async function setup() {
  const test = await startCheckinPocketBase();
  try {
    const admin = await test.user("admin");
    const operator = await test.user("checkin_operator");
    const control = new CheckinService(test.pb, admin.actor);
    const catalogue = new CheckinEventService(test.pb, operator.actor, events);
    const configuration = await new CheckinEventService(test.pb, admin.actor, events).configure({ operationId: crypto.randomUUID(), expectedGeneration: 0, upstreamEventId: "101", member: true, enabled: true, listId: "201", affiliation: { questionId: "301", productIds: ["401"] }, reason: "configuration" });
    await control.adminControl({ operation: "set_system_enabled", operationId: crypto.randomUUID(), expectedVersion: 1, enabled: true, reason: "configuration" });
    const stationId = "wts2026station1";
    await control.adminControl({ operation: "set_station_enabled", operationId: crypto.randomUUID(), expectedVersion: 1, stationId, enabled: true, reason: "configuration" });
    const code = (await control.adminControl({ operation: "rotate_provision_code", operationId: crypto.randomUUID(), expectedVersion: 2, stationId, reason: "configuration" })).provisionCode!;
    const token = "b".repeat(64);
    await control.bind(code, token, (await control.preview(code)).confirmation);
    const initial = await catalogue.catalogue(token);
    const selected = await catalogue.select(token, { ...initial.fence, eventId: configuration.configuration.id, eventGeneration: 1 });
    const source: CheckinArrivalSource = { sourceKey: events.sourceKey, resolve: async () => ({ state: "eligible" as const, attendee: { upstreamAttendeeId: "501", publicId: qrIdentity, productId: "401", name: "Тест Attendee", alreadyCheckedIn: false } }), affiliation: async () => ({ state: "present" as const, text: "Test organisation" }) };
    const service = new CheckinArrivalService(test.pb, operator.actor, source);
    const command = () => ({ operationId: crypto.randomUUID(), context: selected.context!, qrIdentity, affiliationChoice: "fetch" as const });
    return { ...test, admin, operator, control, catalogue, configuration, token, code, source, service, command };
  } catch (error) { await test.cleanup(); throw error; }
}

async function ready(t: Awaited<ReturnType<typeof setup>>, stationId: CheckinStationId = "wts2026station1", coordinator = new Coordinator(t.pb)) {
  const row = await t.pb.collection("checkin_stations").getOne(stationId);
  let version = Number(row.version);
  const code = row.provision_code_hash ? t.code : (await t.control.adminControl({ operation: "rotate_provision_code", operationId: crypto.randomUUID(), stationId, expectedVersion: version++, reason: "configuration" })).provisionCode!;
  if (!row.enabled) { await t.control.adminControl({ operation: "set_station_enabled", operationId: crypto.randomUUID(), stationId, expectedVersion: version++, enabled: true, reason: "configuration" }); }
  await t.control.adminControl({ operation: "configure_station", operationId: crypto.randomUUID(), stationId, expectedVersion: version++, label: "Test station", location: "Test", printerRef: "test-printer", reason: "configuration" });
  const profiles = new CheckinLabelProfileService(t.pb, t.admin.actor);
  const saved = await profiles.configure({ operationId: crypto.randomUUID(), stationId, expectedVersion: 0, expectedStationVersion: version, reason: "configuration", note: "Synthetic test profile", config: { ...SYNTHETIC_LABEL_CONFIG, synthetic: false, printerRef: "test-printer", stockRef: "test-stock" } });
  await profiles.approve({ operationId: crypto.randomUUID(), profileId: saved.profile.id, expectedVersion: 1, expectedStationVersion: version, reason: "configuration", physicalConfirmation: true, note: "Synthetic attestation only, not physical evidence" });
  const identity = { stationId, agentIdentity: "test-pi", printerIdentity: "test-printer", journalIdentity: "test-journal", profileId: saved.profile.id };
  const issued = await new CheckinAgentService(t.pb, t.admin.actor).issue({ ...identity, operationId: crypto.randomUUID(), expectedStationVersion: version, reason: "configuration", note: "Synthetic agent", credentialLifetimeHours: 24 });
  const heartbeat = () => coordinator.machine(issued.credential!, "heartbeat", { ...identity, protocolGeneration: 1, schemaGeneration: 1, journalSequence: 1, journalDigest: "c".repeat(64), journalState: "healthy" });
  return { coordinator, heartbeat, issued, saved, code };
}
async function context(t: Awaited<ReturnType<typeof setup>>, token = t.token): Promise<CheckinEventContext> {
  const current = await t.catalogue.catalogue(token);
  return (await t.catalogue.select(token, { ...current.fence, eventId: t.configuration.configuration.id, eventGeneration: 1 })).context!;
}

it("reopens the immutable snapshot after mapping changes and dependency loss without upstream reads", { timeout: 60_000 }, async () => {
  const t = await setup(); const runtime = await ready(t); await runtime.coordinator.listen();
  try {
    await runtime.heartbeat();
    const command = { ...t.command(), context: await context(t) };
    const first = await t.service.preflight(t.token, command);
    expect(first.state).toBe("reserved");
    if (first.state !== "reserved") throw new Error("Expected reservation");
    const before = await t.pb.collection("checkin_arrival_workflows").getOne(first.workflow.id);
    expect(before.affiliation_mapping).toEqual({ questionId: "301", productIds: ["401"] });
    await new CheckinEventService(t.pb, t.admin.actor, events).configure({ operationId: crypto.randomUUID(), expectedGeneration: 1, upstreamEventId: "101", member: true, enabled: true, listId: "201", affiliation: null, reason: "configuration" });
    const current = await t.catalogue.catalogue(t.token);
    const selected = await t.catalogue.select(t.token, { ...current.fence, eventId: t.configuration.configuration.id, eventGeneration: 2 });
    await runtime.coordinator.close();
    let reads = 0;
    const unavailable = new CheckinArrivalService(t.pb, t.operator.actor, { sourceKey: events.sourceKey, resolve: async () => { reads++; return { state: "unavailable" }; }, affiliation: async () => { reads++; return { state: "unavailable" }; } });
    const repeated = await unavailable.preflight(t.token, { ...command, operationId: crypto.randomUUID(), context: selected.context! });
    expect(repeated).toMatchObject({ state: "existing", workflow: first.workflow, operationsEnabled: false });
    expect(reads).toBe(0);
    // Rebinding the same phone never transfers the original work or exposes it.
    const stationId = "wts2026station2";
    await t.control.adminControl({ operation: "set_station_enabled", operationId: crypto.randomUUID(), stationId, expectedVersion: 1, enabled: true, reason: "configuration" });
    const code = (await t.control.adminControl({ operation: "rotate_provision_code", operationId: crypto.randomUUID(), stationId, expectedVersion: 2, reason: "configuration" })).provisionCode!;
    await t.control.bind(code, t.token, (await t.control.preview(code, t.token)).confirmation);
    const rebound = await t.catalogue.catalogue(t.token);
    const foreign = await t.catalogue.select(t.token, { ...rebound.fence, eventId: command.context.eventId, eventGeneration: 2 });
    expect(await unavailable.preflight(t.token, { ...command, operationId: crypto.randomUUID(), context: foreign.context! })).toMatchObject({ state: "already_handled", operationsEnabled: false });
    expect(reads).toBe(0);
    await t.restart();
    expect(await t.pb.collection("checkin_arrival_workflows").getOne(first.workflow.id)).toEqual(before);
    expect((await t.service.history(t.token)).items).toHaveLength(0);
    expect((await new CheckinArrivalService(t.pb, t.admin.actor, t.source).history(undefined, { scope: "all" })).items).toHaveLength(1);
  } finally { await runtime.coordinator.close(); await t.cleanup(); }
});

type Fixture = Awaited<ReturnType<typeof setup>>;
function sql(t: Fixture, statement: string, ...values: (string | number)[]) {
  const db = new DatabaseSync(join(t.root, "pb_data", "data.db"));
  try { db.exec("PRAGMA busy_timeout = 5000"); db.prepare(statement).run(...values); } finally { db.close(); }
}
async function noEffects(t: Fixture) {
  for (const collection of ["checkin_arrival_workflows", "checkin_agent_attempts", "checkin_agent_authorizations"]) expect(await t.pb.collection(collection).getFullList()).toEqual([]);
}
const changes = ["role", "verification", "binding", "rebind", "system", "station", "event", "selection", "agent", "profile", "heartbeat"] as const;
for (const phase of ["before", "affiliation"] as const) {
  for (const change of changes) {
    it(`rejects new acceptance after live ${change} change ${phase === "before" ? "before intake" : "during delayed affiliation"}`, { timeout: 60_000 }, async () => {
      const t = await setup(); const runtime = await ready(t); await runtime.coordinator.listen();
      try {
        await runtime.heartbeat();
        const command = { ...t.command(), context: await context(t) };
        const mutate = async () => {
          if (change === "role") await t.pb.collection("users").update(t.operator.record.id, { role: "user" });
          if (change === "verification") await t.pb.collection("users").update(t.operator.record.id, { verified: false });
          if (change === "binding") await t.control.adminControl({ operation: "revoke_binding", operationId: crypto.randomUUID(), bindingId: command.context.bindingId, expectedVersion: command.context.bindingVersion, reason: "security" });
          if (change === "rebind") {
            const stationId = "wts2026station2";
            await t.control.adminControl({ operation: "set_station_enabled", operationId: crypto.randomUUID(), stationId, expectedVersion: 1, enabled: true, reason: "configuration" });
            const code = (await t.control.adminControl({ operation: "rotate_provision_code", operationId: crypto.randomUUID(), stationId, expectedVersion: 2, reason: "configuration" })).provisionCode!;
            await t.control.bind(code, t.token, (await t.control.preview(code, t.token)).confirmation);
          }
          if (change === "system") {
            const system = await t.pb.collection("checkin_system").getOne("wts2026system00");
            await t.control.adminControl({ operation: "set_system_enabled", operationId: crypto.randomUUID(), expectedVersion: system.version, enabled: false, reason: "maintenance" });
          }
          if (change === "station") {
            const station = await t.pb.collection("checkin_stations").getOne(command.context.stationId);
            await t.control.adminControl({ operation: "set_station_enabled", operationId: crypto.randomUUID(), stationId: command.context.stationId, expectedVersion: station.version, enabled: false, reason: "maintenance" });
          }
          if (change === "event") await new CheckinEventService(t.pb, t.admin.actor, events).configure({ operationId: crypto.randomUUID(), expectedGeneration: 1, upstreamEventId: "101", member: true, enabled: false, listId: "201", affiliation: null, reason: "configuration" });
          if (change === "selection") await context(t);
          if (change === "agent") {
            const station = await t.pb.collection("checkin_stations").getOne(command.context.stationId);
            await new CheckinAgentService(t.pb, t.admin.actor).revoke({ operationId: crypto.randomUUID(), stationId: command.context.stationId, expectedStationVersion: station.version, agentId: runtime.issued.station.agentId!, reason: "security", note: "Synthetic revocation" });
          }
          if (change === "profile") {
            const station = await t.pb.collection("checkin_stations").getOne(command.context.stationId);
            await new CheckinLabelProfileService(t.pb, t.admin.actor).configure({ operationId: crypto.randomUUID(), stationId: command.context.stationId, expectedVersion: 1, expectedStationVersion: station.version, reason: "configuration", note: "Synthetic replacement", config: { ...SYNTHETIC_LABEL_CONFIG, synthetic: false, printerRef: "test-printer", stockRef: "replacement-stock" } });
          }
          if (change === "heartbeat") sql(t, "UPDATE checkin_agents SET last_heartbeat_at = '2000-01-01 00:00:00.000Z'");
        };
        let reads = 0;
        const source: CheckinArrivalSource = { ...t.source, resolve: async (...args) => { reads++; return t.source.resolve(...args); }, affiliation: async (...args) => { if (phase === "affiliation") await mutate(); return t.source.affiliation(...args); } };
        if (phase === "before") await mutate();
        const result = new CheckinArrivalService(t.pb, t.operator.actor, source).preflight(t.token, command);
        if (["profile", "heartbeat"].includes(change)) {
          await expect(result).resolves.toMatchObject({ state: "dependency_unavailable", operationsEnabled: false });
        } else {
          const code = change === "role" || change === "verification" ? "forbidden" : change === "binding" ? "revoked_binding" : "conflict";
          await expect(result).rejects.toMatchObject({ code });
        }
        if (phase === "before") expect(reads).toBe(0);
        await noEffects(t);
      } finally { await runtime.coordinator.close(); await t.cleanup(); }
    });
  }
}

it("requires explicit affiliation retry or blank continuation and re-resolves eligibility before reserving", { timeout: 60_000 }, async () => {
  const t = await setup(); const runtime = await ready(t); await runtime.coordinator.listen();
  try {
    await runtime.heartbeat();
    let cancelled = false; let affiliationReads = 0;
    const source: CheckinArrivalSource = { ...t.source, resolve: async (...args) => cancelled ? { state: "rejected", reason: "cancelled" } : t.source.resolve(...args), affiliation: async () => { affiliationReads++; return { state: "unavailable" }; } };
    const service = new CheckinArrivalService(t.pb, t.operator.actor, source);
    const command = { ...t.command(), context: await context(t) };
    const failed = await service.preflight(t.token, command);
    expect(failed.state).toBe("needs_affiliation_choice");
    await noEffects(t);
    await expect(service.preflight(t.token, { ...command, affiliationChoice: "blank" })).rejects.toMatchObject({ code: "conflict" });
    await expect(service.preflight(t.token, { ...command, operationId: crypto.randomUUID(), affiliationChoice: "blank" })).rejects.toMatchObject({ code: "invalid_input" });
    const continuation = { ...command, operationId: crypto.randomUUID(), priorOperationId: command.operationId, affiliationChoice: "blank" as const };
    cancelled = true;
    expect(await service.preflight(t.token, continuation)).toMatchObject({ state: "rejected", reason: "cancelled" });
    await noEffects(t);
    expect(affiliationReads).toBe(1);
    cancelled = false;
    const retried = await service.preflight(t.token, { ...command, operationId: crypto.randomUUID(), priorOperationId: command.operationId });
    expect(retried.state).toBe("needs_affiliation_choice");
    expect(affiliationReads).toBe(2);
    const blank = await service.preflight(t.token, { ...continuation, operationId: crypto.randomUUID(), priorOperationId: retried.operationId });
    expect(blank).toMatchObject({ state: "reserved", workflow: { affiliation: "", state: "not_submitted" }, operationsEnabled: false });
    expect(affiliationReads).toBe(2);
  } finally { await runtime.coordinator.close(); await t.cleanup(); }
});

for (const connected of [false, true]) {
  it(`rejects mixed/lowercase QR identities with readiness ${connected ? "connected" : "unavailable"} before any source reads`, { timeout: 60_000 }, async () => {
    const t = await setup();
    const runtime = connected ? await ready(t) : undefined;
    try {
      if (runtime) { await runtime.coordinator.listen(); await runtime.heartbeat(); }
      let reads = 0;
      const source: CheckinArrivalSource = { ...t.source,
        resolve: async (...args) => { reads++; return t.source.resolve(...args); },
        affiliation: async (...args) => { reads++; return t.source.affiliation(...args); },
      };
      const service = new CheckinArrivalService(t.pb, t.operator.actor, source);
      const selected = runtime ? await context(t) : t.command().context;
      for (const qrIdentity of ["a-ABC1234", "A-abc1234", "A-AbC1234", "a-abc1234"]) {
        expect(await service.preflight(t.token, { ...t.command(), context: selected, qrIdentity })).toMatchObject({ state: "rejected", reason: "invalid_identity", operationsEnabled: false });
      }
      expect(reads).toBe(0);
      await noEffects(t);
    } finally { await runtime?.coordinator.close(); await t.cleanup(); }
  });
}

for (const outcome of ["retry", "blank", "rejected"] as const) {
  it(`resolves continuation ancestors in history after ${outcome} without rewriting command replay or audit`, { timeout: 60_000 }, async () => {
    const t = await setup(); const runtime = await ready(t); await runtime.coordinator.listen();
    try {
      await runtime.heartbeat();
      let phase: "dependency" | "affiliation" | "resolved" = "dependency";
      const source: CheckinArrivalSource = { ...t.source,
        resolve: async (...args) => phase === "dependency" ? { state: "unavailable" } : phase === "resolved" && outcome === "rejected" ? { state: "rejected", reason: "cancelled" } : t.source.resolve(...args),
        affiliation: async (...args) => phase === "affiliation" ? { state: "unavailable" } : t.source.affiliation(...args),
      };
      const service = new CheckinArrivalService(t.pb, t.operator.actor, source);
      const first = { ...t.command(), context: await context(t) };
      const failed = await service.preflight(t.token, first);
      expect(failed.state).toBe("dependency_unavailable");
      phase = "affiliation";
      const second = { ...first, operationId: crypto.randomUUID(), priorOperationId: first.operationId };
      const choice = await service.preflight(t.token, second);
      expect(choice.state).toBe("needs_affiliation_choice");
      expect((await service.history(t.token)).items.every((item) => item.completedAt === null)).toBe(true);
      // Earlier-day exceptions become today's completed history when continued.
      sql(t, "UPDATE checkin_arrival_commands SET created = '2020-01-01 00:00:00.000Z'");
      const originals = await t.pb.collection("checkin_arrival_commands").getFullList({ sort: "id" });
      const audit = await t.pb.collection("checkin_audit_events").getFullList({ filter: "operation ~ 'arrival_'", sort: "id" });
      phase = "resolved";
      const last = { ...second, operationId: crypto.randomUUID(), priorOperationId: second.operationId, affiliationChoice: outcome === "blank" ? "blank" as const : "fetch" as const };
      const result = await service.preflight(t.token, last);
      expect(result.state).toBe(outcome === "rejected" ? "rejected" : "reserved");
      if (result.state === "reserved") expect(result.workflow.affiliation).toBe(outcome === "blank" ? "" : "Test organisation");
      const history = await service.history(t.token);
      const paged: string[] = []; let cursor: string | undefined;
      do {
        const page = await service.history(t.token, { limit: 1, cursor });
        paged.push(...page.items.map((item) => item.operationId));
        expect(paged.length).toBeLessThanOrEqual(3);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(paged.sort()).toEqual([first.operationId, second.operationId, last.operationId].sort());
      for (const previous of [first, second]) {
        expect(history.items.find((item) => item.operationId === previous.operationId)).toMatchObject({ resolvedByOperationId: last.operationId, completedAt: expect.any(String), stationId: first.context.stationId });
      }
      expect(history.items.find((item) => item.operationId === first.operationId)?.result).toEqual({ state: "dependency_unavailable" });
      expect(history.items.find((item) => item.operationId === second.operationId)?.result).toEqual({ state: "needs_affiliation_choice" });
      for (const original of originals) expect(await t.pb.collection("checkin_arrival_commands").getOne(original.id)).toEqual(original);
      for (const original of audit) expect(await t.pb.collection("checkin_audit_events").getOne(original.id)).toEqual(original);
      await t.restart();
      expect(await service.preflight(t.token, first)).toEqual({ ...failed, replayed: true });
      expect(await service.preflight(t.token, second)).toEqual({ ...choice, replayed: true });
      // Age only disposable timestamps; final-result audit is the resolution clock.
      sql(t, "UPDATE checkin_audit_events SET created = '2020-01-01 00:00:00.000Z' WHERE operation = 'arrival_result'");
      sql(t, "UPDATE checkin_arrival_commands SET created = '2020-01-01 00:00:00.000Z', completed_day = CASE WHEN completed_at != '' THEN '2020-01-01' ELSE '' END, completed_at = CASE WHEN completed_at != '' THEN '2020-01-01 00:00:00.000Z' ELSE '' END");
      const expected = outcome === "rejected" ? [] : [last.operationId];
      expect((await service.history(t.token, { limit: 1 })).items.map((item) => item.operationId)).toEqual(expected);
      expect((await new CheckinArrivalService(t.pb, t.admin.actor, source).history(undefined, { scope: "all", limit: 1 })).items.map((item) => item.operationId)).toEqual(expected);
    } finally { await runtime.coordinator.close(); await t.cleanup(); }
  });
}

it("denies browser and Pi ledger access and omits sensitive source fields from durable and machine surfaces", { timeout: 60_000 }, async () => {
  const t = await setup(); const runtime = await ready(t); await runtime.coordinator.listen();
  try {
    await runtime.heartbeat();
    const secret = "private-attendee@example.test";
    const source: CheckinArrivalSource = { ...t.source, resolve: async (...args) => {
      const value = await t.source.resolve(...args);
      if (value.state !== "eligible") throw new Error("Expected test attendee");
      return { ...value, attendee: { ...value.attendee, email: secret, rawResponse: { capability: "private-list-capability" } } };
    } };
    const service = new CheckinArrivalService(t.pb, t.operator.actor, source);
    const command = { ...t.command(), context: await context(t) };
    expect((await service.preflight(t.token, command)).state).toBe("reserved");
    const pi = new PocketBase(t.baseUrl); pi.authStore.save(runtime.issued.credential!);
    const anonymous = new PocketBase(t.baseUrl);
    for (const client of [t.operator.client, t.admin.client, pi, anonymous]) {
      await expect(client.send("/api/wts/checkin-arrivals", { method: "POST", body: { operation: "history", actorUserId: t.admin.record.id, query: { scope: "all", limit: 30 } } })).rejects.toThrow();
      for (const collection of ["checkin_arrival_commands", "checkin_arrival_workflows"]) {
        const row = (await t.pb.collection(collection).getFullList())[0];
        await expect(client.collection(collection).getList()).rejects.toThrow();
        await expect(client.collection(collection).getOne(row.id)).rejects.toThrow();
        await expect(client.collection(collection).create({ ...row, id: undefined })).rejects.toThrow();
        await expect(client.collection(collection).update(row.id, { station_id: "wts2026station2", name: "Changed" })).rejects.toThrow();
        await expect(client.collection(collection).delete(row.id)).rejects.toThrow();
      }
    }
    const durable = JSON.stringify(await Promise.all(["checkin_arrival_commands", "checkin_arrival_workflows", "checkin_audit_events"].map((collection) => t.pb.collection(collection).getFullList())));
    const history = JSON.stringify(await service.history(t.token));
    for (const hidden of [secret, "private-list-capability", qrIdentity, t.token, runtime.issued.credential!]) {
      expect(durable).not.toContain(hidden); expect(history).not.toContain(hidden); expect(t.logs()).not.toContain(hidden);
    }
    for (const collection of ["checkin_agent_attempts", "checkin_agent_authorizations"]) expect(await t.pb.collection(collection).getFullList()).toEqual([]);
  } finally { await runtime.coordinator.close(); await t.cleanup(); }
});

it("converges simultaneous identical commands across actors and treats missing affiliation as blank", { timeout: 60_000 }, async () => {
  const t = await setup(); const runtime = await ready(t); await runtime.coordinator.listen();
  try {
    await runtime.heartbeat();
    const command = { ...t.command(), context: await context(t) };
    const source: CheckinArrivalSource = { ...t.source, affiliation: async () => ({ state: "missing" }) };
    const independent = new PocketBase(t.baseUrl); independent.authStore.save(t.pb.authStore.token, t.pb.authStore.record);
    const results = await Promise.all([
      new CheckinArrivalService(t.pb, t.operator.actor, source).preflight(t.token, command),
      new CheckinArrivalService(independent, t.admin.actor, source).preflight(t.token, command),
    ]);
    for (const result of results) expect(result).toMatchObject({ state: "reserved", workflow: { affiliation: "", state: "not_submitted" }, operationsEnabled: false });
    expect(results.map((result) => result.replayed).sort((left, right) => Number(left) - Number(right))).toEqual([false, true]);
    expect(await t.pb.collection("checkin_arrival_commands").getFullList()).toHaveLength(1);
    expect(await t.pb.collection("checkin_arrival_workflows").getFullList()).toHaveLength(1);
    expect((await t.service.history(t.token)).items).toHaveLength(1);
    for (const collection of ["checkin_agent_attempts", "checkin_agent_authorizations"]) expect(await t.pb.collection(collection).getFullList()).toEqual([]);
  } finally { await runtime.coordinator.close(); await t.cleanup(); }
});

it("rolls back workflow, final command and audit atomically, then exact retry survives reload", { timeout: 60_000 }, async () => {
  const t = await setup(); const runtime = await ready(t); await runtime.coordinator.listen();
  try {
    await runtime.heartbeat();
    const command = { ...t.command(), context: await context(t) };
    // Fault injection changes only this disposable DB, never feature hooks/migrations.
    sql(t, "CREATE TRIGGER fail_arrival_result BEFORE INSERT ON checkin_audit_events WHEN NEW.operation = 'arrival_result' BEGIN SELECT RAISE(ABORT, 'synthetic storage failure'); END");
    await expect(t.service.preflight(t.token, command)).rejects.toMatchObject({ code: "unavailable" });
    await noEffects(t);
    const rows = await t.pb.collection("checkin_arrival_commands").getFullList();
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ status: "pending", workflow_id: "", result: null });
    expect(await t.pb.collection("checkin_audit_events").getFullList({ filter: "operation = 'arrival_result'" })).toEqual([]);
    expect(await t.pb.collection("checkin_audit_events").getFullList({ filter: "operation = 'arrival_begin'" })).toHaveLength(1);
    sql(t, "DROP TRIGGER fail_arrival_result");
    const result = await t.service.preflight(t.token, command);
    expect(result.state).toBe("reserved");
    expect(await t.pb.collection("checkin_arrival_workflows").getFullList()).toHaveLength(1);
    expect(await t.pb.collection("checkin_audit_events").getFullList({ filter: "operation = 'arrival_result'" })).toHaveLength(1);
    // Exercise actual database uniqueness, independent of request-level guards.
    const duplicate = "INSERT INTO checkin_arrival_workflows (id,edition,upstream_event_id,upstream_attendee_id) SELECT 'duplicaterow000',edition,upstream_event_id,upstream_attendee_id FROM checkin_arrival_workflows";
    expect(() => sql(t, duplicate)).toThrow(/UNIQUE/);
    expect(() => sql(t, "INSERT INTO checkin_arrival_commands (id,operation_id) SELECT 'duplicatecmd000',operation_id FROM checkin_arrival_commands")).toThrow(/UNIQUE/);
    await t.restart();
    expect(await t.service.preflight(t.token, command)).toEqual({ ...result, replayed: true });
    for (const mutation of [{ qrIdentity: "A-ZYX9876" }, { affiliationChoice: "blank" as const }, { priorOperationId: crypto.randomUUID() }, { context: { ...command.context, eventGeneration: 2 } }]) {
      await expect(t.service.preflight(t.token, { ...command, ...mutation })).rejects.toMatchObject({ code: "conflict" });
    }
    expect(await t.pb.collection("checkin_arrival_commands").getFullList()).toHaveLength(1);
  } finally { await runtime.coordinator.close(); await t.cleanup(); }
});

it("paginates all earlier unresolved work plus only current-day completed results without duplicates", { timeout: 60_000 }, async () => {
  const t = await setup();
  try {
    const unresolved = [t.command(), t.command(), t.command()];
    for (const command of unresolved) await t.service.preflight(t.token, command);
    const completed = [t.command(), t.command(), t.command()];
    for (const command of completed) await t.service.preflight(t.token, { ...command, qrIdentity: "not-an-attendee" });
    // Historical timestamps are fixture setup; public commands above created every record.
    for (const command of unresolved) sql(t, "UPDATE checkin_arrival_commands SET created = '2020-01-01 00:00:00.000Z' WHERE operation_id = ?", command.operationId);
    sql(t, "UPDATE checkin_arrival_commands SET created = '2020-01-01 00:00:00.000Z', completed_day = '2020-01-01', completed_at = '2020-01-01 00:00:00.000Z' WHERE operation_id = ?", completed[0].operationId);
    const seen: string[] = []; let cursor: string | undefined;
    do {
      const page = await t.service.history(t.token, { limit: 2, cursor });
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((entry) => entry.operationId));
      cursor = page.nextCursor ?? undefined;
      expect(seen.length).toBeLessThanOrEqual(5);
    } while (cursor);
    expect(seen.sort()).toEqual([...unresolved, ...completed.slice(1)].map((command) => command.operationId).sort());
    expect(new Set(seen).size).toBe(5);
    const admin = new CheckinArrivalService(t.pb, t.admin.actor, t.source);
    expect((await admin.history(undefined, { scope: "all" })).items).toHaveLength(5);
    await t.pb.collection("users").update(t.admin.record.id, { role: "checkin_operator" });
    await expect(admin.history(undefined, { scope: "all" })).rejects.toMatchObject({ code: "forbidden" });
  } finally { await t.cleanup(); }
});

it("durably records dependency-unavailable preflight and exact global command replay without any effect", { timeout: 60_000 }, async () => {
  const t = await setup();
  try {
    const command = t.command();
    const result = await t.service.preflight(t.token, command);
    expect(result).toEqual({ operationId: command.operationId, replayed: false, operationsEnabled: false, state: "dependency_unavailable" });
    await t.restart();
    const other = new CheckinArrivalService(t.pb, t.admin.actor, t.source);
    expect(await other.preflight(t.token, command)).toEqual({ ...result, replayed: true });
    await expect(other.preflight(t.token, { ...command, qrIdentity: "22222222-2222-4222-8222-222222222222" })).rejects.toMatchObject({ code: "conflict" });
    expect((await t.service.history(t.token)).items).toHaveLength(1);
    expect(await t.pb.collection("checkin_arrival_workflows").getFullList()).toEqual([]);
    expect(await t.pb.collection("checkin_agent_attempts").getFullList()).toEqual([]);
    const ledger = JSON.stringify(await t.pb.collection("checkin_arrival_commands").getFullList());
    expect(ledger).not.toContain(qrIdentity);
    expect(ledger).not.toContain(t.operator.record.email);
  } finally { await t.cleanup(); }
});

it("races independent actors and stations into one immutable not-submitted workflow, with bounded foreign replay", { timeout: 60_000 }, async () => {
  const t = await setup(); const first = await ready(t); await first.coordinator.listen();
  try {
    const second = await ready(t, "wts2026station2", first.coordinator);
    await first.heartbeat(); await second.heartbeat();
    const code = second.code;
    const otherToken = "d".repeat(64);
    await t.control.bind(code, otherToken, (await t.control.preview(code)).confirmation);
    const a = { ...t.command(), context: await context(t) };
    const b = { ...t.command(), context: await context(t, otherToken) };
    const pb2 = new PocketBase(t.baseUrl); pb2.authStore.save(t.pb.authStore.token, t.pb.authStore.record);
    const other = new CheckinArrivalService(pb2, t.admin.actor, t.source);
    const results = await Promise.all([t.service.preflight(t.token, a), other.preflight(otherToken, b)]);
    expect(results.map((r) => r.state).sort()).toEqual(["already_handled", "reserved"]);
    const saved = results.find((r) => r.state === "reserved")!;
    if (saved.state !== "reserved") throw new Error("Expected reservation");
    expect(saved.workflow).toMatchObject({ state: "not_submitted", name: "Тест Attendee", affiliation: "Test organisation" });
    const owning = saved.workflow.stationId === a.context.stationId ? { token: t.token, input: a } : { token: otherToken, input: b };
    const foreign = owning.token === t.token ? otherToken : t.token;
    expect(await other.preflight(owning.token, owning.input)).toEqual({ ...saved, replayed: true });
    expect(await other.preflight(foreign, owning.input)).toEqual({ state: "already_handled", operationId: owning.input.operationId, replayed: true, operationsEnabled: false });
    const rows = await t.pb.collection("checkin_arrival_workflows").getFullList(); expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: "not_submitted", upstream_attendee_id: "501", list_id: "201", profile_id: saved.workflow.profileId });
    for (const collection of ["checkin_agent_attempts", "checkin_agent_authorizations"]) expect(await t.pb.collection(collection).getFullList()).toEqual([]);
    await t.restart();
    expect(await t.service.preflight(owning.token, owning.input)).toEqual({ ...saved, replayed: true });
    expect((await other.history(foreign)).items).toEqual([]);
    expect((await other.history(foreign, { scope: "all" })).items).toHaveLength(1);
    await expect(t.service.history(t.token, { scope: "all" })).rejects.toMatchObject({ code: "forbidden" });
    const ledger = JSON.stringify(await Promise.all(["checkin_arrival_commands", "checkin_arrival_workflows", "checkin_audit_events"].map((c) => t.pb.collection(c).getFullList())));
    for (const hidden of [qrIdentity, t.operator.record.email, t.token, first.issued.credential!]) expect(ledger).not.toContain(hidden);
    for (const collection of ["checkin_arrival_commands", "checkin_arrival_workflows"]) {
      await expect(t.operator.client.collection(collection).getList()).rejects.toMatchObject({ status: 403 });
      await expect(t.operator.client.collection(collection).create({})).rejects.toThrow();
      await expect(t.pb.collection(collection).create({})).rejects.toThrow();
      const row = (await t.pb.collection(collection).getFullList())[0];
      await expect(t.operator.client.collection(collection).getOne(row.id)).rejects.toThrow();
      await expect(t.pb.collection(collection).update(row.id, { name: "Changed" })).rejects.toThrow();
      await expect(t.pb.collection(collection).delete(row.id)).rejects.toThrow();
    }
  } finally { await first.coordinator.close(); await t.cleanup(); }
});

it("releases a claim when pre-send reads are unavailable and permits a later retry", { timeout: 60_000 }, async () => {
  const t = await setup(); const runtime = await ready(t); await runtime.coordinator.listen();
  try {
    await runtime.heartbeat();
    const command = { ...t.command(), context: await context(t) };
    expect(await t.service.preflight(t.token, command)).toMatchObject({ state: "reserved" });
    expect(await runtime.coordinator.processAdmissions({ attendee: async () => null, admit: async () => { throw new Error("must not send"); } })).toBe(1);
    expect(await t.pb.collection("checkin_arrival_workflows").getFirstListItem("state = 'not_submitted'")).toMatchObject({ state: "not_submitted" });
    const attemptsAfterRelease = await t.pb.collection("checkin_arrival_attempts").getFullList();
    expect(attemptsAfterRelease).toHaveLength(1);
    expect(attemptsAfterRelease[0]).toMatchObject({ state: "pre_send_failed", pre_send_failures: 1, next_retry_at: expect.any(String) });
    expect(await runtime.coordinator.processAdmissions({ attendee: async () => { throw new Error("backoff must hold"); }, admit: async () => { throw new Error("must not send"); } })).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Date.parse(attemptsAfterRelease[0].next_retry_at) - Date.now()) + 30));
    let posts = 0;
    expect(await runtime.coordinator.processAdmissions({
      attendee: async (job) => ({ upstreamAttendeeId: job.upstreamAttendeeId, publicId: qrIdentity, productId: "401", alreadyCheckedIn: false }),
      admit: async () => { posts++; return { state: "newly_checked_in", fingerprint: "f".repeat(64) }; },
    })).toBe(1);
    expect(posts).toBe(1);
    expect(await t.pb.collection("checkin_arrival_workflows").getFirstListItem("state = 'accepted'")).toMatchObject({ state: "accepted" });
  } finally { await runtime.coordinator.close(); await t.cleanup(); }
});

it("claims one reservation before the upstream POST and atomically creates exactly one initial print intent", { timeout: 60_000 }, async () => {
  const t = await setup(); const runtime = await ready(t); await runtime.coordinator.listen();
  try {
    await runtime.heartbeat();
    const command = { ...t.command(), context: await context(t) };
    expect(await t.service.preflight(t.token, command)).toMatchObject({ state: "reserved" });
    let posts = 0;
    const processed = await runtime.coordinator.processAdmissions({
      attendee: async (job) => ({ upstreamAttendeeId: job.upstreamAttendeeId, publicId: qrIdentity, productId: "401", alreadyCheckedIn: false }),
      admit: async () => { posts++; return { state: "newly_checked_in", fingerprint: "d".repeat(64) }; },
    });
    expect(processed).toBe(1); expect(posts).toBe(1);
    const workflow = await t.pb.collection("checkin_arrival_workflows").getFirstListItem("state = 'accepted'");
    expect(workflow).toMatchObject({ state: "accepted", admission_completed_day: expect.any(String) });
    const attempts = await t.pb.collection("checkin_arrival_attempts").getFullList();
    expect(attempts).toHaveLength(1); expect(attempts[0]).toMatchObject({ state: "accepted", result_fingerprint: "d".repeat(64) });
    const prints = await t.pb.collection("checkin_print_attempts").getFullList();
    expect(prints).toHaveLength(1); expect(prints[0]).toMatchObject({ workflow_id: workflow.id, purpose: "initial", state: "queued", name: "Тест Attendee", affiliation: "Test organisation", profile_snapshot: { approval: "approved" } });
    const commandRow = await t.pb.collection("checkin_arrival_commands").getFirstListItem(`operation_id = '${command.operationId}'`);
    expect(commandRow.result).toMatchObject({ state: "accepted", printIntentId: prints[0].id });
    expect(await runtime.coordinator.processAdmissions({ attendee: async () => null, admit: async () => { posts++; return { state: "uncertain" }; } })).toBe(0);
    expect(posts).toBe(1);
  } finally { await runtime.coordinator.close(); await t.cleanup(); }
});

it("keeps a lost admission outcome uncertain and never automatically repeats its POST", { timeout: 60_000 }, async () => {
  const t = await setup(); const runtime = await ready(t); await runtime.coordinator.listen();
  try {
    await runtime.heartbeat();
    const command = { ...t.command(), context: await context(t) };
    await t.service.preflight(t.token, command);
    let posts = 0;
    await expect(runtime.coordinator.processAdmissions({
      attendee: async (job) => ({ upstreamAttendeeId: job.upstreamAttendeeId, publicId: qrIdentity, productId: "401", alreadyCheckedIn: false }),
      admit: async () => { posts++; throw new Error("lost response"); },
    })).resolves.toBe(1);
    expect(posts).toBe(1);
    expect(await t.pb.collection("checkin_arrival_workflows").getFirstListItem("state = 'admission_uncertain'")).toMatchObject({ state: "admission_uncertain", print_intent_id: "" });
    expect(await t.pb.collection("checkin_print_attempts").getFullList()).toEqual([]);
    expect(await runtime.coordinator.processAdmissions({ attendee: async () => null, admit: async () => { posts++; return { state: "newly_checked_in", fingerprint: "e".repeat(64) }; } })).toBe(0);
    expect(posts).toBe(1);
  } finally { await runtime.coordinator.close(); await t.cleanup(); }
});

it("delivers one accepted initial label through the authenticated journaled agent", { timeout: 60_000 }, async () => {
  const t = await setup(); const runtime = await ready(t); const coordinatorUrl = await runtime.coordinator.listen();
  const identity = { stationId: "wts2026station1" as const, agentIdentity: "test-pi", printerIdentity: "test-printer", journalIdentity: "test-journal", profileId: runtime.saved.profile.id };
  const journalPath = join(t.root, "agent-journal.sqlite");
  AgentJournal.provision(journalPath, identity);
  const journal = new AgentJournal(journalPath, identity);
  try {
    const agent = new AgentRuntime(identity, journal, new HttpAgentTransport(coordinatorUrl, runtime.issued.credential!));
    expect((await agent.heartbeat()).station.readyForAuthorization).toBe(true);
    const command = { ...t.command(), context: await context(t) };
    expect(await t.service.preflight(t.token, command)).toMatchObject({ state: "reserved" });
    expect(await runtime.coordinator.processAdmissions({
      attendee: async (job) => ({ upstreamAttendeeId: job.upstreamAttendeeId, publicId: qrIdentity, productId: "401", alreadyCheckedIn: false }),
      admit: async () => ({ state: "newly_checked_in", fingerprint: "a".repeat(64) }),
    })).toBe(1);
    expect(await runtime.coordinator.claimPrints()).toBe(1);
    const work = await agent.work();
    expect(work.attempts).toHaveLength(1);
    expect(work.attempts[0].payload).toMatchObject({ purpose: "initial", text: { name: "Тест Attendee", affiliation: "Test organisation" } });
    const printer = new SimulatedNiimbotPrinter(identity.printerIdentity);
    await expect(agent.process(work.attempts[0], printer)).resolves.toBe("protocol_complete");
    expect(printer.printed).toHaveLength(1);
    expect(await t.pb.collection("checkin_print_attempts").getFullList()).toMatchObject([{ state: "completed", purpose: "initial" }]);
    expect(await t.pb.collection("checkin_agent_authorizations").getFullList()).toMatchObject([{ outcome: "protocol_complete" }]);
  } finally { journal.close(); await runtime.coordinator.close(); await t.cleanup(); }
});
