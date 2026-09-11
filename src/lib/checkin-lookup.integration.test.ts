import { expect, it } from "vite-plus/test";
import { CheckinLookupService } from "~/lib/checkin-lookup-service";
import type { CheckinLookupSource } from "~/lib/checkin-lookup-hievents";
import { setup, events, ready, context } from "~/lib/checkin-lookup-test-helper";
import { CheckinEventService } from "~/lib/checkin-event-service";
import type { CheckinArrivalSource } from "~/lib/checkin-arrival-source";

for (const outcome of ["dependency_unavailable", "rejected", "needs_affiliation_choice"] as const) it(`conflicts on altered selected ID for durable ${outcome}`, { timeout: 60_000 }, async () => {
  const t = await setup(); const runtime = await ready(t); await runtime.coordinator.listen();
  try {
    await runtime.heartbeat();
    const source: CheckinArrivalSource = { ...t.source,
      resolve: outcome === "dependency_unavailable" ? async () => ({ state: "unavailable" }) : outcome === "rejected" ? async () => ({ state: "rejected", reason: "not_in_list" }) : t.source.resolve,
      affiliation: async () => ({ state: "unavailable" }),
    };
    const service = new CheckinLookupService(t.pb, t.operator.actor, lookup(), source);
    const command = { ...t.command(), context: await context(t), attendeeId: "501" };
    expect(await service.confirm(t.token, command)).toMatchObject({ state: outcome });
    await expect(service.confirm(t.token, { ...command, attendeeId: "999" })).rejects.toMatchObject({ code: "conflict" });
    await noEffects(t);
  } finally { await runtime.coordinator.close(); await t.cleanup(); }
});

type Fixture = Awaited<ReturnType<typeof setup>>;
async function noEffects(t: Fixture) {
  for (const name of ["checkin_arrival_workflows", "checkin_agent_attempts", "checkin_agent_authorizations"]) expect(await t.pb.collection(name).getFullList()).toEqual([]);
}
async function mutate(t: Fixture, change: string) {
  if (change === "role") await t.pb.collection("users").update(t.operator.record.id, { role: "user" });
  if (change === "selection") await context(t);
  if (change === "event") await new CheckinEventService(t.pb, t.admin.actor, events).configure({ operationId: crypto.randomUUID(), expectedGeneration: 1, upstreamEventId: "101", member: true, enabled: false, listId: "201", affiliation: null, reason: "configuration" });
  if (change === "binding") await t.control.adminControl({ operation: "revoke_binding", operationId: crypto.randomUUID(), bindingId: t.command().context.bindingId, expectedVersion: t.command().context.bindingVersion, reason: "security" });
  if (change === "rebind") {
    const stationId = "wts2026station2";
    await t.control.adminControl({ operation: "set_station_enabled", operationId: crypto.randomUUID(), stationId, expectedVersion: 1, enabled: true, reason: "configuration" });
    const code = (await t.control.adminControl({ operation: "rotate_provision_code", operationId: crypto.randomUUID(), stationId, expectedVersion: 2, reason: "configuration" })).provisionCode!;
    await t.control.bind(code, t.token, (await t.control.preview(code, t.token)).confirmation);
  }
}

const person = { attendeeId: "501", publicId: "A-ABC1234", name: "Тест Attendee", email: "private-lookup@example.test" };
function lookup(): CheckinLookupSource {
  return { sourceKey: events.sourceKey, search: async () => ({ state: "complete", attendees: [person] }), identity: async () => ({ state: "complete", attendees: [person] }) };
}
it("returns transient search results with the exact context and no durable search/arrival records", { timeout: 60_000 }, async () => {
  const t = await setup();
  try {
    const before = await t.pb.collection("checkin_audit_events").getFullList();
    const service = new CheckinLookupService(t.pb, t.operator.actor, lookup(), t.source);
    expect(await service.search(t.token, { context: t.command().context, query: person.email })).toEqual({ state: "complete", context: t.command().context, items: [person], nextOffset: null });
    expect(await t.pb.collection("checkin_audit_events").getFullList()).toEqual(before);
    for (const name of ["checkin_arrival_commands", "checkin_arrival_workflows", "checkin_agent_attempts", "checkin_agent_authorizations"]) expect(await t.pb.collection(name).getFullList()).toEqual([]);
  } finally { await t.cleanup(); }
});

it("pages ambiguous names without truncating matches or confusing failures with empty success", { timeout: 60_000 }, async () => {
  const t = await setup();
  try {
    const people = Array.from({ length: 41 }, (_, n) => ({ ...person, attendeeId: String(501 + n), publicId: `A-${String(n).padStart(7, "0")}` }));
    const source = lookup(); source.search = async () => ({ state: "complete", attendees: people });
    const service = new CheckinLookupService(t.pb, t.operator.actor, source, t.source);
    const input = { context: t.command().context, query: "Attendee" };
    const first = await service.search(t.token, input);
    expect(first.items).toEqual(people.slice(0, 20)); expect(first.nextOffset).toBe(20);
    const second = await service.search(t.token, { ...input, offset: 20 });
    expect(second.items).toEqual(people.slice(20, 40)); expect(second.nextOffset).toBe(40);
    expect(await service.search(t.token, { ...input, offset: 40 })).toMatchObject({ state: "complete", items: people.slice(40), nextOffset: null });
    source.search = async () => ({ state: "complete", attendees: [] });
    expect(await service.search(t.token, input)).toMatchObject({ state: "complete", items: [], nextOffset: null });
    for (const state of ["partial", "unavailable"] as const) {
      source.search = async () => ({ state });
      expect(await service.search(t.token, input)).toMatchObject({ state, items: [], nextOffset: null });
    }
    source.search = async () => { throw new Error("private diagnostic"); };
    expect(await service.search(t.token, input)).toMatchObject({ state: "unavailable", items: [], nextOffset: null });
    await noEffects(t);
  } finally { await t.cleanup(); }
});

for (const phase of ["before", "during"] as const) for (const change of ["role", "binding", "rebind", "event", "selection"]) {
  it(`fences search ${phase} ${change} changes without returning private results`, { timeout: 60_000 }, async () => {
    const t = await setup();
    try {
      const input = { context: t.command().context, query: person.email };
      const source = lookup(); let reads = 0;
      source.search = async () => { reads++; if (phase === "during") await mutate(t, change); return { state: "complete", attendees: [person] }; };
      if (phase === "before") await mutate(t, change);
      const service = new CheckinLookupService(t.pb, t.operator.actor, source, t.source);
      await expect(service.search(t.token, input)).rejects.toMatchObject({ code: change === "role" ? "forbidden" : change === "binding" ? "revoked_binding" : "conflict" });
      expect(reads).toBe(phase === "before" ? 0 : 1);
      await noEffects(t);
    } finally { await t.cleanup(); }
  });
}

it("binds selection to the resolved public identity and never accepts forged attendees or removed list members", { timeout: 60_000 }, async () => {
  const t = await setup(); const runtime = await ready(t); await runtime.coordinator.listen();
  try {
    await runtime.heartbeat(); const current = await context(t);
    const service = new CheckinLookupService(t.pb, t.operator.actor, lookup(), t.source);
    expect(await service.confirm(t.token, { ...t.command(), context: current, attendeeId: "999" })).toMatchObject({ state: "rejected", reason: "invalid_identity" });
    expect(await service.confirm(t.token, { ...t.command(), context: current, attendeeId: person.attendeeId, qrIdentity: "A-ZZZ1234" })).toMatchObject({ state: "rejected", reason: "invalid_identity" });
    const removed: CheckinArrivalSource = { ...t.source, resolve: async () => ({ state: "rejected", reason: "not_in_list" }) };
    expect(await new CheckinLookupService(t.pb, t.operator.actor, lookup(), removed).confirm(t.token, { ...t.command(), context: current, attendeeId: person.attendeeId })).toMatchObject({ state: "rejected", reason: "not_in_list" });
    await noEffects(t);
  } finally { await runtime.coordinator.close(); await t.cleanup(); }
});

it("deduplicates explicit confirmation with QR intake, survives restart and upstream loss, and persists no lookup email/query/raw identity", { timeout: 60_000 }, async () => {
  const t = await setup(); const runtime = await ready(t); await runtime.coordinator.listen();
  try {
    await runtime.heartbeat(); const current = await context(t);
    const source = lookup();
    const service = new CheckinLookupService(t.pb, t.operator.actor, source, t.source);
    const command = { ...t.command(), context: current, attendeeId: person.attendeeId };
    await service.search(t.token, { context: current, query: person.email });
    await noEffects(t);
    const first = await service.confirm(t.token, command);
    expect(first.state).toBe("reserved");
    expect(await service.confirm(t.token, command)).toEqual({ ...first, replayed: true });
    expect(await service.confirm(t.token, { ...command, operationId: crypto.randomUUID() })).toMatchObject({ state: "existing" });
    const { attendeeId: _selected, ...qrCommand } = command;
    expect(await t.service.preflight(t.token, { ...qrCommand, operationId: crypto.randomUUID() })).toMatchObject({ state: "existing" });
    await expect(service.confirm(t.token, { ...command, attendeeId: "999" })).rejects.toMatchObject({ code: "conflict" });
    expect(await t.pb.collection("checkin_arrival_workflows").getFullList()).toHaveLength(1);
    for (const name of ["checkin_agent_attempts", "checkin_agent_authorizations"]) expect(await t.pb.collection(name).getFullList()).toEqual([]);
    const records: unknown[] = [];
    for (const collection of (await t.pb.collections.getFullList()).filter(row => row.name.startsWith("checkin_"))) records.push(...await t.pb.collection(collection.name).getFullList());
    const surfaces = JSON.stringify(records) + JSON.stringify(await t.service.history(t.token)) + t.logs();
    expect(surfaces).not.toContain(person.email); expect(surfaces).not.toContain(person.publicId);
    expect(surfaces).not.toContain('"query"');
    await runtime.coordinator.close(); await t.restart();
    let reads = 0;
    const unavailable: CheckinArrivalSource = { sourceKey: events.sourceKey, resolve: async () => { reads++; return { state: "unavailable" }; }, affiliation: async () => { reads++; return { state: "unavailable" }; } };
    source.search = source.identity = async () => { reads++; return { state: "unavailable" }; };
    expect(await new CheckinLookupService(t.pb, t.operator.actor, source, unavailable).confirm(t.token, command)).toEqual({ ...first, replayed: true });
    expect(reads).toBe(0);
  } finally { await runtime.coordinator.close(); await t.cleanup(); }
});

for (const phase of ["before", "affiliation"] as const) for (const change of ["role", "binding", "rebind", "event", "selection"]) {
  it(`fences confirm ${phase} ${change} changes at durable acceptance`, { timeout: 60_000 }, async () => {
    const t = await setup(); const runtime = await ready(t); await runtime.coordinator.listen();
    try {
      await runtime.heartbeat(); const command = { ...t.command(), context: await context(t), attendeeId: person.attendeeId };
      const source: CheckinArrivalSource = { ...t.source, affiliation: async (...args) => { if (phase === "affiliation") await mutate(t, change); return t.source.affiliation(...args); } };
      if (phase === "before") await mutate(t, change);
      await expect(new CheckinLookupService(t.pb, t.operator.actor, lookup(), source).confirm(t.token, command)).rejects.toMatchObject({ code: change === "role" ? "forbidden" : change === "binding" ? "revoked_binding" : "conflict" });
      await noEffects(t);
    } finally { await runtime.coordinator.close(); await t.cleanup(); }
  });
}
