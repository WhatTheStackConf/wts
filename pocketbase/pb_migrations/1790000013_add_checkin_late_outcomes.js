/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const attempts = app.findCollectionByNameOrId("checkin_arrival_attempts");
  // Never infer authority for pre-migration attempts from a replacement lease.
  attempts.fields.add(new TextField({ name: "claim_owner_hash", max: 64 }));
  attempts.fields.add(new TextField({ name: "outcome_digest", max: 64 }));
  app.save(attempts);
}, (app) => {
  if (app.countRecords("checkin_arrival_attempts")) throw new Error("Admission history exists; use a forward migration.");
  const attempts = app.findCollectionByNameOrId("checkin_arrival_attempts");
  for (const name of ["claim_owner_hash", "outcome_digest"]) attempts.fields.removeByName(name);
  app.save(attempts);
});
