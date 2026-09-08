/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const role = users.fields.getByName("role");
  if (!role.values.includes("checkin_operator")) {
    role.values = role.values.concat(["checkin_operator"]);
    app.save(users);
  }
}, (app) => {
  if (app.countRecords("users", $dbx.exp("role = 'checkin_operator'"))) throw new Error("Reassign Check-in Operators before role rollback.");
  const users = app.findCollectionByNameOrId("users");
  const role = users.fields.getByName("role");
  role.values = role.values.filter((value) => value !== "checkin_operator");
  app.save(users);
});
