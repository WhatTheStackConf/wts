/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const applicantsCollection = app.findCollectionByNameOrId("cfp_applicants");

    const collection = new Collection({
      name: "cfp_submissions",
      type: "base",
      listRule: "@request.auth.id = id || @request.auth.role = 'admin'",
      viewRule: "@request.auth.id = id || @request.auth.role = 'admin'",
      createRule: "@request.auth.id = id || @request.auth.role = 'admin'",
      updateRule: "@request.auth.id = id || @request.auth.role = 'admin'",
      deleteRule: "@request.auth.id = id || @request.auth.role = 'admin'",
      fields: [
        // <-- This MUST be 'fields'
        {
          name: "session_title",
          type: "text",
          required: true,
          unique: false,
        },
        {
          name: "abstract",
          type: "editor",
          required: true,
          unique: false,
        },
        {
          name: "key_takeaways",
          type: "editor",
          required: true,
          unique: false,
        },
        {
          name: "technical_requirements",
          type: "text",
          required: false,
          unique: false,
        },
        {
          name: "notes",
          type: "text",
          required: false,
          unique: false,
        },
        {
          name: "applicant",
          type: "relation",
          required: true,
          presentable: false,
          unique: false,
          maxSelect: 1,
          collectionId: applicantsCollection.id,
          cascadeDelete: false,
        },
      ],
    });
    return app.save(collection);
  },
  (app) => {
    // DOWN migration
    const collection = app.findCollectionByNameOrId("cfp_submissions");
    return app.delete(collection);
  },
);
