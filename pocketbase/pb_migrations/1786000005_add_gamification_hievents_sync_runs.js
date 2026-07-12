/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    const adminActions = app.findCollectionByNameOrId("gamification_admin_actions");
    const privateRules = {
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    };
    const runs = new Collection({
      name: "gamification_hievents_sync_runs",
      type: "base",
      ...privateRules,
      fields: [
        { name: "user", type: "relation", required: false, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
        { name: "actor", type: "relation", required: false, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
        { name: "admin_action", type: "relation", required: false, collectionId: adminActions.id, maxSelect: 1, cascadeDelete: false },
        { name: "event_id", type: "text", required: true },
        { name: "scope", type: "select", required: true, maxSelect: 1, values: ["current_user", "admin_reconciliation"] },
        { name: "result_state", type: "select", required: true, maxSelect: 1, values: ["success", "partial", "unavailable"] },
        { name: "user_status", type: "select", required: false, maxSelect: 1, values: ["ticket_present", "checked_in", "no_ticket", "not_checked_in", "unavailable", "stale", "ambiguous", "source_corrected"] },
        { name: "fetched_at", type: "date", required: true },
        { name: "last_success_at", type: "date", required: false },
        { name: "source_updated_at", type: "date", required: false },
        { name: "requested_pages", type: "number", required: false },
        { name: "completed_pages", type: "number", required: false },
        { name: "complete", type: "bool", required: false },
        { name: "matched_count", type: "number", required: false },
        { name: "ambiguous_count", type: "number", required: false },
        { name: "created_claim_count", type: "number", required: false },
        { name: "corrected_claim_count", type: "number", required: false },
        { name: "source_stable_id", type: "text", required: false },
        { name: "checkin_id", type: "text", required: false },
        { name: "checked_in_at", type: "date", required: false },
      ],
    });
    runs.addIndex("idx_gamification_hievents_sync_user_event", false, "user, event_id, fetched_at", "");
    runs.addIndex("idx_gamification_hievents_sync_event", false, "event_id, fetched_at", "");
    app.save(runs);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("gamification_hievents_sync_runs"));
  },
);
