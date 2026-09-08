/// <reference path="../pb_data/types.d.ts" />
/** Additive station ledger only. No event/admission/printing capability is created. */
migrate((app) => {
  function text(name, max, required = false, pattern = "") { return { name, type: "text", max, required, pattern }; }
  function number(name) { return { name, type: "number", required: true, min: 1, onlyInt: true }; }
  function create(name, fields) {
    const collection = new Collection({ name, type: "base", listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: fields.concat([
        { name: "created", type: "autodate", onCreate: true, onUpdate: false },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ]),
    });
    app.save(collection);
    return collection;
  }
  const system = create("checkin_system", [
    { name: "edition", type: "select", values: ["WTS2026"], maxSelect: 1, required: true },
    { name: "enabled", type: "bool" }, number("version"), number("generation"),
  ]);
  system.addIndex("idx_checkin_system_edition", true, "edition", "");
  app.save(system);
  const state = new Record(system);
  state.set("id", "wts2026system00"); state.set("edition", "WTS2026"); state.set("enabled", false); state.set("version", 1); state.set("generation", 1);
  app.save(state);
  const stations = create("checkin_stations", [
    { name: "edition", type: "select", values: ["WTS2026"], maxSelect: 1, required: true },
    text("label", 80, true), text("location", 120), text("printer_ref", 80),
    { name: "enabled", type: "bool" }, number("version"), number("generation"),
    text("provision_code_hash", 64, false, "^[a-f0-9]{64}$"),
  ]);
  stations.addIndex("idx_checkin_station_code", true, "provision_code_hash", "provision_code_hash != ''");
  app.save(stations);
  for (let index = 1; index <= 3; index++) {
    const station = new Record(stations);
    station.set("id", `wts2026station${index}`); station.set("edition", "WTS2026");
    station.set("label", `Station ${index}`); station.set("location", ""); station.set("printer_ref", "");
    station.set("enabled", false); station.set("version", 1); station.set("generation", 1);
    app.save(station);
  }
  const bindings = create("checkin_bindings", [
    text("identity_hash", 64, true, "^[a-f0-9]{64}$"),
    { name: "station", type: "relation", required: true, collectionId: stations.id, maxSelect: 1, cascadeDelete: false },
    number("version"), { name: "revoked", type: "bool" },
    { name: "last_seen_at", type: "date", required: true },
  ]);
  bindings.addIndex("idx_checkin_binding_identity", true, "identity_hash", "");
  bindings.addIndex("idx_checkin_binding_activity", false, "station,revoked,last_seen_at", "");
  app.save(bindings);
  const audit = create("checkin_audit_events", [
    text("actor_user_id", 15, true), text("actor_name", 80, true),
    { name: "actor_role", type: "select", values: ["admin", "checkin_operator"], maxSelect: 1, required: true },
    { name: "operation", type: "select", values: ["bind", "set_system_enabled", "set_station_enabled", "configure_station", "rotate_provision_code", "revoke_binding"], maxSelect: 1, required: true },
    text("station_id", 15), text("binding_id", 15), text("admin_action_id", 15),
    { name: "reason", type: "select", values: ["security", "device_replacement", "maintenance", "incident", "configuration", "operations_restored"], maxSelect: 1 },
    text("note", 240),
    { name: "outcome", type: "select", values: ["applied"], maxSelect: 1, required: true },
    { name: "state", type: "json", maxSize: 2048 },
  ]);
  audit.addIndex("idx_checkin_audit_history", false, "created,id", "");
  app.save(audit);
}, (app) => {
  // Deliberately refuse destructive rollback once any operational binding/audit exists.
  if (app.countRecords("checkin_bindings") || app.countRecords("checkin_audit_events")) {
    throw new Error("Check-in ledger contains operational history; use a forward migration.");
  }
  for (const name of ["checkin_audit_events", "checkin_bindings", "checkin_stations", "checkin_system"]) app.delete(app.findCollectionByNameOrId(name));
});
