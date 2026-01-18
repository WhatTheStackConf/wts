/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    const users = app.findCollectionByNameOrId("users");

    // Check if role field already exists to be idempotent
    let hasRole = false;
    try {
        if (users.fields.getByName("role")) hasRole = true;
    } catch (e) { }

    if (!hasRole) {
        users.fields.add(new SelectField({
            name: "role",
            maxSelect: 1,
            values: ["user", "reviewer", "admin"]
        }));

        app.save(users);
    }
}, (app) => {
    // Revert
});
