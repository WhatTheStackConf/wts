/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const usersCollection = app.findCollectionByNameOrId("users");

    const collection = new Collection({
      name: "cfp_applicants",
      type: "base",
      listRule: "@request.auth.id = user.id || @request.auth.role = 'admin'",
      viewRule: "@request.auth.id = user.id || @request.auth.role = 'admin'",
      createRule: "@request.auth.id != '' || @request.auth.role = 'admin'",
      updateRule: "@request.auth.id = user.id || @request.auth.role = 'admin'",
      deleteRule: "@request.auth.id = user.id || @request.auth.role = 'admin'",
      fields: [
        {
          name: "affiliation",
          type: "text",
          required: true,
          presentable: false,
          unique: false,
        },
        {
          name: "bio",
          type: "editor",
          required: true,
          presentable: false,
          unique: false,
        },
        {
          name: "social_handles",
          type: "json",
          required: false,
          presentable: false,
          unique: false,
        },
        {
          name: "user",
          type: "relation",
          required: true,
          presentable: false,
          unique: false,
          collectionId: usersCollection.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
      ],
    });
    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("cfp_applicants");
    return app.delete(collection);
  },
);
