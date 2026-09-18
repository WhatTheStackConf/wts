/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const commands = app.findCollectionByNameOrId("checkin_arrival_commands");
  commands.fields.add(new TextField({ name: "requested_print_id", max: 15 }));
  commands.addIndex("idx_arrival_requested_print", false, "requested_print_id", "requested_print_id != ''");
  app.save(commands);
  const workflows = app.findCollectionByNameOrId("checkin_arrival_workflows");
  workflows.fields.add(new SelectField({ name: "admission_basis", values: ["local", "upstream_existing"], maxSelect: 1 }));
  app.save(workflows);
  app.db().newQuery("UPDATE checkin_arrival_workflows SET admission_basis = 'local' WHERE admission_basis = ''").execute();
  // Only the original admission command has evidence that it requested this
  // initial label. Historical duplicate/reopen commands never gain a pointer.
  app.db().newQuery(`UPDATE checkin_arrival_commands SET requested_print_id = (
    SELECT p.id FROM checkin_arrival_workflows w JOIN checkin_print_attempts p
      ON p.id = w.print_intent_id AND p.workflow_id = w.id
      AND p.station_id = w.station_id AND p.purpose = 'initial'
    WHERE w.id = checkin_arrival_commands.workflow_id
      AND w.operation_id = checkin_arrival_commands.operation_id
      AND w.station_id = checkin_arrival_commands.station_id
  ) WHERE EXISTS (
    SELECT 1 FROM checkin_arrival_workflows w JOIN checkin_print_attempts p
      ON p.id = w.print_intent_id AND p.workflow_id = w.id
      AND p.station_id = w.station_id AND p.purpose = 'initial'
    WHERE w.id = checkin_arrival_commands.workflow_id
      AND w.operation_id = checkin_arrival_commands.operation_id
      AND w.station_id = checkin_arrival_commands.station_id
  )`).execute();
}, () => { throw new Error("Print request evidence requires an explicit forward migration."); });
