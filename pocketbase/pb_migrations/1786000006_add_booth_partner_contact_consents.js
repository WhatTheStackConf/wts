/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    const partners = app.findCollectionByNameOrId("partners");
    const activities = app.findCollectionByNameOrId("gamification_activities");
    const missions = app.findCollectionByNameOrId("gamification_missions");
    const privateRules = {
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    };

    missions.fields.add(new Field({ name: "partner_key", type: "text", required: false }));
    app.save(missions);

    activities.fields.add(new Field({
      name: "evidence_channel",
      type: "select",
      required: false,
      maxSelect: 1,
      values: ["wts_qr", "wts_link", "wts_manual_code"],
    }));
    activities.fields.add(new Field({ name: "deployment_label", type: "text", required: false }));
    activities.fields.add(new Field({ name: "partner_follow_up_enabled", type: "bool", required: false }));
    activities.fields.add(new Field({ name: "partner_follow_up_notice_version", type: "text", required: false }));
    app.save(activities);

    const consents = new Collection({
      name: "partner_contact_consents",
      type: "base",
      ...privateRules,
      fields: [
        { name: "user", type: "relation", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
        { name: "partner", type: "relation", required: true, collectionId: partners.id, maxSelect: 1, cascadeDelete: false },
        { name: "activity", type: "relation", required: true, collectionId: activities.id, maxSelect: 1, cascadeDelete: false },
        { name: "purpose", type: "select", required: true, maxSelect: 1, values: ["partner_follow_up"] },
        { name: "notice_version", type: "text", required: true },
        { name: "approved_fields", type: "json", required: true },
        { name: "state", type: "select", required: true, maxSelect: 1, values: ["granted", "withdrawn"] },
        { name: "granted_at", type: "date", required: true },
        { name: "withdrawn_at", type: "date", required: false },
      ],
    });
    // A withdrawal is retained as history; only one currently grantable consent may exist.
    consents.addIndex(
      "idx_partner_contact_consent_granted_unique",
      true,
      "user, partner, activity, purpose, notice_version",
      "state = 'granted'",
    );
    app.save(consents);

    const consentCollection = app.findCollectionByNameOrId("partner_contact_consents");
    const disclosures = new Collection({
      name: "partner_contact_disclosures",
      type: "base",
      ...privateRules,
      fields: [
        { name: "consent", type: "relation", required: true, collectionId: consentCollection.id, maxSelect: 1, cascadeDelete: false },
        { name: "user", type: "relation", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
        { name: "partner", type: "relation", required: true, collectionId: partners.id, maxSelect: 1, cascadeDelete: false },
        { name: "activity", type: "relation", required: true, collectionId: activities.id, maxSelect: 1, cascadeDelete: false },
        { name: "actor", type: "relation", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
        { name: "purpose", type: "select", required: true, maxSelect: 1, values: ["partner_follow_up"] },
        { name: "approved_fields", type: "json", required: true },
        { name: "disclosed_at", type: "date", required: true },
      ],
    });
    // Each consent can authorize one manually performed handoff only.
    disclosures.addIndex("idx_partner_contact_disclosure_consent_unique", true, "consent", "");
    app.save(disclosures);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("partner_contact_disclosures"));
    app.delete(app.findCollectionByNameOrId("partner_contact_consents"));

    const missions = app.findCollectionByNameOrId("gamification_missions");
    missions.fields.removeByName("partner_key");
    app.save(missions);

    const activities = app.findCollectionByNameOrId("gamification_activities");
    activities.fields.removeByName("evidence_channel");
    activities.fields.removeByName("deployment_label");
    activities.fields.removeByName("partner_follow_up_enabled");
    activities.fields.removeByName("partner_follow_up_notice_version");
    app.save(activities);
  },
);
