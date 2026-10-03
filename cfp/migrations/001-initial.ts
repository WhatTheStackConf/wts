export const migration = {
  version: 1,
  name: "initial",
  sql: `
CREATE TABLE editions (
  edition_id TEXT PRIMARY KEY,
  cfp_open INTEGER NOT NULL CHECK(cfp_open IN (0,1)),
  created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE cfp_accounts (
  wts_user_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE oidc_bindings (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  wts_user_id TEXT NOT NULL REFERENCES cfp_accounts(wts_user_id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(issuer, subject),
  UNIQUE(issuer, wts_user_id)
) STRICT;
CREATE TRIGGER bindings_no_update BEFORE UPDATE ON oidc_bindings
BEGIN SELECT RAISE(ABORT, 'Identity bindings are immutable.'); END;
CREATE TRIGGER bindings_no_delete BEFORE DELETE ON oidc_bindings
BEGIN SELECT RAISE(ABORT, 'Identity bindings are immutable.'); END;
CREATE TABLE oidc_flows (
  state_hash TEXT PRIMARY KEY,
  browser_binding_hash TEXT NOT NULL,
  encrypted_flow TEXT NOT NULL,
  return_path TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE TABLE cfp_sessions (
  session_hash TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  encrypted_access_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY(issuer, subject) REFERENCES oidc_bindings(issuer, subject)
) STRICT;
CREATE TABLE speaker_profiles (
  wts_user_id TEXT PRIMARY KEY REFERENCES cfp_accounts(wts_user_id),
  revision INTEGER NOT NULL CHECK(revision > 0),
  value_json TEXT NOT NULL CHECK(json_valid(value_json))
) STRICT;
CREATE TABLE applicant_settings (
  wts_user_id TEXT PRIMARY KEY REFERENCES cfp_accounts(wts_user_id),
  revision INTEGER NOT NULL CHECK(revision > 0),
  value_json TEXT NOT NULL CHECK(json_valid(value_json))
) STRICT;
CREATE TABLE applications (
  application_id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES editions(edition_id),
  wts_user_id TEXT NOT NULL REFERENCES speaker_profiles(wts_user_id),
  revision INTEGER NOT NULL CHECK(revision > 0),
  status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected')),
  presentation_json TEXT NOT NULL CHECK(json_valid(presentation_json)),
  submitted_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(edition_id, wts_user_id, application_id)
) STRICT;
CREATE TABLE drafts (
  draft_id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES editions(edition_id),
  wts_user_id TEXT NOT NULL REFERENCES speaker_profiles(wts_user_id),
  request_id TEXT NOT NULL,
  intent_json TEXT NOT NULL CHECK(json_valid(intent_json)),
  purpose_json TEXT NOT NULL CHECK(json_valid(purpose_json)),
  revision INTEGER NOT NULL CHECK(revision > 0),
  state TEXT NOT NULL CHECK(state IN ('active','committed')),
  presentation_json TEXT NOT NULL CHECK(json_valid(presentation_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(edition_id, wts_user_id, request_id),
  UNIQUE(edition_id, wts_user_id, draft_id)
) STRICT;
CREATE TABLE submission_receipts (
  draft_id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL,
  wts_user_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  witness_json TEXT NOT NULL CHECK(json_valid(witness_json)),
  receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)),
  FOREIGN KEY(edition_id, wts_user_id, draft_id) REFERENCES drafts(edition_id, wts_user_id, draft_id),
  FOREIGN KEY(edition_id, wts_user_id, application_id) REFERENCES applications(edition_id, wts_user_id, application_id)
) STRICT;
CREATE TRIGGER receipts_no_update BEFORE UPDATE ON submission_receipts
BEGIN SELECT RAISE(ABORT, 'Submission receipts are immutable.'); END;
CREATE TRIGGER receipts_no_delete BEFORE DELETE ON submission_receipts
BEGIN SELECT RAISE(ABORT, 'Submission receipts are immutable.'); END;
CREATE INDEX applications_owner ON applications(edition_id, wts_user_id, submitted_at);
CREATE INDEX drafts_owner ON drafts(edition_id, wts_user_id, state, updated_at);
`,
};
