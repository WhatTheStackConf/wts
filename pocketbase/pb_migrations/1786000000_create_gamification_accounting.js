/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    const partners = app.findCollectionByNameOrId("partners");
    const sessions = app.findCollectionByNameOrId("sessions");

    const privateRules = {
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    };
    const categories = [
      "onboarding",
      "ticketing",
      "attendance",
      "session",
      "partner",
      "booth",
      "workshop",
      "satellite_event",
      "warmup_event",
      "community",
      "social",
      "easter_egg",
      "meta",
      "admin_manual",
    ];

    const achievements = new Collection({
      name: "gamification_achievements",
      type: "base",
      ...privateRules,
      fields: [
        { name: "key", type: "text", required: true, presentable: true, unique: true },
        { name: "badge_name", type: "text", required: true },
        { name: "badge_description", type: "text", required: true },
        { name: "locked_teaser", type: "text", required: false },
        { name: "icon", type: "text", required: false },
        { name: "category", type: "select", required: true, maxSelect: 1, values: categories },
        { name: "rarity", type: "select", required: true, maxSelect: 1, values: ["common", "uncommon", "rare", "epic", "legendary"] },
        { name: "visibility", type: "select", required: true, maxSelect: 1, values: ["public", "locked_teaser", "hidden_until_unlocked", "retired"] },
        { name: "status", type: "select", required: true, maxSelect: 1, values: ["draft", "active", "retired"] },
        { name: "unlock_rule", type: "json", required: true },
        { name: "active_from", type: "date", required: false },
        { name: "active_until", type: "date", required: false },
        { name: "sort_order", type: "number", required: false },
        { name: "metadata", type: "json", required: false },
      ],
    });
    app.save(achievements);

    const achievementCollection = app.findCollectionByNameOrId("gamification_achievements");
    const missions = new Collection({
      name: "gamification_missions",
      type: "base",
      ...privateRules,
      fields: [
        { name: "key", type: "text", required: true, presentable: true, unique: true },
        { name: "slug", type: "text", required: true, unique: true },
        { name: "title", type: "text", required: true },
        { name: "summary", type: "text", required: true },
        { name: "category", type: "select", required: true, maxSelect: 1, values: categories },
        { name: "visibility", type: "select", required: true, maxSelect: 1, values: ["public", "hidden_until_unlocked", "admin_only"] },
        { name: "status", type: "select", required: true, maxSelect: 1, values: ["draft", "active", "retired"] },
        { name: "starts_at", type: "date", required: false },
        { name: "ends_at", type: "date", required: false },
        { name: "primary_achievement", type: "relation", required: false, collectionId: achievementCollection.id, maxSelect: 1, cascadeDelete: false },
        { name: "partner", type: "relation", required: false, collectionId: partners.id, maxSelect: 1, cascadeDelete: false },
        { name: "session", type: "relation", required: false, collectionId: sessions.id, maxSelect: 1, cascadeDelete: false },
        { name: "event_ref", type: "json", required: false },
        { name: "suggested", type: "bool", required: false },
        { name: "sort_order", type: "number", required: false },
        { name: "metadata", type: "json", required: false },
      ],
    });
    app.save(missions);

    const missionCollection = app.findCollectionByNameOrId("gamification_missions");
    const activities = new Collection({
      name: "gamification_activities",
      type: "base",
      ...privateRules,
      fields: [
        { name: "key", type: "text", required: true, presentable: true, unique: true },
        { name: "mission", type: "relation", required: false, collectionId: missionCollection.id, maxSelect: 1, cascadeDelete: false },
        { name: "kind", type: "select", required: true, maxSelect: 1, values: ["session", "booth", "workshop", "warmup_event", "satellite_event", "community_partner", "social", "easter_egg", "hievents", "admin_manual", "meta"] },
        { name: "category", type: "select", required: true, maxSelect: 1, values: categories },
        { name: "outcome_key", type: "select", required: true, maxSelect: 1, values: ["visit", "participation", "completion", "win", "high_score", "attendance", "ticket_present", "checked_in", "static_discovery", "manual_award", "meta"] },
        { name: "evidence_mode", type: "select", required: true, maxSelect: 1, values: ["single_code", "two_code_start", "two_code_finish", "hievents_ticket", "hievents_checkin", "static_puzzle_code", "admin_manual", "meta_rule"] },
        { name: "achievement", type: "relation", required: false, collectionId: achievementCollection.id, maxSelect: 1, cascadeDelete: false },
        { name: "partner", type: "relation", required: false, collectionId: partners.id, maxSelect: 1, cascadeDelete: false },
        { name: "partner_kind", type: "select", required: false, maxSelect: 1, values: ["sponsor", "community_partner", "organizer", "workshop_host"] },
        { name: "session", type: "relation", required: false, collectionId: sessions.id, maxSelect: 1, cascadeDelete: false },
        { name: "event_ref", type: "json", required: false },
        { name: "per_user_claim_limit", type: "number", required: true },
        { name: "max_claims", type: "number", required: false },
        { name: "active_from", type: "date", required: false },
        { name: "active_until", type: "date", required: false },
        { name: "status", type: "select", required: true, maxSelect: 1, values: ["draft", "active", "retired"] },
        { name: "enabled", type: "bool", required: false },
        { name: "metadata", type: "json", required: false },
      ],
    });
    app.save(activities);

    const schedules = new Collection({
      name: "gamification_score_schedules",
      type: "base",
      ...privateRules,
      fields: [
        { name: "key", type: "text", required: true, presentable: true, unique: true },
        { name: "status", type: "select", required: true, maxSelect: 1, values: ["draft", "active", "superseded"] },
        { name: "effective_at", type: "date", required: true },
        { name: "superseded_at", type: "date", required: false },
        // PocketBase treats numeric zero as empty for required fields. These
        // fields deliberately allow zero for an empty or total-only schedule.
        { name: "total_xp_ceiling", type: "number", required: false },
        { name: "leaderboard_xp_ceiling", type: "number", required: false },
        { name: "access_level_thresholds", type: "json", required: true },
        { name: "activation_reason", type: "text", required: false },
        { name: "metadata", type: "json", required: false },
      ],
    });
    app.save(schedules);

    const scheduleCollection = app.findCollectionByNameOrId("gamification_score_schedules");
    const activityCollection = app.findCollectionByNameOrId("gamification_activities");
    const scorePolicies = new Collection({
      name: "gamification_score_schedule_policies",
      type: "base",
      ...privateRules,
      fields: [
        { name: "schedule", type: "relation", required: true, collectionId: scheduleCollection.id, maxSelect: 1, cascadeDelete: true },
        { name: "activity", type: "relation", required: true, collectionId: activityCollection.id, maxSelect: 1, cascadeDelete: false },
        { name: "policy_key", type: "text", required: true, presentable: true },
        { name: "active", type: "bool", required: false },
        { name: "total_xp", type: "number", required: false },
        { name: "leaderboard_xp", type: "number", required: false },
        { name: "cap_membership", type: "json", required: true },
        { name: "cap_ceiling_overrides", type: "json", required: false },
        { name: "score_day", type: "text", required: false },
        { name: "metadata", type: "json", required: false },
      ],
    });
    scorePolicies.addIndex("idx_gamification_schedule_policy_unique", true, "schedule, activity", "");
    scorePolicies.addIndex("idx_gamification_schedule_policy_key_unique", true, "schedule, policy_key", "");
    app.save(scorePolicies);

    const scoreCaps = new Collection({
      name: "gamification_score_schedule_caps",
      type: "base",
      ...privateRules,
      fields: [
        { name: "schedule", type: "relation", required: true, collectionId: scheduleCollection.id, maxSelect: 1, cascadeDelete: true },
        { name: "dimension", type: "select", required: true, maxSelect: 1, values: ["activity", "related_group", "partner", "category", "conference_day", "conference"] },
        { name: "cap_key", type: "text", required: true },
        { name: "member_policy_keys", type: "json", required: true },
        { name: "total_xp_ceiling", type: "number", required: false },
        { name: "leaderboard_xp_ceiling", type: "number", required: false },
      ],
    });
    scoreCaps.addIndex("idx_gamification_schedule_cap_unique", true, "schedule, dimension, cap_key", "");
    app.save(scoreCaps);

    const claims = new Collection({
      name: "gamification_activity_claims",
      type: "base",
      ...privateRules,
      fields: [
        { name: "user", type: "relation", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
        { name: "activity", type: "relation", required: true, collectionId: activityCollection.id, maxSelect: 1, cascadeDelete: false },
        { name: "source_type", type: "select", required: true, maxSelect: 1, values: ["code_redemption", "hievents_ticket", "hievents_checkin", "admin_manual", "static_puzzle_code", "system_meta"] },
        { name: "source_collection", type: "text", required: false },
        { name: "source_record_id", type: "text", required: false },
        { name: "outcome_key", type: "text", required: true },
        { name: "status", type: "select", required: true, maxSelect: 1, values: ["accepted", "voided"] },
        { name: "occurred_at", type: "date", required: true },
        { name: "claimed_at", type: "date", required: true },
        { name: "evidence_fingerprint", type: "text", required: true },
        { name: "idempotency_key", type: "text", required: true, unique: true },
        { name: "voided_at", type: "date", required: false },
        { name: "voided_by", type: "relation", required: false, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
        { name: "void_reason", type: "text", required: false },
        { name: "cap_outcome", type: "json", required: false },
        { name: "metadata", type: "json", required: false },
      ],
    });
    claims.addIndex("idx_gamification_claim_user_activity_unique", true, "user, activity", "");
    app.save(claims);

    const userAchievements = new Collection({
      name: "gamification_user_achievements",
      type: "base",
      ...privateRules,
      fields: [
        { name: "user", type: "relation", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
        { name: "achievement", type: "relation", required: true, collectionId: achievementCollection.id, maxSelect: 1, cascadeDelete: false },
        { name: "status", type: "select", required: true, maxSelect: 1, values: ["unlocked", "revoked"] },
        { name: "unlocked_at", type: "date", required: true },
        { name: "source_claim", type: "relation", required: false, collectionId: claims.id, maxSelect: 1, cascadeDelete: false },
        { name: "source_admin_action", type: "text", required: false },
        { name: "idempotency_key", type: "text", required: true, unique: true },
        { name: "public_visible", type: "bool", required: false },
        { name: "revoked_at", type: "date", required: false },
        { name: "revoked_by", type: "relation", required: false, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
        { name: "revoked_reason", type: "text", required: false },
        { name: "metadata", type: "json", required: false },
      ],
    });
    userAchievements.addIndex("idx_gamification_user_achievement_unique", true, "user, achievement", "");
    app.save(userAchievements);

    const userAchievementCollection = app.findCollectionByNameOrId("gamification_user_achievements");
    const xpEvents = new Collection({
      name: "gamification_xp_events",
      type: "base",
      ...privateRules,
      fields: [
        { name: "user", type: "relation", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
        { name: "amount", type: "number", required: false },
        { name: "leaderboard_amount", type: "number", required: false },
        { name: "category", type: "select", required: true, maxSelect: 1, values: categories },
        { name: "reason", type: "text", required: true },
        { name: "source_type", type: "select", required: true, maxSelect: 1, values: ["activity_claim", "admin_correction"] },
        { name: "source_claim", type: "relation", required: false, collectionId: claims.id, maxSelect: 1, cascadeDelete: false },
        { name: "user_achievement", type: "relation", required: false, collectionId: userAchievementCollection.id, maxSelect: 1, cascadeDelete: false },
        { name: "source_id", type: "text", required: false },
        { name: "idempotency_key", type: "text", required: true, unique: true },
        { name: "occurred_at", type: "date", required: true },
        { name: "voided", type: "bool", required: false },
        { name: "voided_at", type: "date", required: false },
        { name: "voided_by", type: "relation", required: false, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
        { name: "void_reason", type: "text", required: false },
        { name: "void_admin_action", type: "text", required: false },
        { name: "metadata", type: "json", required: false },
      ],
    });
    app.save(xpEvents);

    const profiles = new Collection({
      name: "gamification_profiles",
      type: "base",
      ...privateRules,
      fields: [
        { name: "user", type: "relation", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
        { name: "total_xp", type: "number", required: false },
        { name: "leaderboard_xp", type: "number", required: false },
        { name: "access_level", type: "number", required: true },
        { name: "access_level_schedule", type: "relation", required: false, collectionId: scheduleCollection.id, maxSelect: 1, cascadeDelete: false },
        { name: "access_level_threshold", type: "number", required: false },
        { name: "next_level_threshold", type: "number", required: false },
        { name: "xp_into_level", type: "number", required: false },
        { name: "xp_to_next_level", type: "number", required: false },
        { name: "unlocked_badge_count", type: "number", required: false },
        { name: "ops_board_visible", type: "bool", required: false },
        { name: "ops_board_display_name", type: "text", required: true },
        { name: "public_badges_visible", type: "bool", required: false },
        { name: "totals_version", type: "number", required: true },
        { name: "totals_recalculated_at", type: "date", required: true },
      ],
    });
    profiles.addIndex("idx_gamification_profile_user_unique", true, "user", "");
    app.save(profiles);

    const adminActions = new Collection({
      name: "gamification_admin_actions",
      type: "base",
      ...privateRules,
      fields: [
        { name: "actor", type: "relation", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
        { name: "actor_role", type: "select", required: true, maxSelect: 1, values: ["user", "reviewer", "admin"] },
        { name: "target_user", type: "relation", required: false, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
        { name: "action", type: "select", required: true, maxSelect: 1, values: ["manual_award", "revoke_user_achievement", "void_xp_event", "admin_correction", "rebuild_profile_cache", "configuration_change", "schedule_activation", "hievents_reconciliation"] },
        { name: "status", type: "select", required: true, maxSelect: 1, values: ["applied", "rebuild_pending", "failed"] },
        { name: "reason", type: "text", required: true },
        { name: "correlation_id", type: "text", required: false },
        { name: "idempotency_key", type: "text", required: true, unique: true },
        { name: "related_collection", type: "text", required: false },
        { name: "related_record_id", type: "text", required: false },
        { name: "before_summary", type: "json", required: false },
        { name: "after_summary", type: "json", required: false },
        { name: "metadata", type: "json", required: false },
      ],
    });
    app.save(adminActions);

    // The schedule is intentionally empty until organizers configure score-bearing Activities.
    // It establishes the fixed September ladder without seeding a production Badge catalog.
    const seededSchedule = new Record(scheduleCollection, {
      key: "wts-2026-september",
      status: "active",
      effective_at: "2026-09-01 00:00:00.000Z",
      total_xp_ceiling: 0,
      leaderboard_xp_ceiling: 0,
      access_level_thresholds: {
        "1": 0,
        "2": 0,
        "3": 0,
        "4": 0,
        "5": 0,
        "6": 0,
        "7": 0,
      },
      activation_reason: "September 2026 dynamic score schedule foundation",
    });
    app.save(seededSchedule);
  },
  (app) => {
    const collectionNames = [
      "gamification_admin_actions",
      "gamification_profiles",
      "gamification_xp_events",
      "gamification_user_achievements",
      "gamification_activity_claims",
      "gamification_score_schedule_caps",
      "gamification_score_schedule_policies",
      "gamification_score_schedules",
      "gamification_activities",
      "gamification_missions",
      "gamification_achievements",
    ];
    for (const collectionName of collectionNames) {
      const collection = app.findCollectionByNameOrId(collectionName);
      app.delete(collection);
    }
  },
);
