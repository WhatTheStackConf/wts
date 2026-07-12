/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const activities = app.findCollectionByNameOrId("gamification_activities");
    const evidenceChannel = activities.fields.getByName("evidence_channel");
    evidenceChannel.values = [...evidenceChannel.values, "wts_static_code"];
    activities.fields.add(new Field({ name: "community_meta_eligible", type: "bool", required: false }));
    app.save(activities);

    const disclosures = app.findCollectionByNameOrId("partner_contact_disclosures");
    disclosures.addIndex(
      "idx_partner_contact_disclosure_activity_unique",
      true,
      "user, partner, activity, purpose",
      "",
    );
    app.save(disclosures);
  },
  (app) => {
    const communityActivities = app.countRecords("gamification_activities", "kind = 'community_partner'");
    const staticCodeActivities = app.countRecords("gamification_activities", "evidence_channel = 'wts_static_code'");
    if (communityActivities > 0 || staticCodeActivities > 0) {
      throw new Error("Community Partner configuration exists; this retained history migration cannot be rolled back.");
    }
    const activities = app.findCollectionByNameOrId("gamification_activities");
    activities.fields.getByName("evidence_channel").values = activities.fields.getByName("evidence_channel").values
      .filter((value) => value !== "wts_static_code");
    activities.fields.removeByName("community_meta_eligible");
    app.save(activities);

    const disclosures = app.findCollectionByNameOrId("partner_contact_disclosures");
    disclosures.removeIndex("idx_partner_contact_disclosure_activity_unique");
    app.save(disclosures);
  },
);
