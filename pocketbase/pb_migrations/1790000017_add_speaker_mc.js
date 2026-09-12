/// <reference path="../pb_data/types.d.ts" />
// Additive WTS2026 persona metadata; no Session, Slot or appearance assignment.
migrate((app) => {
  const speakers = app.findCollectionByNameOrId("speakers");
  const existing = speakers.fields.getByName("is_mc");
  if (existing) {
    // A safe schema-first release may already have added this exact field.
    if (existing.type() !== "bool" || existing.required || existing.hidden) {
      throw new Error("speakers.is_mc must be an optional, public bool field");
    }
    return;
  }
  // PocketBase bool fields default to false (including existing records).
  speakers.fields.add(new BoolField({ name: "is_mc", required: false, hidden: false }));
  app.save(speakers);
}, () => {
  // Deliberately retain additive data on rollback: it may predate this migration.
});
