/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const activities = app.findCollectionByNameOrId("gamification_activities");
    activities.fields.add(new Field({ name: "session_key", type: "text", required: false }));
    activities.fields.add(new Field({ name: "session_display_snapshot", type: "json", required: false }));
    activities.fields.add(new Field({ name: "session_meta_eligible", type: "bool", required: false }));
    app.save(activities);
  },
  (app) => {
    const activities = app.findCollectionByNameOrId("gamification_activities");
    activities.fields.removeByName("session_key");
    activities.fields.removeByName("session_display_snapshot");
    activities.fields.removeByName("session_meta_eligible");
    app.save(activities);
  },
);
