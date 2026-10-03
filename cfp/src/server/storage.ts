import { DatabaseSync, backup as sqliteBackup } from "node:sqlite";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { migration } from "../../migrations/001-initial.ts";
import { applicantSettingsSchema, commitWitnessSchema, draftPurposeSchema, editionIdSchema, presentationSchema, speakerProfileSchema, submissionReceiptSchema } from "../lib/cfp-model.ts";

const migrations = [{ ...migration, checksum: sha256(migration.sql) }];
function sha256(bytes: string | Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function directory(dataDir?: string): string {
  const value = dataDir ?? process.env.CFP_DATA_DIR;
  if (!value) throw new Error("Set CFP_DATA_DIR before opening the CFP database.");
  const path = resolve(value);
  if (existsSync(path) && (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())) throw new Error("Use a data directory without a symbolic link.");
  return path;
}
function regularFile(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Use a regular file without a symbolic link.");
}
function connect(path: string, readOnly = false): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly, enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false });
  try {
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;");
    if (!readOnly) db.exec("PRAGMA journal_mode=WAL;");
    return db;
  } catch (error) { db.close(); throw error; }
}
const migrationRowsSchema = z.array(z.strictObject({ version: z.number().int(), name: z.string(), checksum: z.string() }));
const schemaObjectsSql = "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name<>'schema_migrations' ORDER BY name";
let supportedSchema: string | undefined;
function verifyMigrations(db: DatabaseSync, allowPending = false): void {
  const rows = migrationRowsSchema.parse(db.prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version").all());
  if (rows.length > migrations.length || (!allowPending && rows.length !== migrations.length)) throw new Error("Run the supported CFP migration before startup.");
  for (const [index, row] of rows.entries()) {
    const expected = migrations[index];
    if (!expected || row.version !== expected.version || row.name !== expected.name || row.checksum !== expected.checksum) throw new Error("The installed migration checksum does not match.");
  }
  if (db.prepare("PRAGMA user_version").get()?.user_version !== (rows.at(-1)?.version ?? 0)) throw new Error("The database schema version does not match its migrations.");
  if (!allowPending) {
    if (supportedSchema === undefined) {
      const reference = new DatabaseSync(":memory:");
      try {
        for (const item of migrations) reference.exec(item.sql);
        supportedSchema = JSON.stringify(reference.prepare(schemaObjectsSql).all());
      } finally { reference.close(); }
    }
    if (JSON.stringify(db.prepare(schemaObjectsSql).all()) !== supportedSchema) throw new Error("The database has an unsupported schema.");
  }
}
export function openCfpDatabase(dataDir?: string): DatabaseSync {
  const path = join(directory(dataDir), "cfp.sqlite");
  regularFile(path);
  const db = connect(path);
  try { verifyMigrations(db); return db; }
  catch (error) { db.close(); throw error; }
}
export function migrate(dataDir?: string): void {
  const root = directory(dataDir);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const path = join(root, "cfp.sqlite");
  if (existsSync(path)) regularFile(path);
  const db = connect(path);
  try {
    chmodSync(path, 0o600);
    db.exec("BEGIN IMMEDIATE");
    try {
      const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      if (!tables.some((row) => row.name === "schema_migrations") && tables.length) throw new Error("The database has an unsupported schema.");
      db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, installed_at INTEGER NOT NULL) STRICT");
      verifyMigrations(db, true);
      const count = db.prepare("SELECT count(*) AS count FROM schema_migrations").get()?.count;
      if (typeof count !== "number") throw new Error("The migration count is invalid.");
      for (const next of migrations.slice(count)) {
        db.exec(next.sql);
        db.prepare("INSERT INTO schema_migrations VALUES (?, ?, ?, ?)").run(next.version, next.name, next.checksum, Date.now());
        db.exec(`PRAGMA user_version=${next.version}`);
      }
      verifyMigrations(db);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  } finally { db.close(); }
}
export function initializeEdition(editionId: string, dataDir?: string): void {
  editionIdSchema.parse(editionId);
  migrate(dataDir);
  const db = openCfpDatabase(dataDir);
  try { db.prepare("INSERT INTO editions VALUES (?, 0, ?) ON CONFLICT(edition_id) DO NOTHING").run(editionId, Date.now()); }
  finally { db.close(); }
}
export function setCfpOpen(editionId: string, open: boolean, dataDir?: string): void {
  editionIdSchema.parse(editionId); z.boolean().parse(open);
  const db = openCfpDatabase(dataDir);
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = db.prepare("UPDATE editions SET cfp_open=? WHERE edition_id=?").run(Number(open), editionId);
      if (result.changes !== 1) throw new Error("Initialize the CFP edition before changing its gate.");
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  } finally { db.close(); }
}
function parseJson(value: unknown): unknown {
  if (typeof value !== "string") throw new Error("The stored JSON value is invalid.");
  return JSON.parse(value);
}
function validateDatabase(db: DatabaseSync): void {
  verifyMigrations(db);
  const integrity = db.prepare("PRAGMA integrity_check").all();
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") throw new Error("The database integrity check failed.");
  if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("The database foreign key check failed.");
  for (const row of db.prepare("SELECT value_json FROM speaker_profiles").all()) speakerProfileSchema.parse(parseJson(row.value_json));
  for (const row of db.prepare("SELECT value_json FROM applicant_settings").all()) applicantSettingsSchema.parse(parseJson(row.value_json));
  for (const row of db.prepare("SELECT presentation_json FROM applications").all()) presentationSchema.parse(parseJson(row.presentation_json));
  for (const row of db.prepare("SELECT purpose_json, presentation_json FROM drafts").all()) {
    draftPurposeSchema.parse(parseJson(row.purpose_json)); presentationSchema.parse(parseJson(row.presentation_json));
  }
  for (const row of db.prepare("SELECT r.*, d.revision AS draft_revision FROM submission_receipts r JOIN drafts d ON d.draft_id=r.draft_id").all()) {
    const witness = commitWitnessSchema.parse(parseJson(row.witness_json));
    const receipt = submissionReceiptSchema.parse(parseJson(row.receipt_json));
    if (receipt.applicationId !== row.application_id || witness.draft + 1 !== row.draft_revision) throw new Error("The submission receipt does not match its draft.");
  }
  if (db.prepare("SELECT d.draft_id FROM drafts d LEFT JOIN submission_receipts r ON r.draft_id=d.draft_id WHERE (d.state='committed' AND r.draft_id IS NULL) OR (d.state='active' AND r.draft_id IS NOT NULL)").all().length) throw new Error("The draft commit state is invalid.");
}
function durableWrite(path: string, bytes: Uint8Array): void {
  const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
function syncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
const manifestSchema = z.strictObject({ schemaVersion: z.literal(1), databaseSha256: z.string().regex(/^[a-f0-9]{64}$/) });
export async function backup(destination: string, dataDir?: string): Promise<void> {
  const target = resolve(destination);
  const db = openCfpDatabase(dataDir);
  let created = false;
  try {
    db.exec("BEGIN");
    try { validateDatabase(db); } finally { db.exec("ROLLBACK"); }
    mkdirSync(target, { mode: 0o700 }); created = true;
    const path = join(target, "cfp.sqlite");
    await sqliteBackup(db, path);
    chmodSync(path, 0o600);
    const snapshot = connect(path);
    try { validateDatabase(snapshot); snapshot.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;"); }
    finally { snapshot.close(); }
    const fd = openSync(path, constants.O_RDONLY);
    try { fsyncSync(fd); } finally { closeSync(fd); }
    durableWrite(join(target, "manifest.json"), Buffer.from(JSON.stringify({ schemaVersion: 1, databaseSha256: sha256(readFileSync(path)) })));
    syncDirectory(target); syncDirectory(dirname(target));
  } catch (error) { if (created) rmSync(target, { recursive: true }); throw error; }
  finally { db.close(); }
}
export async function restore(source: string, destination: string): Promise<void> {
  const root = directory(source);
  const target = resolve(destination);
  if (existsSync(target)) throw new Error("Restore only into a new directory.");
  const manifestPath = join(root, "manifest.json");
  regularFile(manifestPath);
  if (lstatSync(manifestPath).size > 4096) throw new Error("The backup manifest is too large.");
  const manifest = manifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
  const path = join(root, "cfp.sqlite");
  regularFile(path);
  for (const suffix of ["-wal", "-shm", "-journal"]) if (existsSync(`${path}${suffix}`)) throw new Error("Remove unverified backup sidecar files before restore.");
  const bytes = readFileSync(path);
  if (sha256(bytes) !== manifest.databaseSha256) throw new Error("The backup database checksum does not match.");
  const sourceDb = connect(path, true);
  try { validateDatabase(sourceDb); } finally { sourceDb.close(); }
  let created = false;
  try {
    mkdirSync(target, { mode: 0o700 }); created = true;
    durableWrite(join(target, "cfp.sqlite"), bytes);
    const db = openCfpDatabase(target);
    try {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec("DELETE FROM cfp_sessions; DELETE FROM oidc_flows; UPDATE editions SET cfp_open=0;");
        validateDatabase(db); db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;");
    } finally { db.close(); }
    const fd = openSync(join(target, "cfp.sqlite"), constants.O_RDONLY);
    try { fsyncSync(fd); } finally { closeSync(fd); }
    syncDirectory(target); syncDirectory(dirname(target));
  } catch (error) { if (created) rmSync(target, { recursive: true }); throw error; }
}
