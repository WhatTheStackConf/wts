/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const text = (name, max = 80, required = false) => ({ name, type: "text", max, required });
  const json = (name, maxSize = 8192) => ({ name, type: "json", maxSize });
  function collection(name, fields, indexes) {
    const c = new Collection({ name, type: "base", listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null, fields: fields.concat([{ name: "created", type: "autodate", onCreate: true, onUpdate: false }]) });
    for (const [index, unique, columns] of indexes) c.addIndex(index, unique, columns, "");
    app.save(c);
  }
  collection("checkin_arrival_workflows", [text("edition", 12, true), text("upstream_event_id", 16, true), text("upstream_attendee_id", 16, true), text("station_id", 15, true), text("event_id", 15, true), text("event_title", 200, true), text("list_id", 16, true), json("context"), text("source_key", 64, true), text("profile_id", 15, true), json("profile_config"), json("affiliation_mapping"), text("name", 200, true), text("affiliation", 200), { name: "state", type: "select", values: ["not_submitted"], maxSelect: 1, required: true }, text("operation_id", 36, true)], [["idx_arrival_identity", true, "edition,upstream_event_id,upstream_attendee_id"], ["idx_arrival_station", false, "station_id,created,id"]]);
  collection("checkin_arrival_commands", [text("operation_id", 36, true), text("payload_hash", 64, true), text("qr_hash", 64, true), json("context"), text("source_key", 64, true), text("affiliation_choice", 5, true), text("prior_operation_id", 36), text("actor_user_id", 15, true), text("station_id", 15, true), text("event_id", 15, true), { name: "status", type: "select", values: ["pending", "final"], maxSelect: 1, required: true }, json("result"), text("workflow_id", 15), text("completed_at"), text("completed_day", 10), { name: "history_visible", type: "bool" }], [["idx_arrival_command", true, "operation_id"], ["idx_arrival_history", false, "station_id,created,id"]]);
  const audit = app.findCollectionByNameOrId("checkin_audit_events");
  audit.fields.getByName("operation").values = audit.fields.getByName("operation").values.concat(["arrival_begin", "arrival_result"]);
  audit.fields.add(new TextField({ name: "workflow_id", max: 15 }));
  audit.fields.add(new TextField({ name: "arrival_command_id", max: 15 })); app.save(audit);
}, (app) => {
  if (app.countRecords("checkin_arrival_commands") || app.countRecords("checkin_arrival_workflows")) throw new Error("Arrival history exists; use an explicit lifecycle forward migration.");
  for (const name of ["checkin_arrival_commands", "checkin_arrival_workflows"]) app.delete(app.findCollectionByNameOrId(name));
  const audit = app.findCollectionByNameOrId("checkin_audit_events"); audit.fields.getByName("operation").values = audit.fields.getByName("operation").values.filter((v) => !["arrival_begin", "arrival_result"].includes(v));
  audit.fields.removeByName("workflow_id"); audit.fields.removeByName("arrival_command_id"); app.save(audit);
});
