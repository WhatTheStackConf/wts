/// <reference path="../pb_data/types.d.ts" />
// Public performer designation, independent of MC duties or Session assignments.
migrate((app) => {
  const speakers = app.findCollectionByNameOrId("speakers");
  const existing = speakers.fields.getByName("is_dj");
  if (existing) {
    if (existing.type() !== "bool" || existing.required || existing.hidden) {
      throw new Error("speakers.is_dj must be an optional, public bool field");
    }
    return;
  }
  speakers.fields.add(new BoolField({ name: "is_dj", required: false, hidden: false }));
  app.save(speakers);
}, () => {
  // Preserve additive persona data on rollback, including schema-first records.
});
