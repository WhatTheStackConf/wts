/// <reference path="../pb_data/types.d.ts" />
// Additive, empty event catalogue: no production or fixture identifiers seeded.
migrate((app) => {
  const events = new Collection({ name: "checkin_events", type: "base", listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "edition", type: "select", values: ["WTS2026"], maxSelect: 1, required: true },
      { name: "source_key", type: "text", required: true, max: 64, pattern: "^[a-f0-9]{64}$" },
      { name: "upstream_event_id", type: "text", required: true, max: 16, pattern: "^[1-9][0-9]*$" },
      { name: "title", type: "text", required: true, max: 200 },
      { name: "member", type: "bool" },
      { name: "list_id", type: "text", max: 16, pattern: "^[1-9][0-9]*$" },
      { name: "affiliation", type: "json", maxSize: 2048 },
      { name: "enabled", type: "bool" },
      { name: "generation", type: "number", required: true, min: 1, onlyInt: true },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
  });
  events.addIndex("idx_checkin_event_identity", true, "edition,source_key,upstream_event_id", "");
  app.save(events);
  const bindings = app.findCollectionByNameOrId("checkin_bindings");
  bindings.fields.add(new RelationField({ name: "selected_event", collectionId: events.id, maxSelect: 1, cascadeDelete: false }));
  for (const name of ["selected_event_generation", "selected_binding_version", "selection_version"]) bindings.fields.add(new NumberField({ name, min: 0, onlyInt: true }));
  app.save(bindings);
  const audit = app.findCollectionByNameOrId("checkin_audit_events");
  const operation = audit.fields.getByName("operation");
  operation.values = operation.values.concat(["configure_event", "select_event"]);
  audit.fields.add(new TextField({ name: "event_id", max: 15 }));
  app.save(audit);
}, (app) => {
  if (app.countRecords("checkin_events")) throw new Error("Event configuration contains operational history; use a forward migration.");
  const bindings = app.findCollectionByNameOrId("checkin_bindings");
  for (const name of ["selected_event", "selected_event_generation", "selected_binding_version", "selection_version"]) bindings.fields.removeByName(name);
  app.save(bindings);
  const audit = app.findCollectionByNameOrId("checkin_audit_events");
  const operation = audit.fields.getByName("operation");
  operation.values = operation.values.filter((value) => !["configure_event", "select_event"].includes(value));
  audit.fields.removeByName("event_id"); app.save(audit);
  app.delete(app.findCollectionByNameOrId("checkin_events"));
});
