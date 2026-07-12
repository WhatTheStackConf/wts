/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const codes = app.findCollectionByNameOrId("gamification_codes");
    codes.fields.add(new Field({ name: "batch_id", type: "text", required: false }));
    codes.fields.add(new Field({
      name: "reissued_from",
      type: "relation",
      required: false,
      collectionId: codes.id,
      maxSelect: 1,
      cascadeDelete: false,
    }));
    codes.addIndex("idx_gamification_code_batch", false, "batch_id", "");
    codes.addIndex("idx_gamification_code_reissued_from", true, "reissued_from", "reissued_from != ''");
    app.save(codes);

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
  (app) => {
    const codes = app.findCollectionByNameOrId("gamification_codes");
    codes.removeIndex("idx_gamification_code_batch");
    codes.removeIndex("idx_gamification_code_reissued_from");
    codes.fields.removeByName("batch_id");
    codes.fields.removeByName("reissued_from");
    app.save(codes);

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
    ];
    app.save(actions);
  },
);
