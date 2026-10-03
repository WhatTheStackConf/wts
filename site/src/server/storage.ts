import { DatabaseSync, backup as sqliteBackup } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, copyFileSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, chmodSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { migration } from "../../migrations/001-initial.ts";
import { assetIdSchema, editionIdSchema, emptyPublicationGraph, publicContentBatchSchema, publicationGraphSchema, referencedAssetIds, type PublicContentBatchV1, type PublicAssetInput } from "../lib/publication-schema.ts";

const migrations = [migration];
export function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b, "en")).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}
export function siteDataDirectory(dataDir?: string): string {
  const value = dataDir ?? process.env.SITE_DATA_DIR;
  if (!value) throw new Error("Set SITE_DATA_DIR before opening the site database.");
  return resolve(value);
}
function regularFile(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Use a regular file without a symbolic link.");
  return stat;
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
function verifyMigrations(db: DatabaseSync, allowPending = false): void {
  const rows = migrationRowsSchema.parse(db.prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version").all());
  if (rows.length > migrations.length || (!allowPending && rows.length !== migrations.length)) throw new Error("Run the supported site migration before startup.");
  for (const [index, row] of rows.entries()) {
    const expected = migrations[index];
    if (!expected || row.version !== expected.version || row.name !== expected.name || row.checksum !== sha256(expected.sql)) throw new Error("The installed migration checksum does not match.");
  }
  const version = db.prepare("PRAGMA user_version").get()?.user_version;
  if (version !== (rows.at(-1)?.version ?? 0)) throw new Error("The database schema version does not match its migrations.");
}
export function openSiteDatabase(dataDir?: string): DatabaseSync {
  const path = join(siteDataDirectory(dataDir), "site.sqlite");
  regularFile(path);
  const db = connect(path);
  try { verifyMigrations(db); return db; }
  catch (error) { db.close(); throw error; }
}
export function migrate(dataDir?: string): void {
  const directory = siteDataDirectory(dataDir);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (lstatSync(directory).isSymbolicLink()) throw new Error("Use a data directory without a symbolic link.");
  const path = join(directory, "site.sqlite");
  if (existsSync(path)) regularFile(path);
  const db = connect(path);
  chmodSync(path, 0o600);
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      const installed = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      if (!installed.some((row) => row.name === "schema_migrations") && installed.length) throw new Error("The database has an unsupported schema.");
      db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, installed_at INTEGER NOT NULL) STRICT");
      verifyMigrations(db, true);
      const count = db.prepare("SELECT count(*) AS count FROM schema_migrations").get()?.count;
      if (typeof count !== "number") throw new Error("The migration count is invalid.");
      for (const next of migrations.slice(count)) {
        db.exec(next.sql);
        db.prepare("INSERT INTO schema_migrations VALUES (?, ?, ?, ?)").run(next.version, next.name, sha256(next.sql), Date.now());
        db.exec(`PRAGMA user_version=${next.version}`);
      }
      verifyMigrations(db);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  } finally { db.close(); }
}
const assetRowSchema = z.strictObject({ asset_id: assetIdSchema, sha256: assetIdSchema, media_type: publicContentBatchSchema.shape.assets.element.shape.mediaType, byte_length: z.number().int().positive() });
function publicationChecksum(batch: Pick<PublicContentBatchV1, "editionId" | "sourceNamespace" | "revision" | "assets">, graphJson: string): string {
  return sha256(canonicalJson({ schemaVersion: 1, editionId: batch.editionId, sourceNamespace: batch.sourceNamespace, revision: batch.revision, graphChecksum: sha256(graphJson), assets: batch.assets.map(({ file: _file, ...asset }) => asset).sort((a, b) => a.id.localeCompare(b.id)) }));
}
function durableWrite(path: string, bytes: Uint8Array, mode = 0o600): void {
  const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, mode);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
function syncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function validateAssetBytes(bytes: Uint8Array, asset: Pick<PublicAssetInput, "sha256" | "byteLength">): void {
  if (bytes.byteLength !== asset.byteLength || sha256(bytes) !== asset.sha256) throw new Error("The asset bytes do not match their checksum and length.");
}
function installAsset(directory: string, asset: PublicAssetInput, bytes: Uint8Array): void {
  const assetsDirectory = join(directory, "assets");
  mkdirSync(assetsDirectory, { recursive: true, mode: 0o700 });
  if (lstatSync(assetsDirectory).isSymbolicLink()) throw new Error("Use an asset directory without a symbolic link.");
  const target = join(assetsDirectory, asset.id);
  if (existsSync(target)) { regularFile(target); validateAssetBytes(readFileSync(target), asset); return; }
  const temporary = join(assetsDirectory, `.install-${randomUUID()}`);
  durableWrite(temporary, bytes, 0o444);
  try {
    try { linkSync(temporary, target); }
    catch (error) {
      if (!existsSync(target)) throw error;
      regularFile(target); validateAssetBytes(readFileSync(target), asset);
    }
    syncDirectory(assetsDirectory);
  } finally { rmSync(temporary); }
}
export interface ImportResult { editionId: string; revision: number; checksum: string; status: "published" | "unchanged" }
const editionRowSchema = z.strictObject({ source_namespace: z.string(), revision: z.number().int().nonnegative() });
function publish(db: DatabaseSync, batch: PublicContentBatchV1): ImportResult {
  const graphJson = canonicalJson(batch.graph);
  const checksum = publicationChecksum(batch, graphJson);
  db.exec("BEGIN IMMEDIATE");
  try {
    const edition = editionRowSchema.parse(db.prepare("SELECT e.source_namespace, COALESCE(s.revision, 0) AS revision FROM editions e LEFT JOIN programme_snapshots s ON s.snapshot_id=e.current_snapshot_id WHERE e.edition_id=?").get(batch.editionId));
    if (edition.source_namespace !== batch.sourceNamespace) throw new Error("The publication source does not own this edition.");
    const receipt = db.prepare("SELECT checksum FROM publication_receipts WHERE edition_id=? AND revision=?").get(batch.editionId, batch.revision);
    if (receipt) {
      if (receipt.checksum !== checksum) throw new Error("The publication revision has different content.");
      db.exec("COMMIT");
      return { editionId: batch.editionId, revision: batch.revision, checksum, status: "unchanged" };
    }
    if (edition.revision !== batch.expectedRevision || batch.revision <= edition.revision) throw new Error("The publication revision is stale.");
    for (const asset of batch.assets) {
      const existing = db.prepare("SELECT * FROM public_assets WHERE asset_id=?").get(asset.id);
      if (existing) {
        const row = assetRowSchema.parse(existing);
        if (row.sha256 !== asset.sha256 || row.media_type !== asset.mediaType || row.byte_length !== asset.byteLength) throw new Error("The registered asset metadata conflicts.");
      } else db.prepare("INSERT INTO public_assets VALUES (?, ?, ?, ?)").run(asset.id, asset.sha256, asset.mediaType, asset.byteLength);
    }
    const now = Date.now();
    const inserted = db.prepare("INSERT INTO programme_snapshots (edition_id, revision, checksum, graph_json, created_at) VALUES (?, ?, ?, ?, ?)").run(batch.editionId, batch.revision, checksum, graphJson, now);
    const snapshotId = inserted.lastInsertRowid;
    for (const asset of batch.assets) db.prepare("INSERT INTO snapshot_assets VALUES (?, ?)").run(snapshotId, asset.id);
    db.prepare("INSERT INTO publication_receipts VALUES (?, ?, ?, ?, ?, ?)").run(batch.editionId, batch.sourceNamespace, batch.revision, checksum, snapshotId, now);
    db.prepare("UPDATE editions SET current_snapshot_id=? WHERE edition_id=?").run(snapshotId, batch.editionId);
    db.exec("COMMIT");
    return { editionId: batch.editionId, revision: batch.revision, checksum, status: "published" };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
export function importLocalBundle(bundleFile: string, dataDir?: string): ImportResult {
  const bundleStat = regularFile(resolve(bundleFile));
  if (bundleStat.size > 16 * 1024 * 1024) throw new Error("Keep the public bundle within 16 MiB.");
  const bundlePath = realpathSync(resolve(bundleFile));
  const batch = publicContentBatchSchema.parse(JSON.parse(readFileSync(bundlePath, "utf8")));
  const root = dirname(bundlePath);
  const directory = siteDataDirectory(dataDir);
  const db = openSiteDatabase(directory);
  try {
    for (const asset of batch.assets) {
      if (isAbsolute(asset.file)) throw new Error("Use asset paths relative to the bundle directory.");
      const path = realpathSync(resolve(root, asset.file));
      const child = relative(root, path);
      if (!child || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new Error("Keep bundle assets inside the bundle directory.");
      regularFile(path);
      const bytes = readFileSync(path);
      validateAssetBytes(bytes, asset);
      installAsset(directory, asset, bytes);
    }
    return publish(db, batch);
  } finally { db.close(); }
}
export function initializeEdition(editionId: string, sourceNamespace: string, dataDir?: string): ImportResult {
  const batch = publicContentBatchSchema.parse({ schemaVersion: 1, editionId, sourceNamespace, revision: 1, expectedRevision: 0, graph: emptyPublicationGraph(), assets: [] });
  migrate(dataDir);
  const db = openSiteDatabase(dataDir);
  try {
    db.prepare("INSERT INTO editions (edition_id, source_namespace, created_at) VALUES (?, ?, ?) ON CONFLICT(edition_id) DO NOTHING").run(editionId, sourceNamespace, Date.now());
    return publish(db, batch);
  } finally { db.close(); }
}
export function setEditionRole(editionId: string, wtsUserId: string, enabled: boolean, dataDir?: string): void {
  editionIdSchema.parse(editionId);
  z.string().min(1).max(200).parse(wtsUserId);
  const db = openSiteDatabase(dataDir);
  try {
    db.prepare("INSERT INTO edition_roles VALUES (?, ?, 'admin', ?, ?) ON CONFLICT(edition_id, wts_user_id, role) DO UPDATE SET enabled=excluded.enabled, granted_at=CASE WHEN edition_roles.enabled=0 AND excluded.enabled=1 THEN excluded.granted_at ELSE edition_roles.granted_at END").run(editionId, wtsUserId, Date.now(), Number(enabled));
  } finally { db.close(); }
}
const snapshotRowSchema = z.strictObject({ snapshot_id: z.number().int(), edition_id: editionIdSchema, revision: z.number().int().positive(), checksum: assetIdSchema, graph_json: z.string(), source_namespace: z.string() });
function validateDatabase(db: DatabaseSync, directory: string): void {
  verifyMigrations(db);
  const integrity = db.prepare("PRAGMA integrity_check").all();
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") throw new Error("The database integrity check failed.");
  if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("The database foreign key check failed.");
  if (db.prepare("SELECT e.edition_id FROM editions e LEFT JOIN programme_snapshots s ON s.snapshot_id=e.current_snapshot_id WHERE s.snapshot_id IS NULL OR s.edition_id<>e.edition_id OR s.revision<>(SELECT MAX(latest.revision) FROM programme_snapshots latest WHERE latest.edition_id=e.edition_id)").all().length) throw new Error("An edition publication pointer is invalid.");
  const snapshots = z.array(snapshotRowSchema).parse(db.prepare("SELECT s.snapshot_id, s.edition_id, s.revision, s.checksum, s.graph_json, e.source_namespace FROM programme_snapshots s JOIN editions e ON e.edition_id=s.edition_id").all());
  for (const row of snapshots) {
    const graph = publicationGraphSchema.parse(JSON.parse(row.graph_json));
    const registered = z.array(assetRowSchema).parse(db.prepare("SELECT a.* FROM public_assets a JOIN snapshot_assets sa ON sa.asset_id=a.asset_id WHERE sa.snapshot_id=? ORDER BY a.asset_id").all(row.snapshot_id));
    const refs = referencedAssetIds(graph);
    if (registered.length !== refs.size || registered.some((asset) => !refs.has(asset.asset_id))) throw new Error("The publication asset references do not match.");
    const assets = registered.map((asset) => ({ id: asset.asset_id, sha256: asset.sha256, mediaType: asset.media_type, byteLength: asset.byte_length, file: asset.asset_id }));
    if (publicationChecksum({ editionId: row.edition_id, sourceNamespace: row.source_namespace, revision: row.revision, assets }, canonicalJson(graph)) !== row.checksum) throw new Error("The publication checksum does not match.");
    const receipt = db.prepare("SELECT checksum, source_namespace, snapshot_id FROM publication_receipts WHERE edition_id=? AND revision=?").get(row.edition_id, row.revision);
    if (!receipt || receipt.checksum !== row.checksum || receipt.source_namespace !== row.source_namespace || receipt.snapshot_id !== row.snapshot_id) throw new Error("The publication receipt does not match.");
  }
  if (db.prepare("SELECT r.edition_id FROM publication_receipts r JOIN programme_snapshots s ON s.snapshot_id=r.snapshot_id WHERE r.edition_id<>s.edition_id OR r.revision<>s.revision OR r.checksum<>s.checksum").all().length) throw new Error("The publication receipt graph is invalid.");
  const assetsDirectory = join(directory, "assets");
  if (existsSync(assetsDirectory) && lstatSync(assetsDirectory).isSymbolicLink()) throw new Error("Use an asset directory without a symbolic link.");
  for (const asset of z.array(assetRowSchema).parse(db.prepare("SELECT DISTINCT a.* FROM public_assets a JOIN snapshot_assets sa ON sa.asset_id=a.asset_id").all())) {
    const path = join(directory, "assets", asset.asset_id);
    regularFile(path);
    validateAssetBytes(readFileSync(path), { sha256: asset.sha256, byteLength: asset.byte_length });
  }
}
const backupManifestSchema = z.strictObject({ schemaVersion: z.literal(1), databaseSha256: assetIdSchema, assets: z.array(z.strictObject({ id: assetIdSchema, sha256: assetIdSchema, byteLength: z.number().int().positive(), mediaType: publicContentBatchSchema.shape.assets.element.shape.mediaType })) });
export async function backup(destination: string, dataDir?: string): Promise<void> {
  const source = siteDataDirectory(dataDir);
  const target = resolve(destination);
  const db = openSiteDatabase(source);
  let created = false;
  try {
    db.exec("BEGIN");
    try { validateDatabase(db, source); } finally { db.exec("ROLLBACK"); }
    mkdirSync(target, { mode: 0o700 }); created = true;
    await sqliteBackup(db, join(target, "site.sqlite"));
    chmodSync(join(target, "site.sqlite"), 0o600);
    const snapshot = connect(join(target, "site.sqlite"));
    let assets: z.infer<typeof backupManifestSchema>["assets"];
    try {
      verifyMigrations(snapshot);
      assets = z.array(assetRowSchema).parse(snapshot.prepare("SELECT DISTINCT a.* FROM public_assets a JOIN snapshot_assets sa ON sa.asset_id=a.asset_id ORDER BY a.asset_id").all()).map((asset) => ({ id: asset.asset_id, sha256: asset.sha256, byteLength: asset.byte_length, mediaType: asset.media_type }));
      mkdirSync(join(target, "assets"), { mode: 0o700 });
      for (const asset of assets) {
        const path = join(source, "assets", asset.id);
        regularFile(path);
        const bytes = readFileSync(path);
        validateAssetBytes(bytes, asset);
        durableWrite(join(target, "assets", asset.id), bytes, 0o444);
      }
      validateDatabase(snapshot, target);
      snapshot.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;");
    } finally { snapshot.close(); }
    durableWrite(join(target, "manifest.json"), Buffer.from(canonicalJson({ schemaVersion: 1, databaseSha256: sha256(readFileSync(join(target, "site.sqlite"))), assets })));
    const fd = openSync(join(target, "site.sqlite"), constants.O_RDONLY);
    try { fsyncSync(fd); } finally { closeSync(fd); }
    syncDirectory(join(target, "assets")); syncDirectory(target); syncDirectory(dirname(target));
  } catch (error) { if (created) rmSync(target, { recursive: true }); throw error; }
  finally { db.close(); }
}
export function restore(backupDirectory: string, destination: string): void {
  const source = resolve(backupDirectory);
  const target = resolve(destination);
  regularFile(join(source, "manifest.json")); regularFile(join(source, "site.sqlite"));
  if (existsSync(join(source, "site.sqlite-wal")) || existsSync(join(source, "site.sqlite-shm"))) throw new Error("Use a complete backup without SQLite sidecar files.");
  const manifest = backupManifestSchema.parse(JSON.parse(readFileSync(join(source, "manifest.json"), "utf8")));
  if (sha256(readFileSync(join(source, "site.sqlite"))) !== manifest.databaseSha256) throw new Error("The backup database checksum does not match.");
  const sourceDb = connect(join(source, "site.sqlite"), true);
  try {
    validateDatabase(sourceDb, source);
    const assets = z.array(assetRowSchema).parse(sourceDb.prepare("SELECT DISTINCT a.* FROM public_assets a JOIN snapshot_assets sa ON sa.asset_id=a.asset_id ORDER BY a.asset_id").all()).map((asset) => ({ id: asset.asset_id, sha256: asset.sha256, byteLength: asset.byte_length, mediaType: asset.media_type }));
    if (canonicalJson(assets) !== canonicalJson(manifest.assets)) throw new Error("The backup asset manifest does not match.");
    mkdirSync(target, { mode: 0o700 });
    try {
      copyFileSync(join(source, "site.sqlite"), join(target, "site.sqlite"), constants.COPYFILE_EXCL);
      chmodSync(join(target, "site.sqlite"), 0o600);
      if (sha256(readFileSync(join(target, "site.sqlite"))) !== manifest.databaseSha256) throw new Error("The copied backup database checksum does not match.");
      mkdirSync(join(target, "assets"), { mode: 0o700 });
      for (const asset of assets) {
        const bytes = readFileSync(join(source, "assets", asset.id));
        validateAssetBytes(bytes, asset);
        durableWrite(join(target, "assets", asset.id), bytes, 0o444);
      }
      const restored = connect(join(target, "site.sqlite"));
      try {
        restored.exec("BEGIN IMMEDIATE");
        try { restored.exec("DELETE FROM site_sessions; DELETE FROM oidc_flows; UPDATE edition_roles SET enabled=0; COMMIT;"); }
        catch (error) { restored.exec("ROLLBACK"); throw error; }
        validateDatabase(restored, target);
        restored.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      } finally { restored.close(); }
      syncDirectory(join(target, "assets")); syncDirectory(target); syncDirectory(dirname(target));
    } catch (error) { rmSync(target, { recursive: true }); throw error; }
  } finally { sourceDb.close(); }
}
