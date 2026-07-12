/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const badges = app.findCollectionByNameOrId("gamification_user_achievements");
    badges.removeIndex("idx_gamification_user_achievement_unique");
    // Revoked Badge history is retained. At most one current Badge may exist per User/Achievement.
    badges.addIndex(
      "idx_gamification_user_achievement_unlocked_unique",
      true,
      "user, achievement",
      "status = 'unlocked'",
    );
    app.save(badges);
  },
  (app) => {
    const badges = app.findCollectionByNameOrId("gamification_user_achievements");
    badges.removeIndex("idx_gamification_user_achievement_unlocked_unique");
    badges.addIndex("idx_gamification_user_achievement_unique", true, "user, achievement", "");
    app.save(badges);
  },
);
