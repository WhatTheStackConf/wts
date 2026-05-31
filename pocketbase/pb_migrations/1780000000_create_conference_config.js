/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const config = new Collection({
      name: "conference_config",
      type: "base",
      system: false,
      listRule: "",
      viewRule: "",
      createRule: "@request.auth.role = 'admin'",
      updateRule: "@request.auth.role = 'admin'",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        {
          name: "cfp_open",
          type: "bool",
          required: false,
        },
        {
          name: "cfp_deadline",
          type: "date",
          required: false,
        },
      ],
    });

    app.save(config);

    // Seed the singleton record
    const configCollection = app.findCollectionByNameOrId("conference_config");
    const record = new Record(configCollection, {
      cfp_open: true,
      cfp_deadline: "2026-07-30",
    });
    app.save(record);
  },
  (app) => {
    const config = app.findCollectionByNameOrId("conference_config");
    app.delete(config);
  },
);
