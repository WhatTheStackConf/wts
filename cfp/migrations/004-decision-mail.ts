// SQLite cannot change a CHECK constraint in place. Rebuild cfp_mail_jobs so it accepts decision mail,
// which points at one application instead of a draft or a report date.
export const migration = {
  version: 4,
  name: "decision-mail",
  sql: `
ALTER TABLE cfp_mail_jobs RENAME TO cfp_mail_jobs_v3;
CREATE TABLE cfp_mail_jobs (
  job_id TEXT PRIMARY KEY,
  logical_key TEXT NOT NULL UNIQUE,
  edition_id TEXT NOT NULL REFERENCES editions(edition_id),
  kind TEXT NOT NULL CHECK(kind IN ('submission','daily','decision')),
  draft_id TEXT REFERENCES submission_receipts(draft_id),
  report_date TEXT,
  application_id TEXT REFERENCES applications(application_id),
  recipient_id TEXT NOT NULL REFERENCES cfp_accounts(wts_user_id),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  message_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('queued','leased','retrying','sent','failed','suspended')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  next_attempt_at INTEGER NOT NULL CHECK(next_attempt_at>=0),
  lease_token TEXT,
  lease_until INTEGER,
  delivery_unknown INTEGER NOT NULL DEFAULT 0 CHECK(delivery_unknown IN (0,1)),
  last_error TEXT CHECK(last_error IN ('smtp_transient','smtp_permanent','attempts_exhausted','lease_expired','recipient_ineligible','restored')),
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  updated_at INTEGER NOT NULL CHECK(updated_at>=0),
  sent_at INTEGER,
  FOREIGN KEY(edition_id, report_date) REFERENCES daily_cfp_reports(edition_id, report_date),
  CHECK((kind='submission' AND draft_id IS NOT NULL AND report_date IS NULL AND application_id IS NULL)
    OR (kind='daily' AND draft_id IS NULL AND report_date IS NOT NULL AND application_id IS NULL)
    OR (kind='decision' AND draft_id IS NULL AND report_date IS NULL AND application_id IS NOT NULL)),
  CHECK((state='leased' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR (state<>'leased' AND lease_token IS NULL AND lease_until IS NULL)),
  CHECK((state='sent' AND sent_at IS NOT NULL) OR (state<>'sent' AND sent_at IS NULL))
) STRICT;
INSERT INTO cfp_mail_jobs(job_id,logical_key,edition_id,kind,draft_id,report_date,application_id,recipient_id,payload_json,message_id,state,attempts,next_attempt_at,lease_token,lease_until,delivery_unknown,last_error,created_at,updated_at,sent_at)
  SELECT job_id,logical_key,edition_id,kind,draft_id,report_date,NULL,recipient_id,payload_json,message_id,state,attempts,next_attempt_at,lease_token,lease_until,delivery_unknown,last_error,created_at,updated_at,sent_at FROM cfp_mail_jobs_v3;
DROP TABLE cfp_mail_jobs_v3;
CREATE INDEX cfp_mail_due ON cfp_mail_jobs(state, next_attempt_at, created_at, job_id);
CREATE INDEX cfp_mail_edition ON cfp_mail_jobs(edition_id, state);
CREATE INDEX cfp_mail_application ON cfp_mail_jobs(application_id);
CREATE TRIGGER mail_payload_no_update BEFORE UPDATE OF job_id, logical_key, edition_id, kind, draft_id, report_date, application_id, recipient_id, payload_json, message_id, created_at ON cfp_mail_jobs
BEGIN SELECT RAISE(ABORT, 'Mail payloads are immutable.'); END;
CREATE TRIGGER mail_jobs_no_delete BEFORE DELETE ON cfp_mail_jobs
BEGIN SELECT RAISE(ABORT, 'Mail jobs are durable.'); END;
`,
};
