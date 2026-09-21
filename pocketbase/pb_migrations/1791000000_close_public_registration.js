/// <reference path="../pb_data/types.d.ts" />

// WTS 2026 has ended. A locked create rule denies both password registration
// and OAuth first-time account creation, without disabling existing-user auth.
migrate((app) => {
    const users = app.findCollectionByNameOrId("users");
    users.createRule = null;
    app.save(users);
}, (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.createRule = '@request.body.role:isset = false || @request.body.role = "user"';
    app.save(users);
});
