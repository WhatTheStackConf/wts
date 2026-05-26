/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const usersCollection = app.findCollectionByNameOrId("users");
    const applicantsCollection = app.findCollectionByNameOrId("cfp_applicants");

    const speakers = new Collection({
      name: "speakers",
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: "@request.auth.role = 'admin'",
      updateRule: "@request.auth.role = 'admin'",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        {
          name: "slug",
          type: "text",
          required: true,
          presentable: true,
          unique: true,
        },
        {
          name: "published",
          type: "bool",
          required: false,
        },
        {
          name: "origin",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["cfp", "invite"],
        },
        {
          name: "display_name",
          type: "text",
          required: false,
        },
        {
          name: "user",
          type: "relation",
          required: false,
          collectionId: usersCollection.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        {
          name: "cfp_applicant",
          type: "relation",
          required: false,
          collectionId: applicantsCollection.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        {
          name: "photo",
          type: "file",
          required: false,
          maxSelect: 1,
          maxSize: 5242880,
          mimeTypes: ["image/jpeg", "image/png", "image/webp"],
        },
        {
          name: "affiliation",
          type: "text",
          required: false,
        },
        {
          name: "bio",
          type: "editor",
          required: false,
        },
        {
          name: "social_handles",
          type: "json",
          required: false,
        },
      ],
    });

    app.save(speakers);

    const speakersCollection = app.findCollectionByNameOrId("speakers");

    const sessions = new Collection({
      name: "sessions",
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: "@request.auth.role = 'admin'",
      updateRule: "@request.auth.role = 'admin'",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        {
          name: "slug",
          type: "text",
          required: true,
          presentable: true,
          unique: true,
        },
        {
          name: "published",
          type: "bool",
          required: false,
        },
        {
          name: "title",
          type: "text",
          required: true,
        },
        {
          name: "abstract",
          type: "editor",
          required: true,
        },
        {
          name: "format",
          type: "text",
          required: false,
        },
        {
          name: "starts_at",
          type: "date",
          required: false,
        },
        {
          name: "track",
          type: "text",
          required: false,
        },
        {
          name: "room",
          type: "text",
          required: false,
        },
        {
          name: "speakers",
          type: "relation",
          required: false,
          collectionId: speakersCollection.id,
          maxSelect: 999,
          cascadeDelete: false,
        },
      ],
    });

    app.save(sessions);
  },
  (app) => {
    const sessions = app.findCollectionByNameOrId("sessions");
    app.delete(sessions);
    const speakers = app.findCollectionByNameOrId("speakers");
    app.delete(speakers);
  },
);
