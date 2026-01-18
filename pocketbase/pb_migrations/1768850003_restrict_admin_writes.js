/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    // 1. Restrict cfp_reviews
    try {
        const reviews = app.findCollectionByNameOrId("cfp_reviews");
        reviews.createRule = "@request.auth.role = 'reviewer'";
        reviews.updateRule = "@request.auth.role = 'reviewer' && reviewer = @request.auth.id";
        // Admit keeps delete rule or view rule
        // View rule remains: admin || reviewer owns it
        app.save(reviews);
    } catch (e) {
        console.log("Error updating cfp_reviews rules:", e);
    }

    // 2. Restrict cfp_weight_votes
    try {
        const votes = app.findCollectionByNameOrId("cfp_weight_votes");
        votes.createRule = "@request.auth.role = 'reviewer'";
        votes.updateRule = "@request.auth.role = 'reviewer' && user = @request.auth.id";
        app.save(votes);
    } catch (e) {
        console.log("Error updating cfp_weight_votes rules:", e);
    }

}, (app) => {
    // Revert allows admins again
    try {
        const reviews = app.findCollectionByNameOrId("cfp_reviews");
        reviews.createRule = "@request.auth.role = 'admin' || @request.auth.role = 'reviewer'";
        reviews.updateRule = "@request.auth.role = 'admin' || (@request.auth.role = 'reviewer' && reviewer = @request.auth.id)";
        app.save(reviews);

        const votes = app.findCollectionByNameOrId("cfp_weight_votes");
        votes.createRule = "@request.auth.role = 'admin' || @request.auth.role = 'reviewer'";
        votes.updateRule = "@request.auth.role = 'admin' || (@request.auth.role = 'reviewer' && user = @request.auth.id)";
        app.save(votes);
    } catch (_) { }
});
