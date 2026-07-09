/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const submissions = app.findCollectionByNameOrId("cfp_submissions");
    const sessions = app.findCollectionByNameOrId("sessions");

    sessions.fields.add(
      new Field({
        name: "cfp_submission",
        type: "relation",
        required: false,
        presentable: false,
        collectionId: submissions.id,
        maxSelect: 1,
        cascadeDelete: false,
      }),
    );
    sessions.addIndex(
      "idx_sessions_cfp_submission_unique",
      true,
      "cfp_submission",
      "cfp_submission != ''",
    );
    app.save(sessions);

    const speakers = app.findCollectionByNameOrId("speakers");
    speakers.addIndex(
      "idx_speakers_cfp_applicant_unique",
      true,
      "cfp_applicant",
      "cfp_applicant != ''",
    );
    app.save(speakers);
  },
  (app) => {
    const sessions = app.findCollectionByNameOrId("sessions");
    sessions.removeIndex("idx_sessions_cfp_submission_unique");
    sessions.fields.removeByName("cfp_submission");
    app.save(sessions);

    const speakers = app.findCollectionByNameOrId("speakers");
    speakers.removeIndex("idx_speakers_cfp_applicant_unique");
    app.save(speakers);
  },
);
