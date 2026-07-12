/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const claims = app.findCollectionByNameOrId("gamification_activity_claims");
    claims.fields.add(new Field({ name: "void_admin_action", type: "text", required: false }));
    claims.removeIndex("idx_gamification_claim_user_activity_unique");
    // Retain void history while permitting corrected evidence to create one new current claim.
    claims.addIndex(
      "idx_gamification_claim_user_activity_accepted_unique",
      true,
      "user, activity",
      "status = 'accepted'",
    );
    app.save(claims);

    const actions = app.findCollectionByNameOrId("gamification_admin_actions");
    const action = actions.fields.getByName("action");
    action.values = [
      "manual_award",
      "revoke_user_achievement",
      "void_xp_event",
      "void_activity_claim",
      "admin_correction",
      "rebuild_profile_cache",
      "configuration_change",
      "schedule_activation",
      "hievents_reconciliation",
      "code_generation",
      "code_invalidation",
      "code_reissue",
    ];
    app.save(actions);
  },
  (app) => {
    const claims = app.findCollectionByNameOrId("gamification_activity_claims");
    claims.removeIndex("idx_gamification_claim_user_activity_accepted_unique");
    claims.addIndex("idx_gamification_claim_user_activity_unique", true, "user, activity", "");
    claims.fields.removeByName("void_admin_action");
    app.save(claims);

    const actions = app.findCollectionByNameOrId("gamification_admin_actions");
    const action = actions.fields.getByName("action");
    action.values = [
      "manual_award",
      "revoke_user_achievement",
      "void_xp_event",
      "admin_correction",
      "rebuild_profile_cache",
      "configuration_change",
      "schedule_activation",
      "hievents_reconciliation",
      "code_generation",
      "code_invalidation",
      "code_reissue",
    ];
    app.save(actions);
  },
);
