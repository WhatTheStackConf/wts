import { describe, expect, it } from "vite-plus/test";
import { CheckinEventService, type CheckinEventSource } from "~/lib/checkin-event-service";
import { startCheckinPocketBase } from "~/lib/checkin-pocketbase-test-helper";
import { CheckinService } from "~/lib/checkin-service";

/** Synthetic upstream fixtures only. These identifiers are not production defaults. */
const source: CheckinEventSource = {
  sourceKey: "a".repeat(64),
  discover: async () => ({ state: "complete", events: [{ id: "101", title: "Synthetic conference" }, { id: "102", title: "Synthetic workshop" }, { id: "103", title: "WTS 2026 title does not prove membership" }] }),
  options: async () => ({ state: "complete", lists: [{ id: "201", title: "Synthetic admission" }, { id: "202", title: "Synthetic other list" }], questions: [{ id: "301", title: "Synthetic affiliation", productIds: ["401"] }], products: [{ id: "401", title: "Synthetic ticket" }] }),
};
const intent = () => ({ operationId: crypto.randomUUID(), expectedGeneration: 0, upstreamEventId: "101", member: true, enabled: false, listId: "", affiliation: null, reason: "configuration" as const });

describe("authenticated admission event configuration", () => {
  it("keeps independent phone selections and fences stale new intake without retargeting snapshots", { timeout: 60_000 }, async () => {
    const test = await startCheckinPocketBase();
    try {
      const admin = await test.user("admin");
      const operator = await test.user("checkin_operator");
      const service = new CheckinEventService(test.pb, admin.actor, source);
      const phone = new CheckinEventService(test.pb, operator.actor, source);
      const stations = new CheckinService(test.pb, admin.actor);
      const stationId = "wts2026station1";
      const base = () => ({ operationId: crypto.randomUUID(), expectedVersion: 1, reason: "configuration" as const });
      await stations.adminControl({ ...base(), operation: "set_system_enabled", enabled: true });
      await stations.adminControl({ ...base(), operation: "set_station_enabled", stationId, enabled: true });
      const code = (await stations.adminControl({ ...base(), expectedVersion: 2, operation: "rotate_provision_code", stationId })).provisionCode!;
      const preview = await stations.preview(code);
      const tokens = ["b".repeat(64), "c".repeat(64)];
      for (const token of tokens) await stations.bind(code, token, preview.confirmation);
      const first = (await service.configure({ ...intent(), enabled: true, listId: "201" })).configuration;
      const second = (await service.configure({ ...intent(), upstreamEventId: "102", enabled: true, listId: "202" })).configuration;
      await service.configure({ ...intent(), upstreamEventId: "103" });
      const initial = await phone.catalogue(tokens[0]);
      expect(initial.events.map((event) => event.availability)).toEqual(["available", "available", "unconfigured"]);
      expect(initial.context).toBeNull();
      const selected = await phone.select(tokens[0], { ...initial.fence, eventId: first.id, eventGeneration: first.generation });
      const other = await phone.catalogue(tokens[1]);
      expect(other.selected).toBeNull();
      await phone.select(tokens[1], { ...other.fence, eventId: second.id, eventGeneration: second.generation });
      const snapshot = await phone.validateContext(tokens[0], selected.context!);
      expect(snapshot).toMatchObject({ upstreamEventId: "101", upstreamListId: "201", context: { eventGeneration: 1, stationId } });
      const serialized = JSON.stringify(selected);
      for (const hidden of ["upstream", "listId", "sourceKey", "affiliation", tokens[0]]) expect(serialized).not.toContain(hidden);
      await service.configure({ ...intent(), expectedGeneration: 1, enabled: true, listId: "202" });
      expect((await phone.catalogue(tokens[0])).selected?.availability).toBe("stale");
      expect((await phone.catalogue(tokens[0])).context).toBeNull();
      await expect(phone.validateContext(tokens[0], selected.context!)).rejects.toMatchObject({ code: "conflict" });
      expect(snapshot.upstreamListId).toBe("201");
      expect((await phone.catalogue(tokens[1])).selected?.id).toBe(second.id);
      const current = await phone.catalogue(tokens[0]);
      const changed = await phone.select(tokens[0], { ...current.fence, eventId: first.id, eventGeneration: 2 });
      expect(changed.context?.selectionVersion).toBe(2);
      await expect(phone.select(tokens[0], { ...initial.fence, eventId: second.id, eventGeneration: 1 })).rejects.toMatchObject({ code: "conflict" });
      await test.restart();
      expect((await phone.catalogue(tokens[0])).context).toEqual(changed.context);
      await test.pb.collection("users").update(operator.record.id, { role: "reviewer" });
      await expect(phone.catalogue(tokens[0])).rejects.toMatchObject({ code: "forbidden" });
      await expect(phone.select(tokens[0], { ...changed.fence, eventId: second.id, eventGeneration: 1 })).rejects.toMatchObject({ code: "forbidden" });
      await test.pb.collection("users").update(operator.record.id, { role: "checkin_operator" });
      await stations.adminControl({ ...base(), operation: "revoke_binding", bindingId: changed.context!.bindingId });
      await expect(phone.catalogue(tokens[0])).rejects.toMatchObject({ code: "revoked_binding" });
      await expect(phone.select(tokens[0], { ...changed.fence, eventId: second.id, eventGeneration: 1 })).rejects.toMatchObject({ code: "revoked_binding" });
    } finally { await test.cleanup(); }
  });
  it("discovers without inferring membership and persists an explicit audited mapping with replay", { timeout: 60_000 }, async () => {
    const test = await startCheckinPocketBase();
    try {
      const admin = await test.user("admin");
      const service = new CheckinEventService(test.pb, admin.actor, source);
      const discovered = await service.adminCatalogue();
      expect(discovered.state).toBe("complete");
      expect(discovered.events).toHaveLength(3);
      expect(discovered.events.every((event) => event.configuration === null)).toBe(true);
      const command = { ...intent(), enabled: true, listId: "201", affiliation: { questionId: "301", productIds: ["401"] } };
      const saved = await service.configure(command);
      expect(saved.configuration).toMatchObject({ upstreamEventId: "101", member: true, enabled: true, listId: "201", generation: 1, affiliation: { questionId: "301", productIds: ["401"] } });
      expect(await service.configure(command)).toEqual({ ...saved, replayed: true });
      await expect(service.configure({ ...command, listId: "202" })).rejects.toMatchObject({ code: "conflict" });
      await test.restart();
      expect((await service.adminCatalogue()).events[0].configuration).toEqual(saved.configuration);
      const actions = await test.pb.collection("admin_actions").getFullList();
      const audit = await test.pb.collection("checkin_audit_events").getFullList();
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({ operation_kind: "checkin.configure_event", status: "applied", actor_user: admin.actor.userId });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ operation: "configure_event", admin_action_id: saved.actionId });
    } finally { await test.cleanup(); }
  });
});
