/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const text = (name, max = 80) => ({ name, type: "text", max });
  const number = (name) => ({ name, type: "number", min: 0, onlyInt: true });
  const select = (name, values) => ({ name, type: "select", values, maxSelect: 1, required: true });
  function create(name, fields, indexes = []) {
    const c = new Collection({ name, type: "base", listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null, fields });
    for (const [name, unique, columns, where] of indexes) c.addIndex(name, unique, columns, where || "");
    app.save(c); return c;
  }
  const config = create("checkin_monitoring_config", [number("version"), number("waiting_ms"), number("incident_ms"), number("repeat_ms"), number("last_tick_ms"), number("observation_sequence"), number("applied_observation_sequence"), number("observation_started_ms"), text("observation_fingerprint", 64), { name: "recipient_user_ids", type: "json", maxSize: 2048 }]);
  const initial = new Record(config);
  for (const [key, value] of Object.entries({ id: "wts2026monitor0", version: 1, waiting_ms: 30000, incident_ms: 60000, repeat_ms: 900000, last_tick_ms: 0, observation_sequence: 0, applied_observation_sequence: 0, observation_started_ms: 0, observation_fingerprint: "", recipient_user_ids: [] })) initial.set(key, value);
  app.save(initial);
  create("checkin_monitoring_incidents", [
    text("scope_key", 100), text("station_id", 15), text("workflow_id", 15),
    select("category", ["station_unavailable", "work_stalled", "admission_uncertain", "output_uncertain"]),
    number("since_ms"), number("opened_ms"), number("recovered_ms"), number("acknowledged_ms"), text("acknowledged_by", 15), number("sequence"), number("last_boundary_ms"), number("next_delivery_ms"),
  ], [["idx_monitoring_active", true, "scope_key", "recovered_ms = 0"], ["idx_monitoring_station", false, "station_id,opened_ms DESC,since_ms DESC,id"], ["idx_monitoring_dashboard", false, "opened_ms DESC,since_ms DESC,id"], ["idx_monitoring_recovery", false, "recovered_ms,id"]]);
  create("checkin_monitoring_deliveries", [
    text("incident_id", 15), number("sequence"), select("kind", ["open", "repeat", "recovery"]),
    select("state", ["pending", "possibly_sent", "sent", "failed", "unknown", "cancelled"]),
    number("created_ms"), number("boundary_ms"), number("completed_ms"), text("claim_token", 64),
    { name: "send_started", type: "bool" }, { name: "recipient_user_ids", type: "json", maxSize: 2048 },
  ], [["idx_monitoring_delivery", true, "incident_id,sequence"], ["idx_monitoring_pending", false, "state,created_ms,id"]]);
  create("checkin_monitoring_commands", [text("operation_id", 36), text("actor_user_id", 15), text("fingerprint", 64), { name: "result", type: "json", maxSize: 4096 }], [["idx_monitoring_command", true, "operation_id"]]);
  create("checkin_monitoring_audit", [text("incident_id", 15), text("delivery_id", 15), text("actor_user_id", 15), number("at_ms"), select("category", ["configured", "opened", "recovered", "acknowledged", "delivery_boundary", "delivery_sent", "delivery_failed", "delivery_unknown"])], [["idx_monitoring_audit_history", false, "at_ms DESC,id"]]);
  // Index state projections so observation queries can exclude inert history.
  for (const [name, index, columns, where] of [
    ["checkin_arrival_workflows", "idx_monitoring_workflows_active", "state,id", ""],
    ["checkin_print_attempts", "idx_monitoring_prints_active", "state,id", ""],
    ["checkin_agent_authorizations", "idx_monitoring_authorizations_active", "outcome,id", ""],
    ["users", "idx_monitoring_admins", "role,verified,id", ""],
  ]) {
    const c = app.findCollectionByNameOrId(name); c.addIndex(index, false, columns, where); app.save(c);
  }
}, (app) => {
  if (app.countRecords("checkin_monitoring_incidents") || app.countRecords("checkin_monitoring_audit")) throw new Error("Monitoring history exists; use lifecycle forward migration.");
  for (const [name, index] of [["checkin_arrival_workflows", "idx_monitoring_workflows_active"], ["checkin_print_attempts", "idx_monitoring_prints_active"], ["checkin_agent_authorizations", "idx_monitoring_authorizations_active"], ["users", "idx_monitoring_admins"]]) {
    const c = app.findCollectionByNameOrId(name); c.removeIndex(index); app.save(c);
  }
  for (const name of ["checkin_monitoring_audit", "checkin_monitoring_commands", "checkin_monitoring_deliveries", "checkin_monitoring_incidents", "checkin_monitoring_config"]) app.delete(app.findCollectionByNameOrId(name));
});
