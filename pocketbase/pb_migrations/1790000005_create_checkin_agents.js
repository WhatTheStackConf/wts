/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  function collection(name, fields, indexes) {
    const c = new Collection({ name, type: "base", listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null, fields: fields.concat([{ name: "created", type: "autodate", onCreate: true, onUpdate: false }]) });
    for (const [index, unique, columns] of indexes || []) c.addIndex(index, unique, columns, "");
    app.save(c); return c;
  }
  const text = (name, max = 80, required = false) => ({ name, type: "text", max, required });
  const number = (name) => ({ name, type: "number", min: 0, onlyInt: true });
  const bool = (name) => ({ name, type: "bool" });
  const station = app.findCollectionByNameOrId("checkin_stations");
  station.fields.add(new NumberField({ name: "profile_config_version", min: 0, onlyInt: true })); app.save(station);
  collection("checkin_agents", [number("revision"), text("station", 15, true), text("credential_hash", 64, true), text("agent_identity"), text("printer_identity"), text("journal_identity"), text("profile_id", 15), text("expires_at"), bool("revoked"), bool("quarantined"), text("compatibility"), text("last_heartbeat_at"), number("journal_sequence"), text("journal_digest", 64), text("reported_profile", 15), number("protocol_generation"), number("schema_generation")], [["idx_agent_hash", true, "credential_hash"], ["idx_agent_station", false, "station"]]);
  collection("checkin_coordinator", [text("owner", 64), number("generation"), text("last_seen_at"), number("heartbeat_interval_ms"), number("heartbeat_timeout_ms"), number("authorization_ttl_ms")]);
  const runtime = new Record(app.findCollectionByNameOrId("checkin_coordinator")); runtime.set("id", "wts2026coord000"); runtime.set("generation", 1); runtime.set("heartbeat_interval_ms", 5000); runtime.set("heartbeat_timeout_ms", 15000); runtime.set("authorization_ttl_ms", 10000); app.save(runtime);
  collection("checkin_agent_attempts", [text("station", 15, true), text("agent_id", 15, true), text("profile_id", 15, true), text("payload_hash", 64, true), number("station_generation"), number("system_generation"), number("coordinator_generation")]);
  collection("checkin_agent_authorizations", [text("attempt_id", 15, true), text("agent_id", 15, true), text("authorization_hash", 64, true), text("expires_at"), number("station_generation"), number("system_generation"), number("coordinator_generation"), text("started_at"), text("report_until"), text("outcome")], [["idx_agent_attempt_authorization", true, "attempt_id"], ["idx_agent_authorization_hash", true, "authorization_hash"]]);
  const audit = app.findCollectionByNameOrId("checkin_audit_events"); audit.fields.getByName("operation").values = audit.fields.getByName("operation").values.concat(["issue_agent", "revoke_agent"]); app.save(audit);
}, (app) => {
  const names = ["checkin_agent_authorizations", "checkin_agent_attempts", "checkin_agents"];
  if (names.some((name) => app.countRecords(name))) throw new Error("Agent history exists; use a forward migration.");
  for (const name of names.concat(["checkin_coordinator"])) app.delete(app.findCollectionByNameOrId(name));
  const station = app.findCollectionByNameOrId("checkin_stations"); station.fields.removeByName("profile_config_version"); app.save(station);
  const audit = app.findCollectionByNameOrId("checkin_audit_events"); audit.fields.getByName("operation").values = audit.fields.getByName("operation").values.filter((v) => !["issue_agent", "revoke_agent"].includes(v)); app.save(audit);
});
