export const migration = {
  version: 2,
  name: "staff",
  sql: `
CREATE UNIQUE INDEX applications_edition_id ON applications(edition_id, application_id);
CREATE TABLE edition_staff_grants (
 edition_id TEXT NOT NULL REFERENCES editions(edition_id), wts_user_id TEXT NOT NULL REFERENCES cfp_accounts(wts_user_id),
 role TEXT NOT NULL CHECK(role IN ('admin','reviewer')), revision INTEGER NOT NULL CHECK(revision>0),
 state TEXT NOT NULL CHECK(state IN ('active','revoked','disabled_restore')), changed_by_json TEXT NOT NULL CHECK(json_valid(changed_by_json)), changed_at INTEGER NOT NULL,
 PRIMARY KEY(edition_id,wts_user_id,role)
) STRICT;
CREATE INDEX staff_grants_active ON edition_staff_grants(edition_id,role,state);
CREATE TABLE staff_grant_changes (
 change_id TEXT PRIMARY KEY, edition_id TEXT NOT NULL REFERENCES editions(edition_id), wts_user_id TEXT NOT NULL REFERENCES cfp_accounts(wts_user_id),
 role TEXT NOT NULL CHECK(role IN ('admin','reviewer')), revision INTEGER NOT NULL CHECK(revision>0),
 state TEXT NOT NULL CHECK(state IN ('active','revoked','disabled_restore')), changed_by_json TEXT NOT NULL CHECK(json_valid(changed_by_json)), changed_at INTEGER NOT NULL,
 UNIQUE(edition_id,wts_user_id,role,revision)
) STRICT;
CREATE TRIGGER grant_changes_no_update BEFORE UPDATE ON staff_grant_changes BEGIN SELECT RAISE(ABORT,'Grant changes are immutable.'); END;
CREATE TRIGGER grant_changes_no_delete BEFORE DELETE ON staff_grant_changes BEGIN SELECT RAISE(ABORT,'Grant changes are immutable.'); END;
CREATE TABLE edition_review_policy (
 edition_id TEXT PRIMARY KEY REFERENCES editions(edition_id), revision INTEGER NOT NULL CHECK(revision>0),
 cfp_gate_revision INTEGER NOT NULL CHECK(cfp_gate_revision>0), weighting_revision INTEGER NOT NULL CHECK(weighting_revision>=0),
 review_open INTEGER NOT NULL CHECK(review_open IN (0,1)), daily_report_enabled INTEGER NOT NULL CHECK(daily_report_enabled IN (0,1)),
 report_time_zone TEXT NOT NULL CHECK(report_time_zone='UTC'), report_local_send_time TEXT NOT NULL CHECK(length(report_local_send_time)=5 AND report_local_send_time GLOB '[0-2][0-9]:[0-5][0-9]' AND substr(report_local_send_time,1,2)<='23'),
 report_start_date TEXT, changed_by_json TEXT NOT NULL CHECK(json_valid(changed_by_json)), changed_at INTEGER NOT NULL
) STRICT;
INSERT INTO edition_review_policy SELECT edition_id,1,1,0,0,0,'UTC','08:00',NULL,'{"kind":"maintenance"}',created_at FROM editions;
CREATE TABLE application_presentation_versions (
 edition_id TEXT NOT NULL REFERENCES editions(edition_id), application_id TEXT NOT NULL, presentation_revision INTEGER NOT NULL CHECK(presentation_revision>0),
 presentation_json TEXT NOT NULL CHECK(json_valid(presentation_json)), source_draft_id TEXT NOT NULL UNIQUE REFERENCES submission_receipts(draft_id), submitted_at INTEGER NOT NULL,
 submission_email TEXT, PRIMARY KEY(edition_id,application_id,presentation_revision),
 FOREIGN KEY(edition_id,application_id) REFERENCES applications(edition_id,application_id)
) STRICT;
INSERT INTO application_presentation_versions
 SELECT r.edition_id,r.application_id,json_extract(r.receipt_json,'$.applicationRevision'),d.presentation_json,r.draft_id,json_extract(r.receipt_json,'$.committedAt'),NULL
 FROM submission_receipts r JOIN drafts d ON d.draft_id=r.draft_id AND d.edition_id=r.edition_id AND d.wts_user_id=r.wts_user_id WHERE d.state='committed';
CREATE TRIGGER presentations_no_update BEFORE UPDATE ON application_presentation_versions BEGIN SELECT RAISE(ABORT,'Presentation versions are immutable.'); END;
CREATE TRIGGER presentations_no_delete BEFORE DELETE ON application_presentation_versions BEGIN SELECT RAISE(ABORT,'Presentation versions are immutable.'); END;
CREATE TABLE proposal_staff_state (
 edition_id TEXT NOT NULL REFERENCES editions(edition_id), application_id TEXT NOT NULL, current_presentation_revision INTEGER NOT NULL CHECK(current_presentation_revision>0), assessment_revision INTEGER NOT NULL CHECK(assessment_revision>=0),
 PRIMARY KEY(edition_id,application_id), FOREIGN KEY(edition_id,application_id,current_presentation_revision) REFERENCES application_presentation_versions(edition_id,application_id,presentation_revision)
) STRICT;
INSERT INTO proposal_staff_state SELECT a.edition_id,a.application_id,(SELECT max(v.presentation_revision) FROM application_presentation_versions v WHERE v.edition_id=a.edition_id AND v.application_id=a.application_id),0 FROM applications a;
CREATE TABLE proposal_assignments (
 edition_id TEXT NOT NULL REFERENCES editions(edition_id), application_id TEXT NOT NULL, reviewer_id TEXT NOT NULL REFERENCES cfp_accounts(wts_user_id), revision INTEGER NOT NULL CHECK(revision>0),
 state TEXT NOT NULL CHECK(state IN ('active','revoked','disabled_restore')), changed_by_json TEXT NOT NULL CHECK(json_valid(changed_by_json)), changed_at INTEGER NOT NULL,
 PRIMARY KEY(edition_id,application_id,reviewer_id), FOREIGN KEY(edition_id,application_id) REFERENCES applications(edition_id,application_id)
) STRICT;
CREATE INDEX assignments_reviewer ON proposal_assignments(edition_id,reviewer_id,state,application_id);
CREATE TABLE proposal_reviews (
 edition_id TEXT NOT NULL REFERENCES editions(edition_id), application_id TEXT NOT NULL, reviewer_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), presentation_revision INTEGER NOT NULL CHECK(presentation_revision>0),
 relevance INTEGER NOT NULL CHECK(relevance BETWEEN 1 AND 5), originality INTEGER NOT NULL CHECK(originality BETWEEN 1 AND 5), depth INTEGER NOT NULL CHECK(depth BETWEEN 1 AND 5), clarity INTEGER NOT NULL CHECK(clarity BETWEEN 1 AND 5), takeaways INTEGER NOT NULL CHECK(takeaways BETWEEN 1 AND 5), engagement INTEGER NOT NULL CHECK(engagement BETWEEN 1 AND 5),
 notes TEXT NOT NULL CHECK(length(notes)<=10000), suspected_ai INTEGER NOT NULL CHECK(suspected_ai IN (0,1)), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(edition_id,application_id,reviewer_id), FOREIGN KEY(edition_id,application_id,presentation_revision) REFERENCES application_presentation_versions(edition_id,application_id,presentation_revision), FOREIGN KEY(edition_id,application_id,reviewer_id) REFERENCES proposal_assignments(edition_id,application_id,reviewer_id)
) STRICT;
CREATE INDEX reviews_presentation ON proposal_reviews(edition_id,application_id,presentation_revision);
CREATE TABLE criterion_weight_votes (
 edition_id TEXT NOT NULL REFERENCES editions(edition_id), reviewer_id TEXT NOT NULL REFERENCES cfp_accounts(wts_user_id), revision INTEGER NOT NULL CHECK(revision>0),
 relevance INTEGER NOT NULL CHECK(relevance BETWEEN 1 AND 6), originality INTEGER NOT NULL CHECK(originality BETWEEN 1 AND 6), depth INTEGER NOT NULL CHECK(depth BETWEEN 1 AND 6), clarity INTEGER NOT NULL CHECK(clarity BETWEEN 1 AND 6), takeaways INTEGER NOT NULL CHECK(takeaways BETWEEN 1 AND 6), engagement INTEGER NOT NULL CHECK(engagement BETWEEN 1 AND 6), updated_at INTEGER NOT NULL,
 PRIMARY KEY(edition_id,reviewer_id)
) STRICT;
CREATE TABLE proposal_decisions (
 decision_id TEXT PRIMARY KEY, edition_id TEXT NOT NULL REFERENCES editions(edition_id), application_id TEXT NOT NULL, request_id TEXT NOT NULL,
 presentation_revision INTEGER NOT NULL CHECK(presentation_revision>0), decision_json TEXT NOT NULL CHECK(json_valid(decision_json)), decided_at INTEGER NOT NULL,
 FOREIGN KEY(edition_id,application_id) REFERENCES applications(edition_id,application_id), FOREIGN KEY(edition_id,application_id,presentation_revision) REFERENCES application_presentation_versions(edition_id,application_id,presentation_revision), UNIQUE(edition_id,request_id,application_id)
) STRICT;
CREATE INDEX decisions_application ON proposal_decisions(edition_id,application_id,decided_at);
CREATE TRIGGER decisions_no_update BEFORE UPDATE ON proposal_decisions BEGIN SELECT RAISE(ABORT,'Decisions are immutable.'); END;
CREATE TRIGGER decisions_no_delete BEFORE DELETE ON proposal_decisions BEGIN SELECT RAISE(ABORT,'Decisions are immutable.'); END;
CREATE TABLE staff_command_receipts (
 edition_id TEXT NOT NULL REFERENCES editions(edition_id), actor_user_id TEXT NOT NULL REFERENCES cfp_accounts(wts_user_id), request_id TEXT NOT NULL, kind TEXT NOT NULL,
 fingerprint TEXT NOT NULL, intent_json TEXT NOT NULL CHECK(json_valid(intent_json)), result_json TEXT NOT NULL CHECK(json_valid(result_json)), committed_at INTEGER NOT NULL,
 PRIMARY KEY(edition_id,actor_user_id,request_id)
) STRICT;
CREATE TRIGGER staff_receipts_no_update BEFORE UPDATE ON staff_command_receipts BEGIN SELECT RAISE(ABORT,'Staff receipts are immutable.'); END;
CREATE TRIGGER staff_receipts_no_delete BEFORE DELETE ON staff_command_receipts BEGIN SELECT RAISE(ABORT,'Staff receipts are immutable.'); END;
`,
};
