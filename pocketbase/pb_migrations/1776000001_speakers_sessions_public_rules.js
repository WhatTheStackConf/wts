/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const publicListView =
      "published = true || @request.auth.role = 'admin'";

    const speakers = app.findCollectionByNameOrId("speakers");
    speakers.listRule = publicListView;
    speakers.viewRule = publicListView;
    app.save(speakers);

    const sessions = app.findCollectionByNameOrId("sessions");
    sessions.listRule = publicListView;
    sessions.viewRule = publicListView;
    app.save(sessions);
  },
  (app) => {
    const speakers = app.findCollectionByNameOrId("speakers");
    speakers.listRule = "";
    speakers.viewRule = "";
    app.save(speakers);

    const sessions = app.findCollectionByNameOrId("sessions");
    sessions.listRule = "";
    sessions.viewRule = "";
    app.save(sessions);
  },
);
