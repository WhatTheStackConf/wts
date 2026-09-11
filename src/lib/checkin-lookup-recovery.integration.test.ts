import { expect, it } from "vite-plus/test";
import { createHash } from "node:crypto";
import { CheckinLookupService } from "~/lib/checkin-lookup-service";
import { CheckinLifecycleService } from "~/lib/checkin-lifecycle-service";
import { checkinEventBindingHash } from "~/lib/checkin-event-service";
import type { CheckinLookupSource } from "~/lib/checkin-lookup-hievents";
import { setup, events, ready, context } from "~/lib/checkin-lookup-test-helper";
const person = { attendeeId: "501", publicId: "A-ABC1234", name: "Synthetic", email: "private@example.test" };
const lookup = (): CheckinLookupSource => ({ sourceKey: events.sourceKey, search: async () => ({ state: "complete", attendees: [person] }), identity: async () => ({ state: "complete", attendees: [person] }) });

it("recovers opaque failed reads and a linked blank command exactly, without fresh accepted intake", { timeout: 60_000 }, async () => {
  const t = await setup(); const runtime = await ready(t); await runtime.coordinator.listen();
  try {
    await runtime.heartbeat(); const current = await context(t); let identities = 0;
    const source = lookup(); source.identity = async (snapshot, attendeeId) => { identities++; expect(snapshot.context).toEqual(current); expect(attendeeId).toBe("501"); return { state: "complete", attendees: [person] }; };
    const service = new CheckinLookupService(t.pb, t.operator.actor, source, { ...t.source, affiliation: async () => ({ state: "unavailable" }) });
    const command = { ...t.command(), context: current, attendeeId: "501" };
    const failed = await service.confirm(t.token, command);
    expect(await service.getRecovery(t.token, command.operationId)).toMatchObject({ state: "needs_affiliation_choice", actions: ["replay", "retry", "blank"], result: { ...failed, replayed: true } });
    expect(await service.recover(t.token, { operationId: command.operationId, action: "replay" })).toEqual({ ...failed, replayed: true });
    expect(identities).toBe(0);
    const continuation = { operationId: command.operationId, action: "blank" as const, nextOperationId: crypto.randomUUID() };
    const reserved = await service.recover(t.token, continuation); expect(reserved.state).toBe("reserved");
    expect(await service.recover(t.token, continuation)).toEqual({ ...reserved, replayed: true });
    expect(identities).toBe(1);
    await expect(service.recover(t.token, { ...continuation, nextOperationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "conflict" });
    await expect(service.recover(t.token, { operationId: continuation.nextOperationId, action: "retry", nextOperationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "conflict" });
    expect(await t.pb.collection("checkin_arrival_workflows").getFullList()).toHaveLength(1);
    for (const name of ["checkin_agent_attempts", "checkin_agent_authorizations"]) expect(await t.pb.collection(name).getFullList()).toHaveLength(0);
    const rows = JSON.stringify(await t.pb.collection("checkin_lookup_commands").getFullList());
    for (const value of [person.publicId, person.name, person.email, '"query"']) expect(rows).not.toContain(value);
    await runtime.coordinator.close(); await t.restart();
    source.identity = async () => { throw new Error("must not read"); };
    const restarted = new CheckinLookupService(t.pb, t.admin.actor, source, t.source);
    expect(await restarted.getRecovery(t.token, continuation.nextOperationId)).toMatchObject({ recovery: "context_changed", actions: [], result: { ...reserved, replayed: true } });
    await expect(restarted.recover(t.token, { operationId: continuation.nextOperationId, action: "replay" })).rejects.toMatchObject({ code: "conflict" });
  } finally { await runtime.coordinator.close(); await t.cleanup(); }
});

for (const mutation of ["none", "pending", "qr", "role", "selection"] as const) it(`reacquires a mapping-only pending command with ${mutation} fence`, { timeout: 60_000 }, async () => {
  const t = await setup(); const runtime = await ready(t); await runtime.coordinator.listen();
  try {
    await runtime.heartbeat(); const input = { ...t.command(), context: await context(t), attendeeId: "501" };
    const { qrIdentity, ...command } = input;
    await t.pb.send("/api/wts/checkin-lookup-commands", { method: "POST", body: { operation: "bind", operationId: command.operationId, identityHash: checkinEventBindingHash(t.token), actorUserId: t.operator.actor.userId, sourceKey: events.sourceKey, command: { ...command, priorOperationId: "", qrHash: createHash("sha256").update(`wts2026:arrival:${qrIdentity}`).digest("hex") } } });
    if (mutation === "pending") {
      const { attendeeId: _selected, ...base } = command;
      const started = await t.pb.send<{ snapshot: unknown }>("/api/wts/checkin-arrivals", { method: "POST", body: { operation: "begin", identityHash: checkinEventBindingHash(t.token), actorUserId: t.operator.actor.userId, sourceKey: events.sourceKey, command: { ...base, priorOperationId: "", qrHash: createHash("sha256").update(`wts2026:arrival:${qrIdentity}`).digest("hex") } } });
      expect(started.snapshot).toBeTruthy();
    }
    const source = lookup(); source.identity = async () => {
      if (mutation === "role") await t.pb.collection("users").update(t.operator.actor.userId, { role: "user" });
      if (mutation === "selection") await context(t);
      return { state: "complete", attendees: [{ ...person, publicId: mutation === "qr" ? "A-ZZZ1234" : person.publicId }] };
    };
    const service = new CheckinLookupService(t.pb, t.operator.actor, source, t.source);
    expect(await service.getRecovery(t.token, input.operationId)).toMatchObject({ state: "pending", actions: ["replay"] });
    expect(await t.pb.collection("checkin_arrival_commands").getFullList()).toHaveLength(mutation === "pending" ? 1 : 0);
    const action = service.recover(t.token, { operationId: input.operationId, action: "replay" });
    if (mutation === "none" || mutation === "pending") {
      expect(await action).toMatchObject({ state: "reserved", operationId: input.operationId });
      expect(await t.pb.collection("checkin_arrival_commands").getFullList()).toHaveLength(1);
    } else {
      await expect(action).rejects.toMatchObject({ code: mutation === "role" ? "forbidden" : "conflict" });
      expect(await t.pb.collection("checkin_arrival_commands").getFullList()).toHaveLength(0);
    }
  } finally { await runtime.coordinator.close(); await t.cleanup(); }
});

it("purges lookup bindings and denies re-creation and foreign recovery", { timeout: 60_000 }, async () => {
  const t = await setup();
  try {
    const service = new CheckinLookupService(t.pb, t.operator.actor, lookup(), t.source);
    const command = { ...t.command(), attendeeId: "501" };
    expect(await service.confirm(t.token, command)).toMatchObject({ state: "dependency_unavailable" });
    await expect(service.getRecovery("c".repeat(64), command.operationId)).rejects.toMatchObject({ code: "invalid_binding" });
    await expect(service.getRecovery(t.token, crypto.randomUUID())).rejects.toMatchObject({ code: "forbidden" });
    const lifecycle = new CheckinLifecycleService(t.pb, t.admin.actor);
    const closed = await lifecycle.close({ operationId: crypto.randomUUID(), confirmEdition: "WTS2026" });
    expect(await service.getRecovery(t.token, command.operationId)).toMatchObject({ recovery: "context_changed", actions: [] });
    await t.pb.send("/api/wts/checkin-lifecycle-worker", { method: "POST", body: { operation: "tick", nowMs: Date.parse(closed.purgeDeadline!) } });
    expect(await t.pb.collection("checkin_lookup_commands").getFullList()).toHaveLength(0);
    await expect(service.confirm(t.token, command)).rejects.toMatchObject({ code: "conflict" });
    await expect(service.getRecovery(t.token, command.operationId)).rejects.toMatchObject({ code: "forbidden" });
    await expect(t.pb.collection("checkin_lookup_commands").create({ operation_id: crypto.randomUUID() })).rejects.toThrow();
  } finally { await t.cleanup(); }
});
