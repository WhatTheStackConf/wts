/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const text = (name, max = 80, required = false) => ({ name, type: "text", max, required });
  const json = (name, maxSize = 16384) => ({ name, type: "json", maxSize });
  const number = (name) => ({ name, type: "number", min: 0, onlyInt: true });
  function collection(name, fields, indexes) {
    const c = new Collection({ name, type: "base", listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null, fields: fields.concat([{ name: "created", type: "autodate", onCreate: true, onUpdate: false }]) });
    for (const [index, unique, columns] of indexes) c.addIndex(index, unique, columns, "");
    app.save(c);
  }
  const workflow = app.findCollectionByNameOrId("checkin_arrival_workflows");
  workflow.fields.getByName("state").values = ["not_submitted", "admission_pending", "accepted", "existing_unattributed", "rejected", "admission_uncertain"];
  workflow.fields.add(new TextField({ name: "admission_attempt_id", max: 15 }));
  workflow.fields.add(new TextField({ name: "print_intent_id", max: 15 }));
  workflow.fields.add(new TextField({ name: "admission_completed_at", max: 40 }));
  workflow.fields.add(new TextField({ name: "admission_completed_day", max: 10 }));
  app.save(workflow);

  const command = app.findCollectionByNameOrId("checkin_arrival_commands");
  command.fields.add(new TextField({ name: "admission_attempt_id", max: 15 }));
  app.save(command);

  collection("checkin_arrival_attempts", [
    text("workflow_id", 15, true), text("command_id", 15, true), text("station_id", 15, true),
    text("upstream_event_id", 16, true), text("upstream_attendee_id", 16, true), text("list_id", 16, true),
    text("source_key", 64, true), number("station_generation"), number("system_generation"), number("coordinator_generation"),
    { name: "state", type: "select", values: ["claimed", "pre_send_failed", "possibly_sent", "accepted", "existing_unattributed", "rejected", "uncertain"], maxSelect: 1, required: true },
    text("send_boundary_at", 40), text("completed_at", 40), text("result_fingerprint", 64), number("pre_send_failures"), text("next_retry_at", 40),
  ], [["idx_arrival_attempt_workflow", true, "workflow_id"], ["idx_arrival_attempt_command", true, "command_id"]]);

  collection("checkin_print_attempts", [
    text("workflow_id", 15, true), text("station_id", 15, true),
    { name: "purpose", type: "select", values: ["initial", "replacement"], maxSelect: 1, required: true },
    { name: "state", type: "select", values: ["queued", "dispatched", "completed", "uncertain", "cancelled"], maxSelect: 1, required: true },
    text("profile_id", 15, true), json("profile_config"), text("name", 200, true), text("affiliation", 200),
    text("payload_hash", 64, true), text("predecessor_attempt_id", 15),
  ], [["idx_print_initial", true, "workflow_id,purpose"], ["idx_print_workflow", false, "workflow_id,created,id"]]);

  const audit = app.findCollectionByNameOrId("checkin_audit_events");
  audit.fields.getByName("operation").values = audit.fields.getByName("operation").values.concat(["admission_claim", "admission_result"]);
  app.save(audit);
}, (app) => {
  if (app.countRecords("checkin_arrival_attempts") || app.countRecords("checkin_print_attempts")) throw new Error("Admission history exists; use an explicit lifecycle forward migration.");
  app.delete(app.findCollectionByNameOrId("checkin_print_attempts"));
  app.delete(app.findCollectionByNameOrId("checkin_arrival_attempts"));
  const command = app.findCollectionByNameOrId("checkin_arrival_commands"); command.fields.removeByName("admission_attempt_id"); app.save(command);
  const workflow = app.findCollectionByNameOrId("checkin_arrival_workflows");
  workflow.fields.getByName("state").values = ["not_submitted"];
  for (const field of ["admission_attempt_id", "print_intent_id", "admission_completed_at", "admission_completed_day"]) workflow.fields.removeByName(field);
  app.save(workflow);
  const audit = app.findCollectionByNameOrId("checkin_audit_events");
  audit.fields.getByName("operation").values = audit.fields.getByName("operation").values.filter((value) => !["admission_claim", "admission_result"].includes(value));
  app.save(audit);
});
