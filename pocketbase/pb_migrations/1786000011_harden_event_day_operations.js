/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const privateRules = {
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    };

    const locks = new Collection({
      name: "gamification_operation_locks",
      type: "base",
      ...privateRules,
      fields: [
        { name: "key", type: "text", required: true, unique: true },
        { name: "owner", type: "text", required: true },
        { name: "expires_at", type: "date", required: true },
      ],
    });
    locks.addIndex("idx_gamification_operation_lock_expiry", false, "expires_at", "");
    app.save(locks);

    const rateLimitAttempts = new Collection({
      name: "gamification_rate_limit_attempts",
      type: "base",
      ...privateRules,
      fields: [
        { name: "bucket_hash", type: "text", required: true },
        { name: "expires_at", type: "date", required: true },
      ],
    });
    rateLimitAttempts.addIndex("idx_gamification_rate_limit_bucket_expiry", false, "bucket_hash, expires_at", "");
    app.save(rateLimitAttempts);

    const timestampedCollections = [
      "gamification_achievements",
      "gamification_missions",
      "gamification_activities",
      "gamification_score_schedules",
      "gamification_score_schedule_policies",
      "gamification_score_schedule_caps",
      "gamification_codes",
      "gamification_code_redemptions",
      "gamification_activity_claims",
      "gamification_user_achievements",
      "gamification_xp_events",
      "gamification_profiles",
      "gamification_admin_actions",
      "gamification_hievents_sync_runs",
      "partner_contact_consents",
      "partner_contact_disclosures",
    ];
    for (const collectionName of timestampedCollections) {
      const collection = app.findCollectionByNameOrId(collectionName);
      collection.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }));
      collection.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
      app.save(collection);
    }

    const profiles = app.findCollectionByNameOrId("gamification_profiles");
    profiles.fields.add(new Field({ name: "rebuild_pending", type: "bool", required: false }));
    profiles.fields.add(new Field({ name: "rebuild_support_reference", type: "text", required: false }));
    profiles.addIndex("idx_gamification_profiles_ops_order", false, "ops_board_visible, leaderboard_xp DESC, id", "");
    profiles.addIndex("idx_gamification_profiles_rebuild", false, "rebuild_pending, totals_recalculated_at", "");
    app.save(profiles);

    const codes = app.findCollectionByNameOrId("gamification_codes");
    codes.addIndex("idx_gamification_codes_activity_status", false, "activity, status, enabled", "");
    codes.addIndex("idx_gamification_codes_batch_order", false, "batch_id, id", "");
    app.save(codes);

    const redemptions = app.findCollectionByNameOrId("gamification_code_redemptions");
    redemptions.addIndex("idx_gamification_redemption_accepted_unique", true, "user, code", "status = 'accepted'");
    redemptions.addIndex("idx_gamification_redemption_code_status_time", false, "code, status, redeemed_at DESC", "");
    redemptions.addIndex("idx_gamification_redemption_activity_status_time", false, "activity, status, redeemed_at DESC", "");
    redemptions.addIndex("idx_gamification_redemption_user_history", false, "user, redeemed_at DESC, id", "");
    app.save(redemptions);

    const claims = app.findCollectionByNameOrId("gamification_activity_claims");
    claims.addIndex("idx_gamification_claim_activity_status_time", false, "activity, status, claimed_at DESC", "");
    claims.addIndex("idx_gamification_claim_user_history", false, "user, claimed_at DESC, id", "");
    claims.addIndex("idx_gamification_claim_source_reconcile", false, "source_type, source_record_id, status", "");
    claims.addIndex("idx_gamification_claim_source_link", false, "source_collection, source_record_id", "");
    app.save(claims);

    const xpEvents = app.findCollectionByNameOrId("gamification_xp_events");
    xpEvents.addIndex("idx_gamification_xp_user_accounting", false, "user, voided, occurred_at", "");
    xpEvents.addIndex("idx_gamification_xp_source_claim", false, "source_claim, voided", "");
    xpEvents.addIndex("idx_gamification_xp_user_history", false, "user, occurred_at DESC, id", "");
    app.save(xpEvents);

    const badges = app.findCollectionByNameOrId("gamification_user_achievements");
    badges.addIndex("idx_gamification_badges_user_status_time", false, "user, status, unlocked_at DESC", "");
    badges.addIndex("idx_gamification_badges_achievement_status", false, "achievement, status", "");
    app.save(badges);

    const missions = app.findCollectionByNameOrId("gamification_missions");
    missions.addIndex("idx_gamification_missions_active_suggested", false, "status, visibility, suggested, sort_order", "");
    app.save(missions);

    const activities = app.findCollectionByNameOrId("gamification_activities");
    activities.addIndex("idx_gamification_activities_active", false, "status, enabled, active_from, active_until", "");
    activities.addIndex("idx_gamification_activities_mission", false, "mission, status, key", "");
    app.save(activities);

    const actions = app.findCollectionByNameOrId("gamification_admin_actions");
    actions.addIndex("idx_gamification_actions_target_history", false, "target_user, created DESC, id", "");
    actions.addIndex("idx_gamification_actions_repair", false, "status, target_user, created DESC", "");
    app.save(actions);

    const syncRuns = app.findCollectionByNameOrId("gamification_hievents_sync_runs");
    syncRuns.addIndex("idx_gamification_hievents_user_latest", false, "user, event_id, fetched_at DESC", "");
    syncRuns.addIndex("idx_gamification_hievents_source", false, "event_id, source_stable_id, fetched_at DESC", "");
    app.save(syncRuns);

    const days = app.findCollectionByNameOrId("conference_days");
    days.addIndex("idx_conference_days_public_order", false, "published, display_order, local_date", "");
    app.save(days);
    const tracks = app.findCollectionByNameOrId("agenda_tracks");
    tracks.addIndex("idx_agenda_tracks_day_order", false, "day, display_order, id", "");
    app.save(tracks);
    const slots = app.findCollectionByNameOrId("agenda_slots");
    slots.addIndex("idx_agenda_slots_public_order", false, "published, day, start_at, track, display_order", "");
    slots.addIndex("idx_agenda_slots_session_public", false, "session, published", "session != ''");
    app.save(slots);
  },
  (app) => {
    const timestampedCollections = [
      "gamification_achievements",
      "gamification_missions",
      "gamification_activities",
      "gamification_score_schedules",
      "gamification_score_schedule_policies",
      "gamification_score_schedule_caps",
      "gamification_codes",
      "gamification_code_redemptions",
      "gamification_activity_claims",
      "gamification_user_achievements",
      "gamification_xp_events",
      "gamification_profiles",
      "gamification_admin_actions",
      "gamification_hievents_sync_runs",
      "partner_contact_consents",
      "partner_contact_disclosures",
    ];
    const removeIndexes = (collectionName, names) => {
      const collection = app.findCollectionByNameOrId(collectionName);
      for (const name of names) collection.removeIndex(name);
      app.save(collection);
    };
    removeIndexes("agenda_slots", ["idx_agenda_slots_public_order", "idx_agenda_slots_session_public"]);
    removeIndexes("agenda_tracks", ["idx_agenda_tracks_day_order"]);
    removeIndexes("conference_days", ["idx_conference_days_public_order"]);
    removeIndexes("gamification_hievents_sync_runs", ["idx_gamification_hievents_user_latest", "idx_gamification_hievents_source"]);
    removeIndexes("gamification_admin_actions", ["idx_gamification_actions_target_history", "idx_gamification_actions_repair"]);
    removeIndexes("gamification_activities", ["idx_gamification_activities_active", "idx_gamification_activities_mission"]);
    removeIndexes("gamification_missions", ["idx_gamification_missions_active_suggested"]);
    removeIndexes("gamification_user_achievements", ["idx_gamification_badges_user_status_time", "idx_gamification_badges_achievement_status"]);
    removeIndexes("gamification_xp_events", ["idx_gamification_xp_user_accounting", "idx_gamification_xp_source_claim", "idx_gamification_xp_user_history"]);
    removeIndexes("gamification_activity_claims", ["idx_gamification_claim_activity_status_time", "idx_gamification_claim_user_history", "idx_gamification_claim_source_reconcile", "idx_gamification_claim_source_link"]);
    removeIndexes("gamification_code_redemptions", ["idx_gamification_redemption_accepted_unique", "idx_gamification_redemption_code_status_time", "idx_gamification_redemption_activity_status_time", "idx_gamification_redemption_user_history"]);
    removeIndexes("gamification_codes", ["idx_gamification_codes_activity_status", "idx_gamification_codes_batch_order"]);
    const profiles = app.findCollectionByNameOrId("gamification_profiles");
    profiles.removeIndex("idx_gamification_profiles_ops_order");
    profiles.removeIndex("idx_gamification_profiles_rebuild");
    profiles.fields.removeByName("rebuild_pending");
    profiles.fields.removeByName("rebuild_support_reference");
    app.save(profiles);
    for (const collectionName of timestampedCollections) {
      const collection = app.findCollectionByNameOrId(collectionName);
      collection.fields.removeByName("created");
      collection.fields.removeByName("updated");
      app.save(collection);
    }
    app.delete(app.findCollectionByNameOrId("gamification_rate_limit_attempts"));
    app.delete(app.findCollectionByNameOrId("gamification_operation_locks"));
  },
);
