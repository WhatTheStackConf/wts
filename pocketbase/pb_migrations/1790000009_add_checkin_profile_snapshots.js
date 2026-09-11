/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const workflows = app.findCollectionByNameOrId("checkin_arrival_workflows");
  workflows.fields.add(new JSONField({ name: "profile_snapshot", maxSize: 16384 }));
  app.save(workflows);
  const prints = app.findCollectionByNameOrId("checkin_print_attempts");
  prints.fields.add(new JSONField({ name: "profile_snapshot", maxSize: 16384 }));
  app.save(prints);
}, (app) => {
  const workflows = app.findCollectionByNameOrId("checkin_arrival_workflows");
  workflows.fields.removeByName("profile_snapshot");
  app.save(workflows);
  const prints = app.findCollectionByNameOrId("checkin_print_attempts");
  prints.fields.removeByName("profile_snapshot");
  app.save(prints);
});
