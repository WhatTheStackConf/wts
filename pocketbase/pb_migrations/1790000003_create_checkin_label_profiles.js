/// <reference path="../pb_data/types.d.ts" />
// No device identities, calibration, synthetic fixtures or approval are seeded.
migrate((app) => {
  const station = app.findCollectionByNameOrId("checkin_stations");
  const profiles = new Collection({ name: "checkin_label_profiles", type: "base", listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "station", type: "relation", collectionId: station.id, maxSelect: 1, cascadeDelete: false, required: true },
      { name: "station_version", type: "number", min: 1, onlyInt: true, required: true },
      { name: "version", type: "number", min: 1, onlyInt: true, required: true },
      { name: "config", type: "json", required: true, maxSize: 8192 },
      { name: "admin_action_id", type: "text", required: true, max: 15 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
  });
  profiles.addIndex("idx_checkin_label_profile_version", true, "station,version", "");
  app.save(profiles);
  // Approval is a separate immutable attestation, never a config overwrite.
  const approvals = new Collection({ name: "checkin_label_approvals", type: "base", listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "profile", type: "relation", collectionId: profiles.id, maxSelect: 1, cascadeDelete: false, required: true },
      { name: "station_version", type: "number", min: 1, onlyInt: true, required: true },
      { name: "physical_confirmation", type: "bool", required: true },
      { name: "admin_action_id", type: "text", required: true, max: 15 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
  });
  approvals.addIndex("idx_checkin_label_approval_profile", true, "profile", "");
  app.save(approvals);
  const audit = app.findCollectionByNameOrId("checkin_audit_events");
  audit.fields.getByName("operation").values = audit.fields.getByName("operation").values.concat(["configure_label_profile", "approve_label_profile"]);
  audit.fields.add(new TextField({ name: "label_profile_id", max: 15 }));
  app.save(audit);
}, (app) => {
  if (app.countRecords("checkin_label_profiles") || app.countRecords("checkin_label_approvals")) throw new Error("Name Label profile history exists; use a forward migration.");
  app.delete(app.findCollectionByNameOrId("checkin_label_approvals"));
  app.delete(app.findCollectionByNameOrId("checkin_label_profiles"));
  const audit = app.findCollectionByNameOrId("checkin_audit_events");
  audit.fields.getByName("operation").values = audit.fields.getByName("operation").values.filter((value) => !["configure_label_profile", "approve_label_profile"].includes(value));
  audit.fields.removeByName("label_profile_id"); app.save(audit);
});
