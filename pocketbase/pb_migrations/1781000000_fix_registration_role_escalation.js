/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // CRITICAL: Prevent users from self-assigning admin or reviewer roles during registration.
    // Without this rule, a malicious user can add role="admin" to the registration request body.
    const users = app.findCollectionByNameOrId("users");
    users.createRule =
      "@request.body.role:isset = false || @request.body.role = 'user'";
    app.save(users);
  },
  (app) => {
    // Revert to default (anyone can register, no role restriction)
    const users = app.findCollectionByNameOrId("users");
    users.createRule = "";
    app.save(users);
  },
);
