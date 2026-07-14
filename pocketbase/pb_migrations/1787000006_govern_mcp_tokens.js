/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const tokens = app.findCollectionByNameOrId("mcp_tokens");
    tokens.listRule = null;
    tokens.viewRule = null;
    tokens.createRule = null;
    tokens.updateRule = null;
    tokens.deleteRule = null;
    tokens.fields.add(new Field({
      name: "revocation_reason",
      type: "text",
      required: false,
      max: 500,
    }));
    tokens.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }));
    tokens.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
    tokens.addIndex("idx_mcp_tokens_owner_created", false, "created_by,created", "");
    tokens.addIndex("idx_mcp_tokens_status", false, "revoked_at,expires_at", "");
    app.save(tokens);
  },
  (app) => {
    const tokens = app.findCollectionByNameOrId("mcp_tokens");
    tokens.listRule = "@request.auth.role = 'admin' && created_by = @request.auth.id";
    tokens.viewRule = "@request.auth.role = 'admin' && created_by = @request.auth.id";
    tokens.createRule = "@request.auth.role = 'admin' && created_by = @request.auth.id";
    tokens.updateRule = "@request.auth.role = 'admin' && created_by = @request.auth.id";
    tokens.deleteRule = "@request.auth.role = 'admin' && created_by = @request.auth.id";
    tokens.fields.removeByName("revocation_reason");
    tokens.fields.removeByName("created");
    tokens.fields.removeByName("updated");
    tokens.removeIndex("idx_mcp_tokens_owner_created");
    tokens.removeIndex("idx_mcp_tokens_status");
    app.save(tokens);
  },
);
