/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.createRule = "@request.body.role:isset = false || @request.body.role = 'user'";
    users.updateRule =
      "@request.auth.role = 'admin' || (id = @request.auth.id && (@request.body.role:isset = false || @request.body.role = role))";
    app.save(users);

    const reviews = app.findCollectionByNameOrId("cfp_reviews");
    reviews.listRule =
      "@request.auth.role = 'admin' || (@request.auth.role = 'reviewer' && reviewer = @request.auth.id && (submission.status = 'pending' || submission.status = ''))";
    reviews.viewRule = reviews.listRule;
    reviews.createRule =
      "@request.auth.role = 'reviewer' && reviewer = @request.auth.id && (submission.status = 'pending' || submission.status = '')";
    reviews.updateRule =
      "@request.auth.role = 'reviewer' && reviewer = @request.auth.id && (submission.status = 'pending' || submission.status = '') && (@request.body.reviewer:isset = false || @request.body.reviewer = @request.auth.id) && (@request.body.submission:isset = false || @request.body.submission = submission)";
    const reviewRecords = Array.from(app.findAllRecords(reviews));
    reviewRecords.sort((a, b) =>
      b.getString("updated").localeCompare(a.getString("updated")) ||
      a.getString("id").localeCompare(b.getString("id"))
    );
    const seenReviews = new Set();
    for (const review of reviewRecords) {
      const key = `${review.getString("submission")}:${review.getString("reviewer")}`;
      if (seenReviews.has(key)) {
        app.delete(review);
      } else {
        seenReviews.add(key);
      }
    }
    reviews.addIndex(
      "idx_cfp_reviews_submission_reviewer_unique",
      true,
      "submission, reviewer",
      "",
    );
    app.save(reviews);

    const votes = app.findCollectionByNameOrId("cfp_weight_votes");
    votes.listRule =
      "@request.auth.role = 'admin' || (@request.auth.role = 'reviewer' && user = @request.auth.id)";
    votes.viewRule = votes.listRule;
    votes.createRule =
      "@request.auth.role = 'reviewer' && user = @request.auth.id";
    votes.updateRule =
      "@request.auth.role = 'reviewer' && user = @request.auth.id && (@request.body.user:isset = false || @request.body.user = @request.auth.id)";
    votes.deleteRule = null;
    app.save(votes);

    const applicants = app.findCollectionByNameOrId("cfp_applicants");
    applicants.createRule =
      "@request.auth.id != '' && user = @request.auth.id";
    applicants.updateRule =
      "@request.auth.role = 'admin' || (user = @request.auth.id && (@request.body.user:isset = false || @request.body.user = @request.auth.id))";
    app.save(applicants);

    const submissions = app.findCollectionByNameOrId("cfp_submissions");
    submissions.updateRule =
      "@request.auth.role = 'admin' || (applicant.user.id = @request.auth.id && (@request.body.applicant:isset = false || @request.body.applicant = applicant))";
    app.save(submissions);
  },
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.createRule = "@request.body.role:isset = false || @request.body.role = 'user'";
    users.updateRule =
      "@request.auth.role = 'admin' || (id = @request.auth.id && (@request.body.role:isset = false || @request.body.role = role))";
    app.save(users);

    const reviews = app.findCollectionByNameOrId("cfp_reviews");
    reviews.listRule =
      "@request.auth.role = 'admin' || (@request.auth.role = 'reviewer' && reviewer = @request.auth.id)";
    reviews.viewRule = reviews.listRule;
    reviews.createRule = "@request.auth.role = 'reviewer' && reviewer = @request.auth.id";
    reviews.updateRule = "@request.auth.role = 'reviewer' && reviewer = @request.auth.id";
    reviews.removeIndex("idx_cfp_reviews_submission_reviewer_unique");
    app.save(reviews);

    const votes = app.findCollectionByNameOrId("cfp_weight_votes");
    votes.listRule =
      "@request.auth.role = 'admin' || (@request.auth.role = 'reviewer' && user = @request.auth.id)";
    votes.viewRule = votes.listRule;
    votes.createRule = "@request.auth.role = 'reviewer' && user = @request.auth.id";
    votes.updateRule = "@request.auth.role = 'reviewer' && user = @request.auth.id";
    votes.deleteRule = "@request.auth.role = 'admin'";
    app.save(votes);

    const applicants = app.findCollectionByNameOrId("cfp_applicants");
    applicants.createRule = "@request.auth.id != '' || @request.auth.role = 'admin'";
    applicants.updateRule = "@request.auth.id = user.id || @request.auth.role = 'admin'";
    app.save(applicants);

    const submissions = app.findCollectionByNameOrId("cfp_submissions");
    submissions.updateRule = "@request.auth.id = applicant.user.id || @request.auth.role = 'admin'";
    app.save(submissions);
  },
);
