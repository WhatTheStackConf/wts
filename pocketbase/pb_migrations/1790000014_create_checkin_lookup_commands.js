/// <reference path="../pb_data/types.d.ts" />
migrate(app => {
  const text = (name, max, required = true) => ({ name, type: "text", max, required });
  const c = new Collection({ name: "checkin_lookup_commands", type: "base", listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null, fields: [
    text("operation_id", 36), text("payload_hash", 64), text("attendee_id", 16), text("qr_hash", 64), text("source_key", 64), text("affiliation_choice", 5), text("prior_operation_id", 36, false), text("station_id", 15),
    { name: "context", type: "json", maxSize: 4096 }, { name: "snapshot", type: "json", maxSize: 8192 },
    { name: "created", type: "autodate", onCreate: true, onUpdate: false },
  ] });
  c.addIndex("idx_lookup_operation", true, "operation_id", "");
  c.addIndex("idx_lookup_prior", false, "prior_operation_id", "");
  app.save(c);
}, app => {
  if (app.countRecords("checkin_lookup_commands")) throw new Error("Lookup commands require lifecycle purge.");
  app.delete(app.findCollectionByNameOrId("checkin_lookup_commands"));
});
