/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    // Prevent self-service role escalation on users auth collection
    try {
        const users = app.findCollectionByNameOrId("users");
        // PB 0.23+: @request.body — block self-service role changes (admins use superuser in app)
        users.updateRule =
            "@request.auth.role = 'admin' || (id = @request.auth.id && (@request.body.role:isset = false || @request.body.role = role))";
        app.save(users);
    } catch (e) {
        console.log("Error updating users updateRule:", e);
    }

    // cfp_reviews: reviewer must own the review on create
    try {
        const reviews = app.findCollectionByNameOrId("cfp_reviews");
        reviews.createRule =
            "@request.auth.role = 'reviewer' && reviewer = @request.auth.id";
        app.save(reviews);
    } catch (e) {
        console.log("Error updating cfp_reviews rules:", e);
    }

    // cfp_weight_votes: ownership on create; reviewers see only their vote
    try {
        const votes = app.findCollectionByNameOrId("cfp_weight_votes");
        votes.createRule =
            "@request.auth.role = 'reviewer' && user = @request.auth.id";
        votes.listRule =
            "@request.auth.role = 'admin' || (@request.auth.role = 'reviewer' && user = @request.auth.id)";
        votes.viewRule =
            "@request.auth.role = 'admin' || (@request.auth.role = 'reviewer' && user = @request.auth.id)";
        app.save(votes);
    } catch (e) {
        console.log("Error updating cfp_weight_votes rules:", e);
    }
}, (app) => {
    try {
        const users = app.findCollectionByNameOrId("users");
        users.updateRule = "id = @request.auth.id || @request.auth.role = 'admin'";
        app.save(users);
    } catch (_) { }

    try {
        const reviews = app.findCollectionByNameOrId("cfp_reviews");
        reviews.createRule = "@request.auth.role = 'reviewer'";
        app.save(reviews);
    } catch (_) { }

    try {
        const votes = app.findCollectionByNameOrId("cfp_weight_votes");
        votes.createRule = "@request.auth.role = 'reviewer'";
        votes.listRule =
            "@request.auth.role = 'admin' || @request.auth.role = 'reviewer'";
        votes.viewRule =
            "@request.auth.role = 'admin' || @request.auth.role = 'reviewer'";
        app.save(votes);
    } catch (_) { }
});
