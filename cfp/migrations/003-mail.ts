export const migration = {
  version: 3,
  name: "mail",
  sql: `
CREATE TABLE daily_cfp_reports (
  edition_id TEXT NOT NULL REFERENCES editions(edition_id),
  report_date TEXT NOT NULL CHECK(length(report_date)=10 AND report_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  generated_at INTEGER NOT NULL CHECK(generated_at>=0),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  PRIMARY KEY(edition_id, report_date)
) STRICT;
CREATE TRIGGER daily_reports_no_update BEFORE UPDATE ON daily_cfp_reports
BEGIN SELECT RAISE(ABORT, 'Daily reports are immutable.'); END;
CREATE TRIGGER daily_reports_no_delete BEFORE DELETE ON daily_cfp_reports
BEGIN SELECT RAISE(ABORT, 'Daily reports are immutable.'); END;
CREATE TABLE cfp_mail_jobs (
  job_id TEXT PRIMARY KEY,
  logical_key TEXT NOT NULL UNIQUE,
  edition_id TEXT NOT NULL REFERENCES editions(edition_id),
  kind TEXT NOT NULL CHECK(kind IN ('submission','daily')),
  draft_id TEXT REFERENCES submission_receipts(draft_id),
  report_date TEXT,
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
  CHECK((kind='submission' AND draft_id IS NOT NULL AND report_date IS NULL) OR (kind='daily' AND draft_id IS NULL AND report_date IS NOT NULL)),
  CHECK((state='leased' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR (state<>'leased' AND lease_token IS NULL AND lease_until IS NULL)),
  CHECK((state='sent' AND sent_at IS NOT NULL) OR (state<>'sent' AND sent_at IS NULL))
) STRICT;
CREATE INDEX cfp_mail_due ON cfp_mail_jobs(state, next_attempt_at, created_at, job_id);
CREATE INDEX cfp_mail_edition ON cfp_mail_jobs(edition_id, state);
CREATE TRIGGER mail_payload_no_update BEFORE UPDATE OF job_id, logical_key, edition_id, kind, draft_id, report_date, recipient_id, payload_json, message_id, created_at ON cfp_mail_jobs
BEGIN SELECT RAISE(ABORT, 'Mail payloads are immutable.'); END;
CREATE TRIGGER mail_jobs_no_delete BEFORE DELETE ON cfp_mail_jobs
BEGIN SELECT RAISE(ABORT, 'Mail jobs are durable.'); END;
`,
};
