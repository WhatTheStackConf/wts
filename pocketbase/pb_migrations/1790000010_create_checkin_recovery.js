/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const t = (name, max = 80, required = false) => ({ name, type: "text", max, required });
  const j = (name) => ({ name, type: "json", maxSize: 32768 });
  const n = (name) => ({ name, type: "number", min: 0, onlyInt: true });
  function create(name, fields, indexes = []) {
    const c = new Collection({ name, type: "base", listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null, fields: [...fields, { name: "created", type: "autodate", onCreate: true, onUpdate: false }] });
    for (const [name, columns] of indexes) c.addIndex(name, true, columns, "");
    app.save(c);
  }
  create("checkin_recovery_workflows", [t("workflow_id",15,true),n("version"),t("name",200,true),t("affiliation",200),t("latest_print_id",15),t("decision"),t("fulfillment"),t("completed_day",10),t("updated_at",40),{name:"parked",type:"bool"}], [["idx_recovery_workflow","workflow_id"]]);
  // result is an immutable bounded command receipt, never a workflow/history snapshot.
  // Keep the 32 KiB byte ceiling; append-only print/audit rows hold unlimited history.
  create("checkin_recovery_commands", [t("operation_id",36,true),t("actor_id",15,true),t("workflow_id",15,true),t("payload_hash",64,true),t("operation"),j("result")], [["idx_recovery_command","operation_id"]]);
  create("checkin_recovery_audit", [t("command_id",15,true),t("workflow_id",15,true),t("station_id",15,true),t("actor_id",15,true),t("actor_role"),t("actor_name",80),t("operation"),t("reason"),t("note",240),j("before"),j("after")]);
  create("checkin_recovery_reads", [t("workflow_id",15,true),t("actor_id",15,true),t("state"),t("checkin_id",16),t("fingerprint",64)]);
  create("checkin_recovery_observations", [t("workflow_id",15,true),t("print_id",15,true),t("agent_attempt_id",15),t("command_id",15,true),t("outcome")], [["idx_recovery_observation","print_id"]]);
  create("checkin_recovery_cancellations", [t("workflow_id",15,true),t("print_id",15,true),t("agent_attempt_id",15),t("station_id",15,true),t("state"),t("acknowledged_at",40)], [["idx_recovery_cancel","print_id"]]);
  create("checkin_recovery_isolations", [t("station_id",15,true),t("workflow_id",15,true),t("command_id",15,true),t("released_at",40)]);
  create("checkin_recovery_resets", [t("workflow_id",15,true),t("command_id",15,true),t("read_id",15,true),t("checkin_id",16,true),t("fingerprint",64,true),t("state"),t("send_boundary_at",40),t("completed_at",40),n("coordinator_generation")], [["idx_recovery_reset","workflow_id"]]);
  const prints = app.findCollectionByNameOrId("checkin_print_attempts");
  prints.removeIndex("idx_print_initial");
  prints.addIndex("idx_print_initial", true, "workflow_id", "purpose = 'initial'");
  prints.addIndex("idx_print_predecessor", true, "predecessor_attempt_id", "predecessor_attempt_id != ''");
  app.save(prints);
  const attempts = app.findCollectionByNameOrId("checkin_agent_attempts");
  attempts.fields.getByName("purpose").values = ["generic", "initial", "replacement"];
  app.save(attempts);
}, () => { throw new Error("Recovery evidence requires a forward lifecycle migration."); });
