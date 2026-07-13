/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    const mcpTokens = app.findCollectionByNameOrId("mcp_tokens");
    const collection = new Collection({
      name: "admin_actions",
      type: "base",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: "actor_user", type: "relation", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
        { name: "mcp_token", type: "relation", required: false, collectionId: mcpTokens.id, maxSelect: 1, cascadeDelete: false },
        { name: "source", type: "select", required: true, maxSelect: 1, values: ["admin_ui", "mcp"] },
        { name: "operation_kind", type: "text", required: true, max: 128 },
        { name: "target_collection", type: "text", required: true, max: 128 },
        { name: "target_id", type: "text", required: false, max: 128 },
        { name: "operation_id", type: "text", required: true, max: 128 },
        { name: "input_fingerprint", type: "text", required: true, max: 64 },
        { name: "idempotency_key", type: "text", required: true, max: 64 },
        { name: "status", type: "select", required: true, maxSelect: 1, values: ["pending", "applied", "failed"] },
        { name: "before_summary", type: "json", required: false, maxSize: 2048 },
        { name: "after_summary", type: "json", required: false, maxSize: 2048 },
        { name: "replay_result", type: "json", required: false, maxSize: 32768 },
        { name: "failure_code", type: "text", required: false, max: 64 },
        { name: "failure_message", type: "text", required: false, max: 256 },
        { name: "failure_metadata", type: "json", required: false, maxSize: 1024 },
        { name: "attempt_count", type: "number", required: true, min: 1, onlyInt: true },
        { name: "attempt_token", type: "text", required: true, max: 128 },
        { name: "lease_expires_at", type: "date", required: false },
        { name: "completed_at", type: "date", required: false },
        { name: "created", type: "autodate", onCreate: true, onUpdate: false },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    });
    collection.addIndex("idx_admin_actions_identity_unique", true, "idempotency_key", "");
    collection.addIndex("idx_admin_actions_target_history", false, "target_collection,target_id,created", "");
    collection.addIndex("idx_admin_actions_status_lease", false, "status,lease_expires_at", "");
    collection.addIndex("idx_admin_actions_actor_source", false, "actor_user,source,created", "");
    collection.addIndex("idx_admin_actions_mcp_token", false, "mcp_token,created", "mcp_token != ''");
    app.save(collection);

  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("admin_actions"));
  },
);
