/// <reference path="../pb_data/types.d.ts" />
// TextField's legacy `unique: true` option is not a uniqueness constraint in
// current PocketBase. Explicit SQLite indexes are required for real mutual
// exclusion and idempotency. Fail on conflicting history; never delete it.
migrate((app) => {
  const keys = [
    ["gamification_operation_locks", "key", "lock_key"],
    ["gamification_achievements", "key", "achievement_key"],
    ["gamification_missions", "key", "mission_key"],
    ["gamification_missions", "slug", "mission_slug"],
    ["gamification_activities", "key", "activity_key"],
    ["gamification_score_schedules", "key", "schedule_key"],
    ["gamification_codes", "key", "code_key"],
    ["gamification_code_redemptions", "idempotency_key", "redemption_operation"],
    ["gamification_activity_claims", "idempotency_key", "claim_operation"],
    ["gamification_user_achievements", "idempotency_key", "badge_operation"],
    ["gamification_xp_events", "idempotency_key", "xp_operation"],
    ["gamification_admin_actions", "idempotency_key", "admin_operation"],
  ];
  for (const [name, field, key] of keys) {
    const collection = app.findCollectionByNameOrId(name);
    collection.addIndex(`idx_gamification_${key}_unique`, true, field, "");
    app.save(collection);
  }
}, () => {
  throw new Error("Do not remove accounting uniqueness guarantees. Use a reviewed forward migration.");
});
