import { DatabaseSync, backup as sqliteBackup } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { migration as initialMigration } from "../../migrations/001-initial.ts";
import { migration as staffMigration } from "../../migrations/002-staff.ts";
import { migration as mailMigration } from "../../migrations/003-mail.ts";
import { applicantSettingsSchema, commitWitnessSchema, draftPurposeSchema, editionIdSchema, idSchema, presentationSchema, speakerProfileSchema, submissionReceiptSchema } from "../lib/cfp-model.ts";
import { changeActorSchema, criterionWeightsSchema, dailyReportPolicySchema, editionStaffGrantSchema, proposalAssignmentSchema, proposalDecisionSchema, reviewScoresSchema, staffCommandResultSchemas, staffCommandSchema, wtsUserIdSchema } from "../lib/staff-model.ts";
import { suspendMailForRestore, validateMailDatabase } from "../lib/mail-model.ts";

const migrations = [initialMigration, staffMigration, mailMigration].map((item) => ({ ...item, checksum: sha256(item.sql) }));
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
const supportedSchemas: Record<number, string> = {};
function verifyMigrations(db: DatabaseSync, allowPending = false, expectedVersion = migrations.length): number {
  const metadataSql = z.string().parse(db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='schema_migrations'").get()?.sql);
  if (metadataSql.replace(/IF\s+NOT\s+EXISTS\s+/i, "").replace(/\s+/g, "").toLowerCase() !== "createtableschema_migrations(versionintegerprimarykey,nametextnotnull,checksumtextnotnull,installed_atintegernotnull)strict") throw new Error("The migration metadata has an unsupported schema.");
  const rows = migrationRowsSchema.parse(db.prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version").all());
  if (rows.length > migrations.length || (!allowPending && rows.length !== expectedVersion)) throw new Error("Run the supported CFP migration before startup.");
  for (const [index, row] of rows.entries()) {
    const expected = migrations[index];
    if (!expected || row.version !== expected.version || row.name !== expected.name || row.checksum !== expected.checksum) throw new Error("The installed migration checksum does not match.");
  }
  const version = rows.at(-1)?.version ?? 0;
  if (db.prepare("PRAGMA user_version").get()?.user_version !== version) throw new Error("The database schema version does not match its migrations.");
  if (supportedSchemas[version] === undefined) {
    const reference = new DatabaseSync(":memory:");
    try {
      for (const item of migrations.slice(0, version)) reference.exec(item.sql);
      supportedSchemas[version] = JSON.stringify(reference.prepare(schemaObjectsSql).all());
    } finally { reference.close(); }
  }
  if (JSON.stringify(db.prepare(schemaObjectsSql).all()) !== supportedSchemas[version]) throw new Error("The database has an unsupported schema.");
  return version;
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
      validateDatabase(db);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  } finally { db.close(); }
}
export function initializeEdition(editionId: string, dataDir?: string): void {
  editionIdSchema.parse(editionId);
  migrate(dataDir);
  const db = openCfpDatabase(dataDir);
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      const now = Date.now();
      db.prepare("INSERT INTO editions VALUES (?, 0, ?) ON CONFLICT(edition_id) DO NOTHING").run(editionId, now);
      db.prepare("INSERT INTO edition_review_policy VALUES (?,1,1,0,0,0,'UTC','08:00',NULL,?,?) ON CONFLICT(edition_id) DO NOTHING").run(editionId, JSON.stringify({ kind: "maintenance" }), now);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  } finally { db.close(); }
}
export function setCfpOpen(editionId: string, open: boolean, dataDir?: string): void {
  editionIdSchema.parse(editionId); z.boolean().parse(open);
  const db = openCfpDatabase(dataDir);
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = db.prepare("SELECT cfp_open FROM editions WHERE edition_id=?").get(editionId);
      if (!current) throw new Error("Initialize the CFP edition before changing its gate.");
      if ((current.cfp_open === 1) !== open) {
        db.prepare("UPDATE editions SET cfp_open=? WHERE edition_id=?").run(Number(open), editionId);
        db.prepare("UPDATE edition_review_policy SET cfp_gate_revision=cfp_gate_revision+1 WHERE edition_id=?").run(editionId);
      }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  } finally { db.close(); }
}
function parseJson(value: unknown): unknown {
  if (typeof value !== "string") throw new Error("The stored JSON value is invalid.");
  return JSON.parse(value);
}
function validateDatabase(db: DatabaseSync, version = migrations.length): void {
  verifyMigrations(db, false, version);
  const integrity = db.prepare("PRAGMA integrity_check").all();
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") throw new Error("The database integrity check failed.");
  if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("The database foreign key check failed.");
  for (const row of db.prepare("SELECT value_json FROM speaker_profiles").all()) speakerProfileSchema.parse(parseJson(row.value_json));
  for (const row of db.prepare("SELECT value_json FROM applicant_settings").all()) applicantSettingsSchema.parse(parseJson(row.value_json));
  for (const row of db.prepare("SELECT presentation_json FROM applications").all()) presentationSchema.parse(parseJson(row.presentation_json));
  for (const row of db.prepare("SELECT purpose_json, presentation_json FROM drafts").all()) {
    draftPurposeSchema.parse(parseJson(row.purpose_json)); presentationSchema.parse(parseJson(row.presentation_json));
  }
  for (const row of db.prepare("SELECT r.*, d.revision AS draft_revision, d.purpose_json FROM submission_receipts r JOIN drafts d ON d.draft_id=r.draft_id").all()) {
    const witness = commitWitnessSchema.parse(parseJson(row.witness_json));
    const receipt = submissionReceiptSchema.parse(parseJson(row.receipt_json));
    if (receipt.applicationId !== row.application_id || witness.draft + 1 !== row.draft_revision) throw new Error("The submission receipt does not match its draft.");
    const purpose = draftPurposeSchema.parse(parseJson(row.purpose_json));
    if (purpose.kind === "edit" ? receipt.operation !== "updated" || receipt.applicationId !== purpose.targetId || receipt.applicationRevision !== purpose.targetRevision + 1 : receipt.operation !== "created" || receipt.applicationRevision !== 1) throw new Error("The submission receipt does not match its purpose.");
  }
  if (db.prepare("SELECT d.draft_id FROM drafts d LEFT JOIN submission_receipts r ON r.draft_id=d.draft_id WHERE (d.state='committed' AND r.draft_id IS NULL) OR (d.state='active' AND r.draft_id IS NOT NULL)").all().length) throw new Error("The draft commit state is invalid.");
  if (version >= 2) validateStaffDatabase(db);
  if (version >= 3) validateMailDatabase(db);
}
function validateStaffDatabase(db: DatabaseSync): void {
  const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
  for (const row of db.prepare("SELECT edition_id FROM editions").all()) editionIdSchema.parse(row.edition_id);
  for (const row of db.prepare("SELECT wts_user_id FROM cfp_accounts").all()) wtsUserIdSchema.parse(row.wts_user_id);
  if (db.prepare("SELECT edition_id FROM editions EXCEPT SELECT edition_id FROM edition_review_policy").all().length) throw new Error("An edition has no review policy.");
  for (const row of db.prepare("SELECT * FROM edition_review_policy").all()) {
    editionIdSchema.parse(row.edition_id);
    integer.positive().parse(row.revision); integer.positive().parse(row.cfp_gate_revision); integer.parse(row.weighting_revision);
    dailyReportPolicySchema.parse({ enabled: row.daily_report_enabled === 1, timeZone: row.report_time_zone, localSendTime: row.report_local_send_time });
    changeActorSchema.parse(parseJson(row.changed_by_json)); integer.parse(row.changed_at);
    if (row.report_start_date !== null) {
      const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(row.report_start_date);
      if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("The report start date is invalid.");
    }
    if (row.daily_report_enabled === 1 && row.report_start_date === null) throw new Error("The report start date is missing.");
  }
  for (const table of ["edition_staff_grants", "staff_grant_changes"]) {
    for (const row of db.prepare(`SELECT * FROM ${table}`).all()) {
      editionStaffGrantSchema.parse({ editionId: row.edition_id, wtsUserId: row.wts_user_id, role: row.role, revision: row.revision, state: row.state, changedBy: parseJson(row.changed_by_json), changedAt: row.changed_at });
      if (table === "staff_grant_changes") idSchema.parse(row.change_id);
    }
  }
  if (db.prepare("SELECT g.wts_user_id FROM edition_staff_grants g LEFT JOIN staff_grant_changes c ON c.edition_id=g.edition_id AND c.wts_user_id=g.wts_user_id AND c.role=g.role AND c.revision=g.revision WHERE c.change_id IS NULL OR c.state<>g.state OR c.changed_by_json<>g.changed_by_json OR c.changed_at<>g.changed_at").all().length) throw new Error("The current grant has no matching grant change.");
  for (const row of db.prepare("SELECT v.*,r.receipt_json,d.presentation_json AS draft_presentation,d.state AS draft_state FROM application_presentation_versions v JOIN submission_receipts r ON r.draft_id=v.source_draft_id JOIN drafts d ON d.draft_id=v.source_draft_id").all()) {
    editionIdSchema.parse(row.edition_id); idSchema.parse(row.application_id); idSchema.parse(row.source_draft_id);
    const receipt = submissionReceiptSchema.parse(parseJson(row.receipt_json));
    const committed = presentationSchema.parse(parseJson(row.presentation_json)); const draft = presentationSchema.parse(parseJson(row.draft_presentation));
    if (receipt.applicationId !== row.application_id || receipt.applicationRevision !== row.presentation_revision || receipt.committedAt !== row.submitted_at || row.draft_state !== "committed" || JSON.stringify(committed) !== JSON.stringify(draft)) throw new Error("The committed presentation does not match its receipt.");
    if (row.submission_email !== null) z.email().max(320).parse(row.submission_email);
  }
  if (db.prepare("SELECT r.draft_id FROM submission_receipts r LEFT JOIN application_presentation_versions v ON v.source_draft_id=r.draft_id WHERE v.source_draft_id IS NULL OR v.edition_id<>r.edition_id OR v.application_id<>r.application_id").all().length) throw new Error("A submission has no matching presentation version.");
  for (const row of db.prepare("SELECT a.*,st.current_presentation_revision,st.assessment_revision,v.presentation_json AS version_presentation,(SELECT max(v2.presentation_revision) FROM application_presentation_versions v2 WHERE v2.edition_id=a.edition_id AND v2.application_id=a.application_id) AS latest_version FROM applications a LEFT JOIN proposal_staff_state st ON st.edition_id=a.edition_id AND st.application_id=a.application_id LEFT JOIN application_presentation_versions v ON v.edition_id=st.edition_id AND v.application_id=st.application_id AND v.presentation_revision=st.current_presentation_revision").all()) {
    idSchema.parse(row.application_id); integer.parse(row.assessment_revision);
    const revision = integer.positive().parse(row.current_presentation_revision);
    if (revision !== row.latest_version || revision > integer.positive().parse(row.revision) || JSON.stringify(presentationSchema.parse(parseJson(row.presentation_json))) !== JSON.stringify(presentationSchema.parse(parseJson(row.version_presentation)))) throw new Error("The current presentation pointer is inconsistent.");
  }
  for (const row of db.prepare("SELECT p.*,a.wts_user_id AS applicant_id FROM proposal_assignments p JOIN applications a ON a.edition_id=p.edition_id AND a.application_id=p.application_id").all()) {
    proposalAssignmentSchema.parse({ editionId: row.edition_id, applicationId: row.application_id, reviewerId: row.reviewer_id, revision: row.revision, state: row.state, changedBy: parseJson(row.changed_by_json), changedAt: row.changed_at });
    if (row.reviewer_id === row.applicant_id) throw new Error("A reviewer cannot review their own proposal.");
    if (row.state === "active" && !db.prepare("SELECT 1 AS present FROM edition_staff_grants WHERE edition_id=? AND wts_user_id=? AND role='reviewer' AND state='active'").get(row.edition_id, row.reviewer_id)) throw new Error("An active assignment requires an active reviewer grant.");
  }
  for (const row of db.prepare("SELECT * FROM proposal_reviews").all()) {
    editionIdSchema.parse(row.edition_id); idSchema.parse(row.application_id); wtsUserIdSchema.parse(row.reviewer_id);
    integer.positive().parse(row.revision); integer.positive().parse(row.presentation_revision); integer.parse(row.created_at); integer.parse(row.updated_at);
    reviewScoresSchema.parse({ relevance: row.relevance, originality: row.originality, depth: row.depth, clarity: row.clarity, takeaways: row.takeaways, engagement: row.engagement });
    z.string().max(10000).parse(row.notes);
    if (z.number().parse(row.updated_at) < z.number().parse(row.created_at)) throw new Error("The review timestamps are inconsistent.");
  }
  for (const row of db.prepare("SELECT * FROM criterion_weight_votes").all()) {
    editionIdSchema.parse(row.edition_id); wtsUserIdSchema.parse(row.reviewer_id); integer.positive().parse(row.revision); integer.parse(row.updated_at);
    criterionWeightsSchema.parse({ relevance: row.relevance, originality: row.originality, depth: row.depth, clarity: row.clarity, takeaways: row.takeaways, engagement: row.engagement });
  }
  for (const row of db.prepare("SELECT * FROM proposal_decisions").all()) {
    const decision = proposalDecisionSchema.parse(parseJson(row.decision_json));
    if (decision.decisionId !== row.decision_id || decision.editionId !== row.edition_id || decision.applicationId !== row.application_id || decision.requestId !== row.request_id || decision.presentationRevision !== row.presentation_revision || decision.decidedAt !== row.decided_at || decision.applicationRevisionAfter !== decision.applicationRevisionBefore + 1 || decision.previousStatus === decision.status) throw new Error("The decision snapshot is inconsistent.");
    if (!db.prepare("SELECT 1 AS present FROM application_presentation_versions WHERE edition_id=? AND application_id=? AND presentation_revision=?").get(decision.editionId, decision.applicationId, decision.presentationRevision)) throw new Error("The decision presentation is missing.");
    if (!db.prepare("SELECT 1 AS present FROM cfp_accounts WHERE wts_user_id=?").get(decision.decidedBy)) throw new Error("The decision actor is missing.");
  }
  for (const row of db.prepare("SELECT * FROM staff_command_receipts").all()) {
    editionIdSchema.parse(row.edition_id); wtsUserIdSchema.parse(row.actor_user_id); integer.parse(row.committed_at);
    const command = staffCommandSchema.parse(parseJson(row.intent_json));
    if (command.requestId !== row.request_id || command.kind !== row.kind || sha256(z.string().parse(row.intent_json)) !== row.fingerprint) throw new Error("The staff command receipt is inconsistent.");
    staffCommandResultSchemas[command.kind].parse(parseJson(row.result_json));
  }
}
function durableWrite(path: string, bytes: Uint8Array): void {
  const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
function syncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
const manifestSchema = z.strictObject({ schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]), databaseSha256: z.string().regex(/^[a-f0-9]{64}$/) });
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
    durableWrite(join(target, "manifest.json"), Buffer.from(JSON.stringify({ schemaVersion: 3, databaseSha256: sha256(readFileSync(path)) })));
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
  try { validateDatabase(sourceDb, manifest.schemaVersion); } finally { sourceDb.close(); }
  let created = false;
  try {
    mkdirSync(target, { mode: 0o700 }); created = true;
    durableWrite(join(target, "cfp.sqlite"), bytes);
    migrate(target);
    const db = openCfpDatabase(target);
    try {
      db.exec("BEGIN IMMEDIATE");
      try {
        const now = Date.now();
        db.exec("DELETE FROM cfp_sessions; DELETE FROM oidc_flows;");
        db.prepare("UPDATE edition_review_policy SET cfp_gate_revision=cfp_gate_revision+1 WHERE edition_id IN (SELECT edition_id FROM editions WHERE cfp_open=1)").run();
        db.exec("UPDATE editions SET cfp_open=0;");
        const actor = JSON.stringify({ kind: "maintenance" });
        db.prepare("UPDATE edition_review_policy SET review_open=0,daily_report_enabled=0,revision=revision+1,changed_by_json=?,changed_at=? WHERE review_open=1 OR daily_report_enabled=1").run(actor, now);
        for (const row of db.prepare("SELECT * FROM edition_staff_grants WHERE state='active'").all()) {
          db.prepare("UPDATE edition_staff_grants SET state='disabled_restore',revision=revision+1,changed_by_json=?,changed_at=? WHERE edition_id=? AND wts_user_id=? AND role=?").run(actor, now, row.edition_id, row.wts_user_id, row.role);
          db.prepare("INSERT INTO staff_grant_changes VALUES (?,?,?,?,?,'disabled_restore',?,?)").run(randomUUID(), row.edition_id, row.wts_user_id, row.role, z.number().parse(row.revision) + 1, actor, now);
        }
        db.prepare("UPDATE proposal_assignments SET state='disabled_restore',revision=revision+1,changed_by_json=?,changed_at=? WHERE state='active'").run(actor, now);
        suspendMailForRestore(db, now);
        validateDatabase(db); db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;");
    } finally { db.close(); }
    const fd = openSync(join(target, "cfp.sqlite"), constants.O_RDONLY);
    try { fsyncSync(fd); } finally { closeSync(fd); }
    syncDirectory(target); syncDirectory(dirname(target));
  } catch (error) { if (created) rmSync(target, { recursive: true }); throw error; }
}
