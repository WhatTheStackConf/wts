/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const usersCollection = app.findCollectionByNameOrId("users");

    const collection = new Collection({
      name: "mcp_tokens",
      type: "base",
      listRule: "@request.auth.role = 'admin' && created_by = @request.auth.id",
      viewRule: "@request.auth.role = 'admin' && created_by = @request.auth.id",
      createRule: "@request.auth.role = 'admin' && created_by = @request.auth.id",
      updateRule: "@request.auth.role = 'admin' && created_by = @request.auth.id",
      deleteRule: "@request.auth.role = 'admin' && created_by = @request.auth.id",
      fields: [
        {
          name: "name",
          type: "text",
          required: true,
          presentable: true,
        },
        {
          name: "token_id",
          type: "text",
          required: true,
          unique: true,
        },
        {
          name: "token_prefix",
          type: "text",
          required: true,
        },
        {
          name: "secret_hash",
          type: "text",
          required: true,
        },
        {
          name: "scopes",
          type: "json",
          required: false,
        },
        {
          name: "created_by",
          type: "relation",
          required: true,
          collectionId: usersCollection.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        {
          name: "expires_at",
          type: "date",
          required: false,
        },
        {
          name: "revoked_at",
          type: "date",
          required: false,
        },
        {
          name: "revoked_by",
          type: "relation",
          required: false,
          collectionId: usersCollection.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        {
          name: "last_used_at",
          type: "date",
          required: false,
        },
      ],
    });

    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("mcp_tokens");
    app.delete(collection);
  },
);
