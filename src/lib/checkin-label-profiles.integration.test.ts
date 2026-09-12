import { describe, expect, it } from "vite-plus/test";
import PocketBase from "pocketbase";
import { CheckinLabelProfileService } from "~/lib/checkin-label-profile-service";
import { SYNTHETIC_LABEL_CONFIG } from "~/lib/checkin-label-render-contract";
import { startCheckinPocketBase } from "~/lib/checkin-pocketbase-test-helper";
import { CheckinService } from "~/lib/checkin-service";

// Disposable software fixtures only: no test establishes physical calibration.
async function setup() {
  const test = await startCheckinPocketBase();
  try {
    const admin = await test.user("admin");
    const stations = new CheckinService(test.pb, admin.actor);
    await stations.adminControl({ operation: "configure_station", operationId: crypto.randomUUID(), expectedVersion: 1, stationId: "wts2026station1", label: "Test station", location: "Test room", printerRef: "test-printer-1", reason: "configuration" });
    const service = new CheckinLabelProfileService(test.pb, admin.actor);
    const command = () => ({ operationId: crypto.randomUUID(), stationId: "wts2026station1", expectedVersion: 0, expectedStationVersion: 2, config: { ...structuredClone(SYNTHETIC_LABEL_CONFIG), printerRef: "test-printer-1" }, reason: "configuration" as const, note: "Software preview fixture only" });
    return { ...test, admin, stations, service, command };
  } catch (error) { await test.cleanup(); throw error; }
}

async function ledger(test: Awaited<ReturnType<typeof setup>>) {
  return Promise.all(["checkin_label_profiles", "checkin_label_approvals", "admin_actions", "checkin_audit_events"].map((collection) => test.pb.collection(collection).getFullList({ sort: "id" })));
}
async function physical(test: Awaited<ReturnType<typeof setup>>) {
  const draft = test.command();
  const saved = await test.service.configure({ ...draft, config: { ...draft.config, synthetic: false, stockRef: "test-physical-stock" } });
  const approval = { operationId: crypto.randomUUID(), profileId: saved.profile.id, expectedVersion: 1, expectedStationVersion: 2, physicalConfirmation: true as const, reason: "configuration" as const, note: "Software-only attestation fixture" };
  return { saved, approval };
}

describe("audited versioned Name Label profiles at real PocketBase", () => {
  it("persists exact preview identities across versions and restart without enabling operations", { timeout: 60_000 }, async () => {
    const test = await setup();
    try {
      expect(await test.service.list()).toMatchObject({ profiles: [], stations: expect.arrayContaining([{ id: "wts2026station1", label: "Test station", printerRef: "test-printer-1", version: 2 }]), operationsEnabled: false });
      const command = test.command();
      const first = await test.service.configure(command);
      expect(first.profile).toEqual({ id: expect.any(String), stationId: command.stationId, version: 1, approval: "unapproved", config: command.config });
      expect(await test.service.get(first.profile.id)).toEqual(first.profile);
      const second = await test.service.configure({ ...test.command(), expectedVersion: 1, config: { ...command.config, density: command.config.density === 3 ? 2 : 3 } });
      expect(second.profile.version).toBe(2);
      expect(second.profile.id).not.toBe(first.profile.id);
      expect((await test.service.list()).profiles).toEqual([second.profile]);
      expect(await test.service.get(first.profile.id)).toEqual(first.profile);
      await test.restart();
      expect(await test.service.get(first.profile.id)).toEqual(first.profile);
      expect((await test.service.list()).profiles).toEqual([second.profile]);
    } finally { await test.cleanup(); }
  });
  it("deduplicates concurrent exact commands, rejects reused payloads and fences competing versions", { timeout: 60_000 }, async () => {
    const test = await setup();
    try {
      const command = test.command();
      const duplicates = await Promise.all([test.service.configure(command), test.service.configure(command)]);
      expect(duplicates[0].actionId).toBe(duplicates[1].actionId);
      expect(duplicates.map((result) => result.replayed).sort((a, b) => Number(a) - Number(b))).toEqual([false, true]);
      const saved = duplicates[0];
      expect(await test.service.configure(command)).toEqual({ ...saved, replayed: true });
      for (const change of [{ note: command.note + " " }, { reason: "maintenance" as const }, { config: { ...command.config, density: 2 } }, { expectedStationVersion: 3 }]) {
        await expect(test.service.configure({ ...command, ...change })).rejects.toMatchObject({ code: "conflict" });
      }
      const race = await Promise.allSettled([test.service.configure({ ...test.command(), expectedVersion: 1 }), test.service.configure({ ...test.command(), expectedVersion: 1 })]);
      expect(race.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(race.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "conflict" } });
      expect((await test.service.list()).profiles[0].version).toBe(2);
      expect((await test.service.configure(command)).profile).toEqual(saved.profile);
      const other = await test.user("admin");
      const otherService = new CheckinLabelProfileService(test.pb, other.actor);
      const next = await otherService.configure({ ...command, expectedVersion: 2 });
      expect(next.actionId).not.toBe(saved.actionId);
      expect(next.profile.version).toBe(3);
      const actions = await test.pb.collection("admin_actions").getFullList({ filter: "operation_kind = 'checkin.configure_label_profile'" });
      expect(actions).toHaveLength(3);
      expect(actions.every((action) => action.status === "applied")).toBe(true);
      const audit = await test.pb.collection("checkin_audit_events").getFullList({ filter: "operation = 'configure_label_profile'" });
      expect(audit).toHaveLength(3);
      expect(audit.map((entry) => entry.admin_action_id).sort((a, b) => a.localeCompare(b))).toEqual(actions.map((action) => action.id).sort((a, b) => a.localeCompare(b)));
    } finally { await test.cleanup(); }
  });
  it("validates pins, stock and geometry again at the trusted command seam without retaining attendee fields", { timeout: 60_000 }, async () => {
    const test = await setup();
    try {
      const command = test.command();
      const changes = [
        { rendererVersion: "old-renderer" }, { fontVersion: "system-font" },
        { printerRef: "different-printer" }, { stockRef: "someone@example.test" },
        ...["printer with spaces", "/dev/usb/lp0", "bearer-value", "secret-ref", "wts_mcp_ref", "a".repeat(64), "x".repeat(81), "bad/ref", ".leading"].map((stockRef) => ({ stockRef })),
        { media: { widthMm: 40, heightMm: 20, kind: "precut-gap" } },
        { raster: { width: 384, height: 120 } }, { raster: { width: 600.5, height: 360 } },
        { feed: { mode: "continuous", gapDots: 24, advanceDots: 0 } },
        { feed: { mode: "gap", gapDots: 24, advanceDots: 3000 } },
        { printable: { x: 12, y: 12, width: 600, height: 336 } },
        { printable: { x: 0, y: 0, width: 100, height: 100 }, margins: { top: 0, right: 0, bottom: 0, left: 0 } },
        { printable: { x: 0, y: 0, width: 47, height: 112 }, margins: { top: 0, right: 0, bottom: 0, left: 0 } },
        { offset: { x: 1000, y: 0 } }, { direction: 45 }, { density: 0 }, { threshold: 255 },
        { synthetic: false, stockRef: "synthetic-50x30-gap" },
        { attendeeName: "Not to be persisted" }, { email: "person@example.test" },
      ];
      for (const change of changes) {
        // Exercise the real approved PB command route, bypassing TS/render validation.
        await expect(test.pb.send("/api/wts/checkin-labels", { method: "POST", body: { operation: "configure", actorUserId: test.admin.actor.userId, command: { ...command, config: { ...command.config, ...change } } }, requestKey: null })).rejects.toMatchObject({ status: 400, response: { data: { code: { code: "invalid_input" } } } });
      }
      for (const note of ["person@example.test", "https://capability.example.test/private", "a".repeat(241), "private\nvalue", "<script>"]) {
        await expect(test.service.configure({ ...command, note })).rejects.toMatchObject({ code: "invalid_input" });
      }
      expect((await test.service.list()).profiles).toEqual([]);
      expect(await test.pb.collection("admin_actions").getFullList({ filter: "operation_kind = 'checkin.configure_label_profile'" })).toEqual([]);
      expect(await test.pb.collection("checkin_audit_events").getFullList({ filter: "operation = 'configure_label_profile'" })).toEqual([]);
      await expect(test.service.get("not-an-id")).rejects.toMatchObject({ code: "invalid_input" });
      await expect(test.service.get("aaaaaaaaaaaaaaa")).rejects.toMatchObject({ code: "invalid_input" });
    } finally { await test.cleanup(); }
  });
  it("requires physical attestation for exact current non-synthetic configuration and audits approval", { timeout: 60_000 }, async () => {
    const test = await setup();
    try {
      const draft = test.command();
      // Synthetic test inputs exercise the attestation flow, not real hardware.
      const saved = await test.service.configure({ ...draft, config: { ...draft.config, synthetic: false, stockRef: "test-physical-stock" } });
      const approval = { operationId: crypto.randomUUID(), profileId: saved.profile.id, expectedVersion: 1, expectedStationVersion: 2, physicalConfirmation: true as const, reason: "configuration" as const, note: "Test attestation: physical legibility, bounds and gap feed checked" };
      await expect(test.service.approve({ ...approval, physicalConfirmation: false } as never)).rejects.toMatchObject({ code: "invalid_input" });
      await expect(test.service.approve({ ...approval, note: " " })).rejects.toMatchObject({ code: "invalid_input" });
      const approved = await test.service.approve(approval);
      const storedEvidence = await test.pb.collection("checkin_label_approvals").getFullList();
      expect(storedEvidence).toHaveLength(1);
      expect(storedEvidence[0]).toMatchObject({ profile: saved.profile.id, station_version: 2, physical_confirmation: true, admin_action_id: approved.actionId });
      expect(approved.profile).toEqual({ ...saved.profile, approval: "approved" });
      expect(await test.service.approve(approval)).toEqual({ ...approved, replayed: true });
      expect(await test.service.get(saved.profile.id)).toEqual(approved.profile);
      expect((await test.service.list()).profiles).toEqual([approved.profile]);
      const audit = await test.pb.collection("checkin_audit_events").getFullList({ filter: `label_profile_id = '${saved.profile.id}'`, sort: "created" });
      expect(audit).toHaveLength(2);
      expect(audit[1]).toMatchObject({ operation: "approve_label_profile", actor_user_id: test.admin.actor.userId, actor_name: "Test Human", actor_role: "admin", admin_action_id: approved.actionId, reason: "configuration", note: approval.note });
      const next = await test.service.configure({ ...test.command(), expectedVersion: 1 });
      expect(next.profile.approval).toBe("unapproved");
      expect(await test.service.get(saved.profile.id)).toEqual({ ...approved.profile, approval: "unapproved" });
      await expect(test.service.approve({ ...approval, operationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "conflict" });
      await test.restart();
      expect(await test.service.get(saved.profile.id)).toEqual({ ...approved.profile, approval: "unapproved" });
      expect(await test.pb.collection("checkin_label_approvals").getFullList()).toEqual(storedEvidence);
    } finally { await test.cleanup(); }
  });
  it("preserves approved calibration across audited pause/resume while fencing stale commands and leaving history untouched", { timeout: 60_000 }, async () => {
    const test = await setup();
    try {
      const { saved, approval } = await physical(test);
      const approved = await test.service.approve(approval);
      const collections = (await test.pb.collections.getFullList()).filter((collection) => collection.name.startsWith("checkin_") && collection.name !== "checkin_stations" && collection.name !== "checkin_audit_events");
      const history = () => Promise.all(collections.map((collection) => test.pb.collection(collection.name).getFullList({ sort: "id" })));
      const beforeHistory = await history();
      const before = await ledger(test);
      const toggle = (expectedVersion: number, enabled: boolean) => ({ operation: "set_station_enabled" as const, operationId: crypto.randomUUID(), expectedVersion, stationId: "wts2026station1" as const, enabled, reason: "maintenance" as const });
      // First toggle freezes the effective version (zero means current version);
      // subsequent toggles must preserve it rather than the authorization version.
      for (const [expectedVersion, enabled] of [[2, true], [3, false], [4, true]] as const) {
        const command = toggle(expectedVersion, enabled);
        const result = await test.stations.adminControl(command);
        expect(result.station).toMatchObject({ enabled, version: expectedVersion + 1, generation: expectedVersion + 1 });
        expect(await test.service.get(saved.profile.id)).toEqual(approved.profile);
        expect((await test.service.list()).profiles).toEqual([approved.profile]);
        const after = await ledger(test);
        expect((await test.stations.adminControl(command)).replayed).toBe(true);
        await expect(test.stations.adminControl({ ...command, operationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "conflict" });
        await expect(test.service.approve({ ...approval, operationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "conflict" });
        expect(await ledger(test)).toEqual(after);
      }
      expect(await history()).toEqual(beforeHistory);
      await test.restart();
      expect(await test.service.get(saved.profile.id)).toEqual(approved.profile);
      const after = await ledger(test);
      expect(after[0]).toEqual(before[0]); expect(after[1]).toEqual(before[1]);
      expect(after[2]).toHaveLength(before[2].length + 3);
      expect(after[3]).toHaveLength(before[3].length + 3);
      const audits = after[3].filter((entry) => entry.operation === "set_station_enabled");
      expect(audits).toHaveLength(3);
      for (const audit of audits) {
        expect(audit).toMatchObject({ actor_user_id: test.admin.actor.userId, actor_role: "admin", reason: "maintenance", outcome: "applied" });
        expect(after[2].find((action) => action.id === audit.admin_action_id)).toMatchObject({ operation_kind: "checkin.set_station_enabled", status: "applied" });
        expect(Object.keys(audit.state.before).sort()).toEqual(["enabled", "generation", "id", "label", "location", "printerRef", "provisionCodeIssued", "version"]);
      }
    } finally { await test.cleanup(); }
  });
  it("keeps direct collections private and denies even superuser history writes", { timeout: 60_000 }, async () => {
    const test = await setup();
    try {
      const { saved, approval } = await physical(test);
      await test.service.approve(approval);
      const before = await ledger(test);
      const operator = await test.user("checkin_operator");
      for (const client of [new PocketBase(test.baseUrl), operator.client, test.admin.client]) {
        for (const [collection, records] of [["checkin_label_profiles", before[0]], ["checkin_label_approvals", before[1]]] as const) {
          await expect(client.collection(collection).getFullList()).rejects.toMatchObject({ status: 403 });
          await expect(client.collection(collection).getOne(records[0].id)).rejects.toMatchObject({ status: 403 });
          await expect(client.collection(collection).create(records[0])).rejects.toMatchObject({ status: 403 });
          await expect(client.collection(collection).update(records[0].id, { station_version: 99 })).rejects.toMatchObject({ status: 403 });
          await expect(client.collection(collection).delete(records[0].id)).rejects.toMatchObject({ status: 403 });
        }
        await expect(client.send("/api/wts/checkin-labels", { method: "POST", body: { operation: "get", actorUserId: test.admin.actor.userId, profileId: saved.profile.id } })).rejects.toMatchObject({ status: client.authStore.isValid ? 403 : 401 });
      }
      for (const [collection, records] of [["checkin_label_profiles", before[0]], ["checkin_label_approvals", before[1]]] as const) {
        const { id: _id, ...copy } = records[0];
        await expect(test.pb.collection(collection).create(copy)).rejects.toMatchObject({ status: 403 });
        await expect(test.pb.collection(collection).update(records[0].id, { station_version: 99 })).rejects.toMatchObject({ status: 403 });
        await expect(test.pb.collection(collection).delete(records[0].id)).rejects.toMatchObject({ status: 403 });
      }
      expect(await ledger(test)).toEqual(before);
    } finally { await test.cleanup(); }
  });
  it("reauthorizes live roles for reads, changes, approval and replay without read audits", { timeout: 60_000 }, async () => {
    const test = await setup();
    try {
      const configure = test.command();
      const synthetic = await test.service.configure(configure);
      const approval = { operationId: crypto.randomUUID(), profileId: synthetic.profile.id, expectedVersion: 1, expectedStationVersion: 2, physicalConfirmation: true as const, reason: "configuration" as const, note: "Synthetic cannot receive physical approval" };
      await expect(test.service.approve(approval)).rejects.toMatchObject({ code: "invalid_input" });
      const before = await ledger(test);
      await test.service.list(); await test.service.get(synthetic.profile.id);
      expect(await ledger(test)).toEqual(before);
      for (const revoked of [{ role: "checkin_operator" }, { role: "admin", verified: false }]) {
        await test.pb.collection("users").update(test.admin.actor.userId, revoked);
        // The service retains the formerly valid admin actor: PB must reread it.
        for (const request of [() => test.service.list(), () => test.service.get(synthetic.profile.id), () => test.service.configure({ ...test.command(), expectedVersion: 1 }), () => test.service.configure(configure), () => test.service.approve(approval)]) {
          await expect(request()).rejects.toMatchObject({ code: "forbidden" });
        }
        expect(await ledger(test)).toEqual(before);
      }
      await test.pb.collection("users").update(test.admin.actor.userId, { role: "admin", verified: true });
      expect((await test.service.configure(configure)).replayed).toBe(true);
      expect(await ledger(test)).toEqual(before);
    } finally { await test.cleanup(); }
  });
  it("rolls back config and approval with all ledgers when audit storage fails, then retries", { timeout: 60_000 }, async () => {
    const test = await setup();
    try {
      const schema = await test.pb.collections.getOne("checkin_audit_events");
      const broken = schema.fields.map((field) => field.name === "actor_name" ? { ...field, max: 1 } : field);
      const configure = test.command();
      configure.config = { ...configure.config, synthetic: false, stockRef: "test-physical-stock" };
      const before = await ledger(test);
      await test.pb.collections.update(schema.id, { fields: broken });
      await expect(test.service.configure(configure)).rejects.toMatchObject({ code: "unavailable" });
      expect(await ledger(test)).toEqual(before);
      await test.pb.collections.update(schema.id, { fields: schema.fields });
      const saved = await test.service.configure(configure);
      expect(saved.replayed).toBe(false);
      const approval = { operationId: crypto.randomUUID(), profileId: saved.profile.id, expectedVersion: 1, expectedStationVersion: 2, physicalConfirmation: true as const, reason: "configuration" as const, note: "Software-only attestation fixture" };
      const configured = await ledger(test);
      await test.pb.collections.update(schema.id, { fields: broken });
      await expect(test.service.approve(approval)).rejects.toMatchObject({ code: "unavailable" });
      expect(await ledger(test)).toEqual(configured);
      expect((await test.service.get(saved.profile.id)).approval).toBe("unapproved");
      await test.pb.collections.update(schema.id, { fields: schema.fields });
      const approved = await test.service.approve(approval);
      expect(approved.replayed).toBe(false);
      expect((await test.service.get(saved.profile.id)).approval).toBe("approved");
      const after = await ledger(test);
      expect(after[0]).toHaveLength(1); expect(after[1]).toHaveLength(1);
      expect(after[2]).toHaveLength(before[2].length + 2); expect(after[3]).toHaveLength(before[3].length + 2);
    } finally { await test.cleanup(); }
  });
  it("converges identical approvals, rejects reused keys and permanently fences printer replacement", { timeout: 60_000 }, async () => {
    const test = await setup();
    try {
      const { saved, approval } = await physical(test);
      const results = await Promise.all([test.service.approve(approval), test.service.approve(approval)]);
      expect(results[0].actionId).toBe(results[1].actionId);
      expect(results.map((value) => value.replayed).sort((a, b) => Number(a) - Number(b))).toEqual([false, true]);
      const before = await ledger(test);
      for (const change of [{ note: approval.note + " " }, { expectedStationVersion: 3 }, { reason: "maintenance" as const }]) {
        await expect(test.service.approve({ ...approval, ...change })).rejects.toMatchObject({ code: "conflict" });
      }
      await expect(test.service.approve({ ...approval, operationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "conflict" });
      expect(await ledger(test)).toEqual(before);
      expect(before[1]).toHaveLength(1);
      await test.pb.collection("users").update(test.admin.actor.userId, { role: "checkin_operator" });
      await expect(test.service.approve(approval)).rejects.toMatchObject({ code: "forbidden" });
      expect(await ledger(test)).toEqual(before);
      await test.pb.collection("users").update(test.admin.actor.userId, { role: "admin" });
      for (const [expectedVersion, printerRef] of [[2, "test-replacement"], [3, "test-printer-1"]] as const) {
        await test.stations.adminControl({ operation: "configure_station", operationId: crypto.randomUUID(), expectedVersion, stationId: "wts2026station1", label: "Test station", location: "Test room", printerRef, reason: "device_replacement" });
        expect((await test.service.get(saved.profile.id)).approval).toBe("unapproved");
        expect((await test.service.list()).profiles[0].approval).toBe("unapproved");
        await expect(test.service.approve({ ...approval, operationId: crypto.randomUUID(), expectedStationVersion: expectedVersion + 1 })).rejects.toMatchObject({ code: "conflict" });
      }
      // Restoring an old printer reference cannot revive invalidated evidence,
      // including when the zero/fallback config version is frozen by a toggle.
      const invalidated = await ledger(test);
      for (const [expectedVersion, enabled] of [[4, true], [5, false], [6, true]] as const) {
        await test.stations.adminControl({ operation: "set_station_enabled", operationId: crypto.randomUUID(), expectedVersion, stationId: "wts2026station1", enabled, reason: "maintenance" });
        expect((await test.service.get(saved.profile.id)).approval).toBe("unapproved");
        expect((await test.service.list()).profiles[0].approval).toBe("unapproved");
        await expect(test.service.approve({ ...approval, operationId: crypto.randomUUID(), expectedStationVersion: expectedVersion + 1 })).rejects.toMatchObject({ code: "conflict" });
      }
      expect((await ledger(test)).slice(0, 2)).toEqual(invalidated.slice(0, 2));
      // Transport replay remains immutable historical evidence, not authorization.
      expect((await test.service.approve(approval)).profile.approval).toBe("approved");
      expect((await test.service.get(saved.profile.id)).approval).toBe("unapproved");
      await test.restart();
      expect((await test.service.get(saved.profile.id)).approval).toBe("unapproved");
      expect((await ledger(test))[1]).toEqual(before[1]);
    } finally { await test.cleanup(); }
  });
  it.each(["configure_station", "rotate_provision_code"] as const)("does not revive approval after %s invalidation and pause/resume", { timeout: 60_000 }, async (operation) => {
    const test = await setup();
    try {
      const { saved, approval } = await physical(test);
      await test.service.approve(approval);
      const before = (await ledger(test)).slice(0, 2);
      const common = { operationId: crypto.randomUUID(), expectedVersion: 2, stationId: "wts2026station1" as const, reason: "configuration" as const };
      await test.stations.adminControl(operation === "configure_station"
        ? { ...common, operation, label: "Changed label", location: "Test room", printerRef: "test-printer-1" }
        : { ...common, operation });
      expect((await test.service.get(saved.profile.id)).approval).toBe("unapproved");
      for (const [expectedVersion, enabled] of [[3, false], [4, true]] as const) {
        await test.stations.adminControl({ ...common, operationId: crypto.randomUUID(), operation: "set_station_enabled", expectedVersion, enabled });
        expect((await test.service.get(saved.profile.id)).approval).toBe("unapproved");
        await expect(test.service.approve({ ...approval, operationId: crypto.randomUUID(), expectedStationVersion: expectedVersion + 1 })).rejects.toMatchObject({ code: "conflict" });
      }
      expect((await ledger(test)).slice(0, 2)).toEqual(before);
    } finally { await test.cleanup(); }
  });
  it("accepts explicit valid synthetic geometry without inferring historical media calibration", { timeout: 60_000 }, async () => {
    const test = await setup();
    try {
      for (const [version, raster] of [{ width: 48, height: 112 }, { width: 384, height: 120 }, { width: 2048, height: 2048 }].entries()) {
        const command = test.command();
        const config = { ...command.config, raster, printable: { x: 0, y: 0, ...raster }, margins: { top: 0, right: 0, bottom: 0, left: 0 }, feed: { mode: "gap" as const, gapDots: 2048, advanceDots: 2048 }, stockRef: "X".repeat(80) };
        const result = await test.service.configure({ ...command, expectedVersion: version, config });
        expect(result.profile.config).toEqual(config);
        expect(result.profile.approval).toBe("unapproved");
        expect(await test.service.get(result.profile.id)).toEqual(result.profile);
      }
    } finally { await test.cleanup(); }
  });
});
