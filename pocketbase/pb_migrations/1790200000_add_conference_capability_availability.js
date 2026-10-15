/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const config = app.findCollectionByNameOrId("conference_config");
    config.fields.add(new JSONField({
      name: "availability",
      required: false,
      maxSize: 1024,
    }));
    config.createRule = null;
    config.updateRule = null;
    config.deleteRule = null;
    app.save(config);
  },
  (app) => {
    const config = app.findCollectionByNameOrId("conference_config");
    config.fields.removeByName("availability");
    config.createRule = "@request.auth.role = 'admin'";
    config.updateRule = "@request.auth.role = 'admin'";
    config.deleteRule = "@request.auth.role = 'admin'";
    app.save(config);
  },
);
