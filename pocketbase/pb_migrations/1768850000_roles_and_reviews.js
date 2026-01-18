/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    // 1. Update 'users' collection to add 'role'
    try {
        const users = app.findCollectionByNameOrId("users");

        // Check if role field exists
        const existingRole = users.fields.getByName("role");
        // Note: in newer PB JS, fields is a list or registry. 
        // Safest way is to try/catch or checks. 
        // logic: we just add it to the fields array if we are reconstructing, 
        // but for 'update' we might use a different approach.
        // Actually, standard way is just to modify the schema and save.

        // However, simplified approach in JS migrations usually just adds to the declaration.
        // Let's check fields existence by name.

        let hasRole = false;
        try {
            if (users.fields.getByName("role")) hasRole = true;
        } catch (e) { }

        if (!hasRole) {
            users.fields.add({
                name: "role",
                type: "select",
                options: {
                    maxSelect: 1,
                    values: ["user", "reviewer", "admin"]
                }
            });
            app.save(users);
        }
    } catch (e) {
        console.log("Users updated warning:", e);
    }

    // 2. Create 'cfp_reviews' collection
    // Check if exists first to avoid error
    try {
        app.findCollectionByNameOrId("cfp_reviews");
        // if found, we skip creation to be safe, or we could delete and recreate? 
        // Better to assume if it exists, we skip.
    } catch (e) {
        // Not found, so create it
        const usersCollection = app.findCollectionByNameOrId("users");
        const submissionsCollection = app.findCollectionByNameOrId("cfp_submissions");

        const collection = new Collection({
            name: "cfp_reviews",
            type: "base",
            listRule: "@request.auth.role = 'admin' || (@request.auth.role = 'reviewer' && reviewer = @request.auth.id)",
            viewRule: "@request.auth.role = 'admin' || (@request.auth.role = 'reviewer' && reviewer = @request.auth.id)",
            createRule: "@request.auth.role = 'admin' || @request.auth.role = 'reviewer'",
            updateRule: "@request.auth.role = 'admin' || (@request.auth.role = 'reviewer' && reviewer = @request.auth.id)",
            deleteRule: "@request.auth.role = 'admin'",
            fields: [
                {
                    name: "submission",
                    type: "relation",
                    required: true,
                    collectionId: submissionsCollection.id,
                    maxSelect: 1,
                    cascadeDelete: false,
                },
                {
                    name: "reviewer",
                    type: "relation",
                    required: true,
                    collectionId: usersCollection.id,
                    maxSelect: 1,
                    cascadeDelete: false,
                },
                {
                    name: "score_relevance",
                    type: "number",
                    options: { min: 0, max: 5, noDecimal: true }
                },
                {
                    name: "score_originality",
                    type: "number",
                    options: { min: 0, max: 5, noDecimal: true }
                },
                {
                    name: "score_depth",
                    type: "number",
                    options: { min: 0, max: 5, noDecimal: true }
                },
                {
                    name: "score_clarity",
                    type: "number",
                    options: { min: 0, max: 5, noDecimal: true }
                },
                {
                    name: "score_takeaways",
                    type: "number",
                    options: { min: 0, max: 5, noDecimal: true }
                },
                {
                    name: "score_engagement",
                    type: "number",
                    options: { min: 0, max: 5, noDecimal: true }
                },
                {
                    name: "notes",
                    type: "text"
                },
                {
                    name: "is_llm_suspected",
                    type: "bool"
                }
            ],
        });

        app.save(collection);
    }

}, (app) => {
    // Revert
    try {
        const collection = app.findCollectionByNameOrId("cfp_reviews");
        app.delete(collection);
    } catch (_) { }

    // Reverting user role field is risky if data exists, skipping for safety or doing manually.
});
