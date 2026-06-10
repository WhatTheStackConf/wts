/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const publicListView = "published = true || @request.auth.role = 'admin'";

    const partners = new Collection({
      name: "partners",
      type: "base",
      listRule: publicListView,
      viewRule: publicListView,
      createRule: "@request.auth.role = 'admin'",
      updateRule: "@request.auth.role = 'admin'",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        {
          name: "name",
          type: "text",
          required: true,
          presentable: true,
        },
        {
          name: "published",
          type: "bool",
          required: false,
        },
        {
          name: "type",
          type: "select",
          required: true,
          maxSelect: 1,
          values: [
            "organizer",
            "sponsor",
            "supporter",
            "media",
            "catering",
            "other",
            "company_supporter",
          ],
        },
        {
          name: "tier",
          type: "select",
          required: false,
          maxSelect: 1,
          values: ["platinum", "gold", "silver", "bronze"],
        },
        {
          name: "logo",
          type: "file",
          required: true,
          maxSelect: 1,
          maxSize: 5242880,
          mimeTypes: [
            "image/svg+xml",
            "image/png",
            "image/jpeg",
            "image/webp",
            "image/avif",
          ],
        },
        {
          name: "url",
          type: "text",
          required: false,
        },
        {
          name: "description",
          type: "editor",
          required: false,
        },
      ],
    });

    app.save(partners);
  },
  (app) => {
    const partners = app.findCollectionByNameOrId("partners");
    app.delete(partners);
  },
);
