import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export interface CheckinPurgePolicy {
  edition: "WTS2026"; mode: "purge_only"; purgeDeadline: string;
  purgeToken: string; stationId: string; journalIdentity: string;
}
export interface CheckinPurgeReceipt {
  stationId: string; journalIdentity: string; purgeToken: string;
  method: "retired_and_compacted";
}
function stat(path: string) { try { return lstatSync(path); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; } }
function regular(path: string, directory = false) {
  const s = stat(path);
  if (!s || s.isSymbolicLink() || s.nlink > (directory ? Infinity : 1) || (directory ? !s.isDirectory() : !s.isFile())) throw new Error("Unsafe lifecycle path");
}
function safeRoot(path: string) {
  const root = resolve(path);
  for (let p = root; ; p = dirname(p)) { regular(p, true); if (dirname(p) === p) break; }
  return root;
}
function sync(path: string) { const fd = openSync(path, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }
function validPolicy(value: unknown): CheckinPurgePolicy {
  const p = value as CheckinPurgePolicy;
  if (!p || p.edition !== "WTS2026" || p.mode !== "purge_only" || !Number.isFinite(Date.parse(p.purgeDeadline)) || !/^[a-zA-Z0-9]{32,64}$/.test(p.purgeToken) || ![p.stationId, p.journalIdentity].every(v => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(v))) throw new Error("Invalid purge policy");
  return p;
}
function samePolicy(a: CheckinPurgePolicy, b: CheckinPurgePolicy) {
  return (["edition", "mode", "purgeDeadline", "purgeToken", "stationId", "journalIdentity"] as const).every(k => a[k] === b[k]);
}
function readFence(root: string): CheckinPurgePolicy | null {
  const path = join(root, "lifecycle-fence.json");
  if (!stat(path)) return null;
  regular(path); return validPolicy(JSON.parse(readFileSync(path, "utf8")));
}
function durableFence(root: string, value: CheckinPurgePolicy) {
  const temporary = join(root, "lifecycle-fence.next");
  if (stat(temporary)) { regular(temporary); unlinkSync(temporary); }
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" }); sync(temporary);
  renameSync(temporary, join(root, "lifecycle-fence.json")); sync(root);
}
/** No disk state grants active authority. A fresh authenticated server handshake
 * may grant active only when this is quarantined AND no fence exists at all.
 * Malformed fences, missing journals and identity mismatches require intervention. */
export function localLifecycleMode(root: string): "purge_only" | "quarantined" {
  try { return readFence(safeRoot(root)) ? "purge_only" : "quarantined"; } catch { return "quarantined"; }
}
/** Distinguishes fresh boot from malformed/lost authority without granting work. */
export function canRequestActiveAuthority(root: string): boolean {
  try { return !stat(join(safeRoot(root), "lifecycle-fence.json")); } catch { return false; }
}
function spoolFiles(root: string): string[] {
  const path = join(root, "spool");
  if (!stat(path)) return [];
  regular(path, true);
  return readdirSync(path).map(name => {
    // Deliberately flat allowlist; never recurse or erase an arbitrary directory.
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.(raster|png|bin)$/.test(name)) throw new Error("Unknown spool material requires explicit inventory");
    const child = join(path, name); regular(child); return child;
  });
}
function verifyJournal(path: string, policy: CheckinPurgePolicy) {
  regular(path);
  for (const suffix of ["-wal", "-shm", "-journal"]) if (stat(path + suffix)) regular(path + suffix);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const retired = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='lifecycle_retired'").get();
    if (retired) {
      const row = db.prepare("SELECT policy FROM lifecycle_retired WHERE edition='WTS2026'").get();
      if (!row || typeof row.policy !== "string" || !samePolicy(validPolicy(JSON.parse(row.policy)), policy)) throw new Error("Retired identity mismatch");
    } else {
      const row = db.prepare("SELECT data,digest FROM journal WHERE id=1").get();
      if (!row || typeof row.data !== "string" || createHash("sha256").update(row.data).digest("hex") !== row.digest) throw new Error("Journal identity unverifiable");
      const identity = JSON.parse(row.data).identity;
      if (identity?.stationId !== policy.stationId || identity?.journalIdentity !== policy.journalIdentity) throw new Error("Journal identity mismatch");
    }
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    if (tables.some(t => t.name !== "journal" && t.name !== "lifecycle_retired")) throw new Error("Unknown journal tables");
  } finally { db.close(); }
}
/** Caller MUST hold exclusive OS state/USB ownership throughout. quiesce stops
 * intake, awaits transport and closes journal. No removable lock directory is
 * used: that would deadlock after a crash. No secure flash-erasure claim. */
export async function retireCheckinJournal(options: {
  root: string; journalName: string; policy: CheckinPurgePolicy; nowMs: number;
  quiesce(): Promise<void>;
}): Promise<CheckinPurgeReceipt | null> {
  const policy = validPolicy(options.policy);
  if (!Number.isSafeInteger(options.nowMs)) throw new Error("Invalid clock");
  const root = safeRoot(options.root);
  if (basename(options.journalName) !== options.journalName || !/^[\w.-]+\.sqlite$/.test(options.journalName)) throw new Error("Unsafe journal name");
  const prior = readFence(root);
  if (prior && !samePolicy(prior, policy)) throw new Error("Purge fence mismatch");
  const path = join(root, options.journalName);
  // Verify ownership before any write, including the fence or spool deletion.
  verifyJournal(path, policy);
  spoolFiles(root); // Validate existing material before writing the closure fence.
  durableFence(root, policy);
  if (options.nowMs < Date.parse(policy.purgeDeadline)) return null;
  await options.quiesce();
  verifyJournal(path, policy);
  // An in-flight task may finish its spool while quiescence drains. Inventory
  // again only after producers have stopped, including a newly created folder.
  const files = spoolFiles(root);
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout=1000; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; PRAGMA wal_checkpoint(TRUNCATE); BEGIN IMMEDIATE; DROP TABLE IF EXISTS journal; CREATE TABLE IF NOT EXISTS lifecycle_retired (edition TEXT PRIMARY KEY, policy TEXT NOT NULL)");
    db.prepare("INSERT OR REPLACE INTO lifecycle_retired VALUES ('WTS2026', ?)").run(JSON.stringify(policy));
    db.exec("COMMIT; VACUUM; PRAGMA wal_checkpoint(TRUNCATE)");
  } finally { db.close(); }
  sync(path);
  for (const file of files) { regular(file); unlinkSync(file); }
  if (spoolFiles(root).length) throw new Error("Spool material remains after retirement");
  if (stat(join(root, "spool"))) sync(join(root, "spool"));
  sync(root);
  // Always re-run after lost receipt: restored stale data cannot hide behind it.
  return { stationId: policy.stationId, journalIdentity: policy.journalIdentity, purgeToken: policy.purgeToken, method: "retired_and_compacted" };
}
export interface FeatureBackup { file: string; edition: "WTS2026"; purgeDeadline: string }
/** Explicit manifest only. Replicas/snapshots/object versions need operator expiry. */
export function expireFeatureBackups(root: string, manifest: FeatureBackup[], nowMs: number): string[] {
  root = safeRoot(root);
  if (!Number.isSafeInteger(nowMs)) throw new Error("Invalid clock");
  const due = manifest.filter(entry => {
    if (entry.edition !== "WTS2026" || entry.file !== basename(entry.file) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.file) || !Number.isFinite(Date.parse(entry.purgeDeadline))) throw new Error("Invalid backup manifest");
    const path = join(root, entry.file); if (stat(path)) regular(path);
    return nowMs >= Date.parse(entry.purgeDeadline);
  });
  const expired = [...new Set(due.map(e => e.file))];
  for (const file of expired) if (stat(join(root, file))) unlinkSync(join(root, file));
  sync(root); return expired;
}
