/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    try {
        const users = app.findCollectionByNameOrId("users");
        users.updateRule =
            "@request.auth.role = 'admin' || (id = @request.auth.id && (@request.body.role:isset = false || @request.body.role = role))";
        app.save(users);
    } catch (e) {
        console.log("Error fixing users updateRule:", e);
    }
}, (app) => {
    try {
        const users = app.findCollectionByNameOrId("users");
        users.updateRule = "id = @request.auth.id || @request.auth.role = 'admin'";
        app.save(users);
    } catch (_) { }
});
