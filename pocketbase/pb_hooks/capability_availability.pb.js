/// <reference path="../pb_data/types.d.ts" />





onRecordsListRequest((e) => { const policy = require(__hooks + "/capability-availability.js"); if (e.collection.name === "cfp_submissions") return policy.rejectSubmissionRead(e); if (e.collection.name === "speakers") return policy.rejectUnavailableSpeakerApplicantExpansion(e); return policy.rejectUnavailable(e, "cfp"); }, "cfp_applicants", "cfp_submissions", "speakers");
onRecordViewRequest((e) => { const policy = require(__hooks + "/capability-availability.js"); if (e.collection.name === "cfp_submissions") return policy.rejectSubmissionRead(e); if (e.collection.name === "speakers") return policy.rejectUnavailableSpeakerApplicantExpansion(e); return policy.rejectUnavailable(e, "cfp"); }, "cfp_applicants", "cfp_submissions", "speakers");
onRecordCreateRequest((e) => require(__hooks + "/capability-availability.js").rejectUnavailable(e, "cfp"), "cfp_applicants", "cfp_submissions");
onRecordUpdateRequest((e) => require(__hooks + "/capability-availability.js").rejectUnavailable(e, "cfp"), "cfp_applicants", "cfp_submissions");
onRecordDeleteRequest((e) => require(__hooks + "/capability-availability.js").rejectUnavailable(e, "cfp"), "cfp_applicants", "cfp_submissions");

onRecordsListRequest((e) => require(__hooks + "/capability-availability.js").rejectUnavailable(e, "review"), "cfp_reviews", "cfp_weight_votes");
onRecordViewRequest((e) => require(__hooks + "/capability-availability.js").rejectUnavailable(e, "review"), "cfp_reviews", "cfp_weight_votes");
onRecordCreateRequest((e) => require(__hooks + "/capability-availability.js").rejectUnavailable(e, "review"), "cfp_reviews", "cfp_weight_votes");
onRecordUpdateRequest((e) => require(__hooks + "/capability-availability.js").rejectUnavailable(e, "review"), "cfp_reviews", "cfp_weight_votes");
onRecordDeleteRequest((e) => require(__hooks + "/capability-availability.js").rejectUnavailable(e, "review"), "cfp_reviews", "cfp_weight_votes");
onRecordEnrich((e) => require(__hooks + "/capability-availability.js").rejectUnavailableExpansion(e));
