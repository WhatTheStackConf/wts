export const migration = {
  version: 1,
  name: "initial",
  sql: `
CREATE TABLE editions (
  edition_id TEXT PRIMARY KEY,
  source_namespace TEXT NOT NULL,
  current_snapshot_id INTEGER REFERENCES programme_snapshots(snapshot_id),
  created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE programme_snapshots (
  snapshot_id INTEGER PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES editions(edition_id),
  revision INTEGER NOT NULL CHECK(revision > 0),
  checksum TEXT NOT NULL,
  graph_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(edition_id, revision),
  UNIQUE(edition_id, snapshot_id)
) STRICT;
CREATE TRIGGER editions_pointer_guard BEFORE UPDATE OF current_snapshot_id ON editions
WHEN NEW.current_snapshot_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM programme_snapshots WHERE snapshot_id = NEW.current_snapshot_id AND edition_id = NEW.edition_id
) BEGIN SELECT RAISE(ABORT, 'Invalid publication pointer.'); END;
CREATE TABLE publication_receipts (
  edition_id TEXT NOT NULL REFERENCES editions(edition_id),
  source_namespace TEXT NOT NULL,
  revision INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  snapshot_id INTEGER NOT NULL REFERENCES programme_snapshots(snapshot_id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(edition_id, revision)
) STRICT;
CREATE TABLE public_assets (
  asset_id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE CHECK(asset_id = sha256),
  media_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK(byte_length > 0)
) STRICT;
CREATE TABLE snapshot_assets (
  snapshot_id INTEGER NOT NULL REFERENCES programme_snapshots(snapshot_id),
  asset_id TEXT NOT NULL REFERENCES public_assets(asset_id),
  PRIMARY KEY(snapshot_id, asset_id)
) STRICT;
CREATE TRIGGER snapshots_no_update BEFORE UPDATE ON programme_snapshots
BEGIN SELECT RAISE(ABORT, 'Publications are immutable.'); END;
CREATE TRIGGER snapshots_no_delete BEFORE DELETE ON programme_snapshots
BEGIN SELECT RAISE(ABORT, 'Publications are immutable.'); END;
CREATE TRIGGER assets_no_update BEFORE UPDATE ON public_assets
BEGIN SELECT RAISE(ABORT, 'Assets are immutable.'); END;
CREATE TABLE site_accounts (
  wts_user_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE oidc_bindings (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  wts_user_id TEXT NOT NULL REFERENCES site_accounts(wts_user_id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(issuer, subject)
) STRICT;
CREATE TABLE oidc_flows (
  state_hash TEXT PRIMARY KEY,
  browser_binding_hash TEXT NOT NULL,
  encrypted_flow TEXT NOT NULL,
  return_path TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE TABLE site_sessions (
  session_hash TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  encrypted_access_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY(issuer, subject) REFERENCES oidc_bindings(issuer, subject)
) STRICT;
CREATE TABLE edition_roles (
  edition_id TEXT NOT NULL REFERENCES editions(edition_id),
  wts_user_id TEXT NOT NULL REFERENCES site_accounts(wts_user_id),
  role TEXT NOT NULL CHECK(role = 'admin'),
  granted_at INTEGER NOT NULL,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  PRIMARY KEY(edition_id, wts_user_id, role)
) STRICT;
`,
};
