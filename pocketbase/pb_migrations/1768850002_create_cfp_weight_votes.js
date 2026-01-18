/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    const usersCollection = app.findCollectionByNameOrId("users");

    const collection = new Collection({
        name: "cfp_weight_votes",
        type: "base",
        listRule: "@request.auth.role = 'admin' || @request.auth.role = 'reviewer'",
        viewRule: "@request.auth.role = 'admin' || @request.auth.role = 'reviewer'",
        createRule: "@request.auth.role = 'admin' || @request.auth.role = 'reviewer'",
        updateRule: "@request.auth.role = 'admin' || (@request.auth.role = 'reviewer' && user = @request.auth.id)",
        deleteRule: "@request.auth.role = 'admin'",
        indexes: [
            "CREATE UNIQUE INDEX idx_weight_vote_user ON cfp_weight_votes (user)"
        ],
        fields: [
            {
                name: "user",
                type: "relation",
                required: true,
                collectionId: usersCollection.id,
                maxSelect: 1,
                cascadeDelete: false,
            },
            {
                name: "relevance",
                type: "number",
                options: { min: 1, max: 6, noDecimal: true }
            },
            {
                name: "originality",
                type: "number",
                options: { min: 1, max: 6, noDecimal: true }
            },
            {
                name: "depth",
                type: "number",
                options: { min: 1, max: 6, noDecimal: true }
            },
            {
                name: "clarity",
                type: "number",
                options: { min: 1, max: 6, noDecimal: true }
            },
            {
                name: "takeaways",
                type: "number",
                options: { min: 1, max: 6, noDecimal: true }
            },
            {
                name: "engagement",
                type: "number",
                options: { min: 1, max: 6, noDecimal: true }
            }
        ],
    });

    app.save(collection);

}, (app) => {
    const collection = app.findCollectionByNameOrId("cfp_weight_votes");
    app.delete(collection);
});
