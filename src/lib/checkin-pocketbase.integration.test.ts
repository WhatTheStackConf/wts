import PocketBase from "pocketbase";
import { describe, expect, it } from "vite-plus/test";
import { CheckinService } from "~/lib/checkin-service";
import { CHECKIN_STATION_IDS } from "~/lib/checkin-contract";
import { startCheckinPocketBase } from "~/lib/checkin-pocketbase-test-helper";

describe("durable authenticated Check-in Stations", () => {
  it("previews without binding and confirms a durable browser identity", { timeout: 60_000 }, async () => {
    const test = await startCheckinPocketBase();
    try {
      const admin = await test.user("admin");
      const service = new CheckinService(test.pb, admin.actor);
      const base = { operationId: crypto.randomUUID(), expectedVersion: 1, reason: "configuration" as const };
      await service.adminControl({ ...base, operation: "set_system_enabled", enabled: true });
      await service.adminControl({ ...base, operationId: crypto.randomUUID(), operation: "set_station_enabled", stationId: CHECKIN_STATION_IDS[0], enabled: true });
      const issued = await service.adminControl({ ...base, operationId: crypto.randomUUID(), expectedVersion: 2, operation: "rotate_provision_code", stationId: CHECKIN_STATION_IDS[0] });
      const preview = await service.preview(issued.provisionCode!);
      expect(preview.canBind).toBe(true);
      expect((await service.adminList()).bindings.items).toHaveLength(0);
      const bound = await service.bind(issued.provisionCode!, "a".repeat(64), preview.confirmation);
      expect(bound.status).toMatchObject({ bindingState: "bound", operationsEnabled: false, station: { id: CHECKIN_STATION_IDS[0] } });
      await test.restart();
      expect((await service.status("a".repeat(64))).binding?.id).toBe(bound.status.binding?.id);
    } finally { await test.cleanup(); }
  });
  it("serializes reusable QR binding, rebinding, revocation and live-role handoffs", { timeout: 60_000 }, async () => {
    const test = await startCheckinPocketBase();
    try {
      const admin = await test.user("admin", "private@example.test");
      const operator = await test.user("checkin_operator");
      const service = new CheckinService(test.pb, admin.actor);
      const phone = new CheckinService(test.pb, operator.actor);
      const base = () => ({ operationId: crypto.randomUUID(), expectedVersion: 1, reason: "configuration" as const });
      await service.adminControl({ ...base(), operation: "set_system_enabled", enabled: true });
      const codes: string[] = [];
      for (const stationId of CHECKIN_STATION_IDS.slice(0, 2)) {
        await service.adminControl({ ...base(), operation: "set_station_enabled", stationId, enabled: true });
        const issued = await service.adminControl({ ...base(), expectedVersion: 2, operation: "rotate_provision_code", stationId });
        codes.push(issued.provisionCode!);
      }
      const first = await phone.preview(codes[0]);
      await expect(phone.bind(codes[0], null, first.confirmation)).rejects.toMatchObject({ code: "invalid_binding" });
      await expect(phone.preview("f".repeat(64))).rejects.toMatchObject({ code: "invalid_code" });
      const token = "b".repeat(64);
      const simultaneous = await Promise.all([phone.bind(codes[0], token, first.confirmation), phone.bind(codes[0], token, first.confirmation)]);
      expect(simultaneous[0].status.binding?.id).toBe(simultaneous[1].status.binding?.id);
      const bindingId = simultaneous[0].status.binding!.id;
      expect((await service.adminList()).bindings.items).toHaveLength(1);
      const second = await phone.preview(codes[1], token);
      const rebound = await phone.bind(codes[1], token, second.confirmation);
      expect(rebound.status.binding).toMatchObject({ id: bindingId, stationId: CHECKIN_STATION_IDS[1], version: 2 });
      await expect(phone.bind(codes[0], token, first.confirmation)).rejects.toMatchObject({ code: "conflict" });
      expect((await phone.status(token)).binding?.stationId).toBe(CHECKIN_STATION_IDS[1]);
      expect((await service.adminList()).audit.items.filter((event) => event.operation === "bind").map((event) => event.stationId).sort()).toEqual([CHECKIN_STATION_IDS[0], CHECKIN_STATION_IDS[1]]);
      // The identity belongs to the browser, not either login.
      expect((await service.status(token)).binding?.id).toBe(bindingId);
      await test.pb.collection("users").update(operator.record.id, { role: "reviewer" });
      await expect(phone.status(token)).rejects.toMatchObject({ code: "forbidden" });
      await expect(phone.preview(codes[1])).rejects.toMatchObject({ code: "forbidden" });
      await test.pb.collection("users").update(operator.record.id, { role: "checkin_operator", verified: false });
      await expect(phone.status(token)).rejects.toMatchObject({ code: "forbidden" });
      await test.pb.collection("users").update(operator.record.id, { verified: true });
      const rotateCommand = { ...base(), expectedVersion: 3, operation: "rotate_provision_code" as const, stationId: CHECKIN_STATION_IDS[1] };
      const rotated = await service.adminControl(rotateCommand);
      expect(await service.adminControl(rotateCommand)).toMatchObject({ actionId: rotated.actionId, replayed: true });
      expect((await service.adminControl(rotateCommand)).provisionCode).toBeUndefined();
      await expect(phone.preview(codes[1])).rejects.toMatchObject({ code: "invalid_code" });
      expect((await phone.status(token)).binding?.id).toBe(bindingId);
      await service.adminControl({ ...base(), operation: "revoke_binding", bindingId, expectedVersion: 2, reason: "security" });
      expect(await phone.status(token)).toMatchObject({ bindingState: "revoked", binding: null, station: null });
      const fresh = await phone.preview(rotated.provisionCode!);
      await expect(phone.bind(rotated.provisionCode!, token, fresh.confirmation)).rejects.toMatchObject({ code: "revoked_binding" });
      await test.restart();
      expect((await phone.status(token)).bindingState).toBe("revoked");
      const overview = await service.adminList();
      expect(overview.bindings.items).toHaveLength(1);
      expect(overview.audit.items.filter((event) => event.actorUserId === admin.actor.userId).every((event) => event.actorName === "Authorized User")).toBe(true);
      const serialized = JSON.stringify(overview);
      for (const secret of [token, ...codes, rotated.provisionCode!, "private@example.test", "identity_hash", "provision_code_hash"]) expect(serialized).not.toContain(secret);
      for (const event of overview.audit.items) {
        await expect(test.pb.collection("checkin_audit_events").update(event.id, { note: "changed" })).rejects.toMatchObject({ status: 403 });
        await expect(test.pb.collection("checkin_audit_events").delete(event.id)).rejects.toMatchObject({ status: 403 });
      }
      const actions = await test.pb.collection("admin_actions").getFullList();
      expect(actions).toHaveLength(overview.audit.items.filter((event) => event.operation !== "bind").length);
      for (const action of actions) {
        expect(action).toMatchObject({ status: "applied", source: "admin_ui", actor_user: admin.actor.userId });
        expect(action.before_summary).toBeTruthy(); expect(action.after_summary).toBeTruthy();
        for (const secret of [token, ...codes, rotated.provisionCode!, "private@example.test"]) expect(JSON.stringify(action)).not.toContain(secret);
        await expect(test.pb.collection("admin_actions").update(action.id, { replay_result: {} })).rejects.toMatchObject({ status: 400 });
      }
    } finally { await test.cleanup(); }
  });
  it("fences concurrent admin intents and stale confirmations across stop/restore without deleting bindings", { timeout: 60_000 }, async () => {
    const test = await startCheckinPocketBase();
    try {
      const admin = await test.user("admin");
      const service = new CheckinService(test.pb, admin.actor);
      const base = () => ({ operationId: crypto.randomUUID(), expectedVersion: 1, reason: "configuration" as const });
      const stationId = CHECKIN_STATION_IDS[0];
      const raced = await Promise.allSettled([service.adminControl({ ...base(), operation: "set_system_enabled", enabled: true }), service.adminControl({ ...base(), operation: "set_system_enabled", enabled: true })]);
      expect(raced.filter((item) => item.status === "fulfilled")).toHaveLength(1);
      expect(raced.find((item) => item.status === "rejected")).toMatchObject({ reason: { code: "conflict" } });
      await service.adminControl({ ...base(), operation: "set_station_enabled", stationId, enabled: true });
      const issued = await service.adminControl({ ...base(), expectedVersion: 2, operation: "rotate_provision_code", stationId });
      const code = issued.provisionCode!;
      const preview = await service.preview(code);
      for (const token of ["c", "d", "e"]) await service.bind(code, token.repeat(64), preview.confirmation);
      expect((await service.adminList()).stations[0]).toMatchObject({ activeBindingCount: 3, multiplePhonesWarning: true });
      const activeBindings = (await service.adminList()).bindings.items;
      for (const binding of activeBindings) await test.pb.collection("checkin_bindings").update(binding.id, { last_seen_at: "2020-01-01 00:00:00.000Z" });
      expect((await service.adminList()).stations[0]).toMatchObject({ activeBindingCount: 0, multiplePhonesWarning: false });
      expect((await service.status("c".repeat(64))).binding?.active).toBe(true);
      expect((await service.adminList()).stations[0].activeBindingCount).toBe(1);
      const stop = { ...base(), expectedVersion: 2, operation: "set_system_enabled" as const, enabled: false, reason: "incident" as const };
      expect((await service.adminControl(stop)).system).toMatchObject({ version: 3, generation: 3, enabled: false });
      expect((await service.preview(code)).canBind).toBe(false);
      await expect(service.bind(code, "c".repeat(64), preview.confirmation)).rejects.toMatchObject({ code: "disabled" });
      expect((await service.adminControl({ ...base(), expectedVersion: 3, operation: "set_system_enabled", enabled: true })).system).toMatchObject({ version: 4, generation: 4 });
      await service.adminControl(stop); // replay must not stop a restored system
      expect((await service.adminList()).system.enabled).toBe(true);
      await expect(service.adminControl({ ...stop, enabled: true })).rejects.toMatchObject({ code: "conflict" });
      await expect(service.bind(code, "c".repeat(64), preview.confirmation)).rejects.toMatchObject({ code: "conflict" });
      const current = await service.preview(code);
      await service.adminControl({ ...base(), expectedVersion: 3, operation: "set_station_enabled", stationId, enabled: false });
      await service.adminControl({ ...base(), expectedVersion: 4, operation: "set_station_enabled", stationId, enabled: true });
      await expect(service.bind(code, "c".repeat(64), current.confirmation)).rejects.toMatchObject({ code: "conflict" });
      const config = { ...base(), expectedVersion: 5, operation: "configure_station" as const, stationId, label: "L".repeat(80), location: "R".repeat(120), printerRef: "P".repeat(80) };
      expect((await service.adminControl(config)).station).toMatchObject({ version: 6, generation: 6, label: config.label });
      for (const note of ["a".repeat(241), "person@example.test", "https://private.test", "f".repeat(64)]) await expect(service.adminControl({ ...base(), expectedVersion: 6, operation: "set_station_enabled", stationId, enabled: false, note })).rejects.toMatchObject({ code: "invalid_input" });
      expect((await service.adminList()).bindings.items).toHaveLength(3);
      expect((await service.adminList()).stations[0].version).toBe(6);
      expect(await service.status("f".repeat(64))).toMatchObject({ bindingState: "invalid", station: null });
    } finally { await test.cleanup(); }
  });
  it("rolls back the mutation and Admin Action when feature audit cannot commit", { timeout: 60_000 }, async () => {
    const test = await startCheckinPocketBase();
    try {
      const admin = await test.user("admin");
      const service = new CheckinService(test.pb, admin.actor);
      // Fault injection through the real PB schema API, never an internal mock.
      const schema = await test.pb.collections.getOne("checkin_audit_events");
      const fields = schema.fields.map((field) => field.name === "actor_name" ? { ...field, max: 1 } : field);
      await test.pb.collections.update(schema.id, { fields });
      const command = { operation: "set_system_enabled" as const, enabled: true, expectedVersion: 1, operationId: crypto.randomUUID(), reason: "configuration" as const };
      await expect(service.adminControl(command)).rejects.toMatchObject({ code: "unavailable" });
      const failed = await service.adminList();
      expect(failed.system).toMatchObject({ enabled: false, version: 1, generation: 1 });
      expect(failed.audit.items).toHaveLength(0);
      expect(await test.pb.collection("admin_actions").getFullList()).toHaveLength(0);
      await test.pb.collections.update(schema.id, { fields: schema.fields });
      expect((await service.adminControl(command)).system).toMatchObject({ enabled: true, version: 2 });
      expect((await service.adminList()).audit.items).toHaveLength(1);
    } finally { await test.cleanup(); }
  });
  it("migrates fixed disabled stations and denies all direct human/anonymous collection access", { timeout: 60_000 }, async () => {
    const test = await startCheckinPocketBase();
    try {
      const admin = await test.user("admin");
      const service = new CheckinService(test.pb, admin.actor);
      const overview = await service.adminList();
      expect(overview.stations.map((station) => station.id)).toEqual(CHECKIN_STATION_IDS);
      expect(overview.system).toEqual({ edition: "WTS2026", enabled: false, version: 1, generation: 1 });
      for (const station of overview.stations) {
        expect(station).toMatchObject({ enabled: false, ready: false, version: 1, generation: 1, provisionCodeIssued: false });
        // Connection is now reported by the independently authenticated agent
        // status query, not a hardcoded disconnected state in the binding shell.
        expect(station.unreadyReasons).toContain("agent_readiness_separate");
      }
      expect(await service.status()).toMatchObject({ bindingState: "unbound", station: null, operationsEnabled: false });
      const anonymous = new PocketBase(test.baseUrl);
      const humans = await Promise.all(["user", "reviewer", "checkin_operator"].map((role) => test.user(role)));
      const usersCollection = await test.pb.collections.getOne("users");
      expect(usersCollection.fields.find((field) => field.name === "role")?.values).toEqual(expect.arrayContaining(["user", "reviewer", "admin", "checkin_operator"]));
      for (const human of humans) {
        const forgedService = new CheckinService(test.pb, { userId: human.actor.userId, role: "admin" });
        await expect(forgedService.adminList()).rejects.toMatchObject({ code: "forbidden" });
      }
      for (const client of [anonymous, admin.client, ...humans.map((human) => human.client)]) {
        for (const name of ["checkin_system", "checkin_stations", "checkin_bindings", "checkin_audit_events"]) {
          await expect(client.collection(name).getList(1, 1)).rejects.toMatchObject({ status: 403 });
          await expect(client.collection(name).create({})).rejects.toMatchObject({ status: 403 });
        }
        await expect(client.send("/api/wts/checkin", { method: "POST", body: { operation: "admin_list", actorUserId: admin.actor.userId } })).rejects.toMatchObject({ status: client === anonymous ? 401 : 403 });
      }
    } finally { await test.cleanup(); }
  });
});
