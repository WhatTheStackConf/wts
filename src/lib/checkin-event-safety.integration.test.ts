import PocketBase from "pocketbase";
import { describe, expect, it } from "vite-plus/test";
import { CheckinEventService, type CheckinEventSource } from "~/lib/checkin-event-service";
import { CheckinService } from "~/lib/checkin-service";
import { startCheckinPocketBase } from "~/lib/checkin-pocketbase-test-helper";

const source: CheckinEventSource = {
  sourceKey: "d".repeat(64),
  discover: async () => ({ state: "complete", events: [{ id: "501", title: "Synthetic main event" }, { id: "502", title: "Synthetic second event" }, { id: "503", title: "Synthetic unconfigured" }, { id: "504", title: "WTS 2026 words are not membership" }] }),
  options: async () => ({ state: "complete", lists: [{ id: "701", title: "Synthetic list" }], questions: [{ id: "801", title: "Synthetic question", productIds: ["601"] }], products: [{ id: "601", title: "Synthetic product" }, { id: "602", title: "Other product" }] }),
};
const intent = () => ({ operationId: crypto.randomUUID(), expectedGeneration: 0, upstreamEventId: "501", member: true, enabled: true, listId: "701", affiliation: null, reason: "configuration" as const });
async function setup() {
  const test = await startCheckinPocketBase();
  try {
    const admin = await test.user("admin");
    const operator = await test.user("checkin_operator");
    const service = new CheckinEventService(test.pb, admin.actor, source);
    const stations = new CheckinService(test.pb, admin.actor);
    const control = () => ({ operationId: crypto.randomUUID(), expectedVersion: 1, reason: "configuration" as const });
    await stations.adminControl({ ...control(), operation: "set_system_enabled", enabled: true });
    await stations.adminControl({ ...control(), operation: "set_station_enabled", stationId: "wts2026station1", enabled: true });
    const code = (await stations.adminControl({ ...control(), expectedVersion: 2, operation: "rotate_provision_code", stationId: "wts2026station1" })).provisionCode!;
    const token = "e".repeat(64);
    await stations.bind(code, token, (await stations.preview(code)).confirmation);
    const phone = new CheckinEventService(test.pb, operator.actor, source);
    return { ...test, admin, operator, service, stations, phone, token, control };
  } catch (error) { await test.cleanup(); throw error; }
}

describe("event safety at real authenticated storage boundaries", () => {
  it("marks a mapped list unavailable after upstream removal, expiry or an incomplete read", { timeout: 60_000 }, async () => {
    const test = await setup();
    try {
      const configured = (await test.service.configure(intent())).configuration;
      const before = await test.phone.catalogue(test.token);
      const selected = await test.phone.select(test.token, { ...before.fence, eventId: configured.id, eventGeneration: 1 });
      for (const state of ["complete", "partial", "unavailable"] as const) {
        // Active/expiry filtering belongs to the real adapter; absent active list
        // and incomplete list reads must both invalidate the browser-facing path.
        const changedSource = { ...source, options: async () => ({ state, lists: [], products: [], questions: [] }) };
        const phone = new CheckinEventService(test.pb, test.operator.actor, changedSource);
        const catalogue = await phone.catalogue(test.token);
        expect(catalogue.events[0].availability).toBe("upstream_unavailable");
        expect(catalogue.selected?.availability).toBe("upstream_unavailable");
        expect(catalogue.context).toBeNull();
        await expect(phone.select(test.token, { ...catalogue.fence, eventId: configured.id, eventGeneration: 1 })).rejects.toMatchObject({ code: "disabled" });
        await expect(phone.validateContext(test.token, selected.context!)).rejects.toMatchObject({ code: "unavailable" });
      }
    } finally { await test.cleanup(); }
  });
  it("distinguishes empty, unconfigured, disabled, missing upstream and partial catalogues", { timeout: 60_000 }, async () => {
    const test = await setup();
    try {
      expect((await test.phone.catalogue(test.token)).events).toEqual([]);
      await test.service.configure(intent());
      const disabled = (await test.service.configure({ ...intent(), upstreamEventId: "502", enabled: false })).configuration;
      const unconfigured = (await test.service.configure({ ...intent(), upstreamEventId: "503", enabled: false, listId: "" })).configuration;
      await test.service.configure({ ...intent(), upstreamEventId: "504", enabled: false, member: false });
      const catalogue = await test.phone.catalogue(test.token);
      expect(catalogue.events.map((event) => event.availability)).toEqual(["available", "disabled", "unconfigured"]);
      for (const target of [disabled, unconfigured]) await expect(test.phone.select(test.token, { ...catalogue.fence, eventId: target.id, eventGeneration: 1 })).rejects.toMatchObject({ code: "disabled" });
      const interrupted = { ...source, discover: async () => ({ state: "partial" as const, events: [] }) };
      const partialPhone = new CheckinEventService(test.pb, test.operator.actor, interrupted);
      expect(await partialPhone.catalogue(test.token)).toMatchObject({ state: "partial", context: null, events: [{ availability: "upstream_unavailable" }, { availability: "disabled" }, { availability: "unconfigured" }] });
      const missing = new CheckinEventService(test.pb, test.operator.actor, { ...source, discover: async () => ({ state: "complete", events: [] }) });
      expect((await missing.catalogue(test.token)).events[0].availability).toBe("upstream_unavailable");
      const admin = new CheckinEventService(test.pb, test.admin.actor, interrupted);
      expect((await admin.adminCatalogue()).state).toBe("partial");
      await expect(admin.configure({ ...intent(), expectedGeneration: 1 })).rejects.toMatchObject({ code: "unavailable" });
      const mismatched = new CheckinEventService(test.pb, test.admin.actor, { ...source, sourceKey: "f".repeat(64) });
      expect(await mismatched.adminCatalogue()).toMatchObject({ sourceMismatch: true, state: "unavailable" });
      await expect(mismatched.configure(intent())).rejects.toMatchObject({ code: "unavailable" });
    } finally { await test.cleanup(); }
  });
  it("rejects malformed identities and invalid mappings without an Admin Action", { timeout: 60_000 }, async () => {
    const test = await setup();
    try {
      const before = await test.pb.collection("admin_actions").getFullList();
      for (const change of [
        { upstreamEventId: " 501" }, { upstreamEventId: "0501" }, { upstreamEventId: "999" }, { listId: "999" },
        { member: false }, { listId: "" }, { affiliation: { questionId: "999", productIds: [] } },
        { affiliation: { questionId: "801", productIds: ["602"] } }, { affiliation: { questionId: "801", productIds: ["601", "601"] } },
        { note: "person@example.test" }, { note: "https://capability.example.test/private" },
      ]) await expect(test.service.configure({ ...intent(), ...change })).rejects.toMatchObject({ code: "invalid_input" });
      expect((await test.service.adminCatalogue()).events.every((event) => event.configuration === null)).toBe(true);
      expect(await test.pb.collection("admin_actions").getFullList()).toHaveLength(before.length);
    } finally { await test.cleanup(); }
  });
  it("denies direct protected writes and refreshes live admin/role authority even across upstream reads and replay", { timeout: 60_000 }, async () => {
    const test = await setup();
    try {
      const command = intent();
      const saved = await test.service.configure(command);
      for (const client of [new PocketBase(test.baseUrl), test.admin.client, test.operator.client]) {
        await expect(client.collection("checkin_events").getList(1, 10)).rejects.toMatchObject({ status: 403 });
        await expect(client.collection("checkin_events").getOne(saved.configuration.id)).rejects.toMatchObject({ status: 403 });
        await expect(client.collection("checkin_events").create({})).rejects.toMatchObject({ status: 403 });
        await expect(client.collection("checkin_events").update(saved.configuration.id, { enabled: false })).rejects.toMatchObject({ status: 403 });
        await expect(client.collection("checkin_events").delete(saved.configuration.id)).rejects.toMatchObject({ status: 403 });
        await expect(client.send("/api/wts/checkin-events", { method: "POST", body: { operation: "admin_catalogue", actorUserId: test.admin.actor.userId, sourceKey: source.sourceKey } })).rejects.toMatchObject({ status: client.authStore.isValid ? 403 : 401 });
      }
      await expect(test.pb.collection("checkin_events").update(saved.configuration.id, { upstream_event_id: "502" })).rejects.toMatchObject({ status: 403 });
      await expect(test.pb.collection("checkin_events").delete(saved.configuration.id)).rejects.toMatchObject({ status: 403 });
      await expect(test.phone.adminCatalogue()).rejects.toMatchObject({ code: "forbidden" });
      await expect(test.phone.adminOptions("501")).rejects.toMatchObject({ code: "forbidden" });
      await expect(test.phone.configure(intent())).rejects.toMatchObject({ code: "forbidden" });
      const revoking = new CheckinEventService(test.pb, test.admin.actor, { ...source, discover: async () => { await test.pb.collection("users").update(test.admin.actor.userId, { role: "reviewer" }); return source.discover(); } });
      await expect(revoking.configure({ ...intent(), expectedGeneration: 1 })).rejects.toMatchObject({ code: "forbidden" });
      await expect(test.service.configure(command)).rejects.toMatchObject({ code: "forbidden" });
      const forged = new CheckinEventService(test.pb, { userId: test.operator.actor.userId, role: "admin" }, source);
      await expect(forged.adminCatalogue()).rejects.toMatchObject({ code: "forbidden" });
    } finally { await test.cleanup(); }
  });
  it("atomically rolls back configuration/action when audit fails and fences competing intents", { timeout: 60_000 }, async () => {
    const test = await setup();
    try {
      const command = intent();
      const schema = await test.pb.collections.getOne("checkin_audit_events");
      await test.pb.collections.update(schema.id, { fields: schema.fields.map((field) => field.name === "actor_name" ? { ...field, max: 1 } : field) });
      const before = (await test.pb.collection("admin_actions").getFullList()).length;
      await expect(test.service.configure(command)).rejects.toMatchObject({ code: "unavailable" });
      expect((await test.service.adminCatalogue()).events[0].configuration).toBeNull();
      expect(await test.pb.collection("admin_actions").getFullList()).toHaveLength(before);
      await test.pb.collections.update(schema.id, { fields: schema.fields });
      const duplicate = await Promise.all([test.service.configure(command), test.service.configure(command)]);
      expect(duplicate[0].actionId).toBe(duplicate[1].actionId);
      const raced = await Promise.allSettled([test.service.configure({ ...intent(), expectedGeneration: 1, enabled: false }), test.service.configure({ ...intent(), expectedGeneration: 1, enabled: false })]);
      expect(raced.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(raced.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "conflict" } });
      // Stable result replay does not undo a later disable and needs no upstream.
      const offline = new CheckinEventService(test.pb, test.admin.actor, { ...source, discover: async () => { throw new Error("Must not read upstream for replay"); } });
      expect((await offline.configure(command)).replayed).toBe(true);
      expect((await test.service.adminCatalogue()).events[0].configuration?.enabled).toBe(false);
    } finally { await test.cleanup(); }
  });
  it("fences two-tab selection races, rebinds and stop/restore against new context", { timeout: 60_000 }, async () => {
    const test = await setup();
    try {
      const first = (await test.service.configure(intent())).configuration;
      const second = (await test.service.configure({ ...intent(), upstreamEventId: "502" })).configuration;
      const initial = await test.phone.catalogue(test.token);
      const selections = [first, second].map((target) => ({ ...initial.fence, eventId: target.id, eventGeneration: 1 }));
      const raced = await Promise.allSettled(selections.map((selection) => test.phone.select(test.token, selection)));
      expect(raced.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const current = await test.phone.catalogue(test.token);
      const winning = selections.find((selection) => selection.eventId === current.context!.eventId)!;
      expect((await test.phone.select(test.token, winning)).context).toEqual(current.context);
      await test.stations.adminControl({ ...test.control(), expectedVersion: 2, operation: "set_system_enabled", enabled: false });
      await expect(test.phone.validateContext(test.token, current.context!)).rejects.toMatchObject({ code: "disabled" });
      await test.stations.adminControl({ ...test.control(), expectedVersion: 3, operation: "set_system_enabled", enabled: true });
      await expect(test.phone.validateContext(test.token, current.context!)).rejects.toMatchObject({ code: "conflict" });
      await test.stations.adminControl({ ...test.control(), operation: "set_station_enabled", stationId: "wts2026station2", enabled: true });
      const code = (await test.stations.adminControl({ ...test.control(), expectedVersion: 2, operation: "rotate_provision_code", stationId: "wts2026station2" })).provisionCode!;
      await test.stations.bind(code, test.token, (await test.stations.preview(code, test.token)).confirmation);
      expect(await test.phone.catalogue(test.token)).toMatchObject({ selected: { availability: "stale" }, context: null });
      await expect(test.phone.select(test.token, winning)).rejects.toMatchObject({ code: "conflict" });
    } finally { await test.cleanup(); }
  });
});
