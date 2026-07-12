/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    const activities = app.findCollectionByNameOrId("gamification_activities");
    const claims = app.findCollectionByNameOrId("gamification_activity_claims");
    const privateRules = {
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    };

    const codes = new Collection({
      name: "gamification_codes",
      type: "base",
      ...privateRules,
      fields: [
        { name: "key", type: "text", required: true, presentable: true, unique: true },
        { name: "label", type: "text", required: true },
        { name: "activity", type: "relation", required: true, collectionId: activities.id, maxSelect: 1, cascadeDelete: false },
        { name: "lookup_prefix", type: "text", required: true },
        { name: "code_hash", type: "text", required: true },
        { name: "hash_version", type: "select", required: true, maxSelect: 1, values: ["hmac-sha256-v1"] },
        { name: "evidence_role", type: "select", required: true, maxSelect: 1, values: ["single", "start", "finish", "static_puzzle"] },
        { name: "status", type: "select", required: true, maxSelect: 1, values: ["active", "disabled"] },
        { name: "enabled", type: "bool", required: false },
        { name: "starts_at", type: "date", required: false },
        { name: "ends_at", type: "date", required: false },
        { name: "max_redemptions", type: "number", required: false },
        { name: "per_user_limit", type: "number", required: true },
        { name: "total_redemptions_cached", type: "number", required: false },
        { name: "created_by", type: "relation", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
        { name: "invalidated_at", type: "date", required: false },
        { name: "invalidated_by", type: "relation", required: false, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
        { name: "invalidated_reason", type: "text", required: false },
        { name: "metadata", type: "json", required: false },
      ],
    });
    codes.addIndex("idx_gamification_code_lookup", false, "lookup_prefix, hash_version", "");
    app.save(codes);

    const codeCollection = app.findCollectionByNameOrId("gamification_codes");
    const redemptions = new Collection({
      name: "gamification_code_redemptions",
      type: "base",
      ...privateRules,
      fields: [
        { name: "user", type: "relation", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
        { name: "code", type: "relation", required: true, collectionId: codeCollection.id, maxSelect: 1, cascadeDelete: false },
        { name: "activity", type: "relation", required: true, collectionId: activities.id, maxSelect: 1, cascadeDelete: false },
        { name: "activity_claim", type: "relation", required: false, collectionId: claims.id, maxSelect: 1, cascadeDelete: false },
        { name: "status", type: "select", required: true, maxSelect: 1, values: ["accepted", "rejected_not_yet_active", "rejected_expired", "rejected_disabled", "rejected_global_limit", "rejected_user_limit"] },
        { name: "redeemed_at", type: "date", required: true },
        { name: "idempotency_key", type: "text", required: true, unique: true },
        { name: "source_hint", type: "text", required: false },
        { name: "request_fingerprint", type: "text", required: false },
        { name: "lookup_prefix", type: "text", required: false },
        { name: "hash_version", type: "text", required: false },
        { name: "metadata", type: "json", required: false },
      ],
    });
    redemptions.addIndex("idx_gamification_code_redemption_lookup", false, "user, code, status", "");
    app.save(redemptions);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("gamification_code_redemptions"));
    app.delete(app.findCollectionByNameOrId("gamification_codes"));
  },
);
