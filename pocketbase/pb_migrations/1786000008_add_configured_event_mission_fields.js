/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const activities = app.findCollectionByNameOrId("gamification_activities");
    const evidenceMode = activities.fields.getByName("evidence_mode");
    evidenceMode.values = [...evidenceMode.values, "derived_claim_set"];
    activities.fields.add(new Field({ name: "event_meta_eligible", type: "bool", required: false }));
    app.save(activities);

    const claims = app.findCollectionByNameOrId("gamification_activity_claims");
    const sourceType = claims.fields.getByName("source_type");
    sourceType.values = [...sourceType.values, "system_derived"];
    app.save(claims);
  },
  (app) => {
    const derivedActivities = app.countRecords("gamification_activities", "evidence_mode = 'derived_claim_set'");
    const derivedClaims = app.countRecords("gamification_activity_claims", "source_type = 'system_derived'");
    if (derivedActivities > 0 || derivedClaims > 0) {
      throw new Error("Configured event accounting exists; this retained history migration cannot be rolled back.");
    }
    const activities = app.findCollectionByNameOrId("gamification_activities");
    activities.fields.getByName("evidence_mode").values = activities.fields.getByName("evidence_mode").values.filter((value) => value !== "derived_claim_set");
    activities.fields.removeByName("event_meta_eligible");
    app.save(activities);

    const claims = app.findCollectionByNameOrId("gamification_activity_claims");
    claims.fields.getByName("source_type").values = claims.fields.getByName("source_type").values.filter((value) => value !== "system_derived");
    app.save(claims);
  },
);
