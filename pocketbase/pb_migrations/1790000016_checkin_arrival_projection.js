/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const prints = app.findCollectionByNameOrId("checkin_print_attempts");
  prints.fields.add(new TextField({ name: "fulfillment_completed_at", max: 40 }));
  app.save(prints);
  const commands = app.findCollectionByNameOrId("checkin_arrival_commands");
  commands.addIndex("idx_arrival_history_cursor", false, "history_visible,station_id,created,id", "");
  commands.addIndex("idx_arrival_continuation", false, "prior_operation_id", "");
  app.save(commands);
}, () => { throw new Error("Fulfillment evidence requires an explicit forward migration."); });
