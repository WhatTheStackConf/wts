import { DatabaseSync } from "node:sqlite";
import { lstat, open } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { ImportFailure, parseSnapshot } from "./import.js";
import { isLoopback } from "./config.js";

const sqliteUser = z.object({
  id: z.string(), email: z.string(), name: z.string(), verified: z.union([z.literal(0), z.literal(1)]),
  created: z.string(), updated: z.string(), passwordHash: z.string(), avatar: z.string(),
  preferredLanguage: z.string().nullable(), username: z.string(), emailVisibility: z.union([z.literal(0), z.literal(1)]),
});
const sqliteLink = z.object({ recordRef: z.string(), provider: z.enum(["google", "github"]), providerId: z.string() });

export interface PocketBaseExportOptions {
  database: string;
  output: string;
  sourceVersion: string;
  avatarBase: string | undefined;
  offlineBackup: boolean;
}

function sourceIsModern(sourceVersion: string) {
  const version = /^0\.(\d+)\.\d+$/.exec(sourceVersion);
  if (!version || !version[1]) throw new Error("Set an explicit supported PocketBase source version.");
  return Number(version[1]) >= 23;
}

async function assertPrivateDatabaseFile(databasePath: string) {
  const sourceFile = await lstat(databasePath);
  if (!sourceFile.isFile() || sourceFile.isSymbolicLink() || (sourceFile.mode & 0o077) !== 0 || sourceFile.uid !== process.getuid?.()) throw new Error("The offline backup must be a private regular database file owned by this user.");
}

async function assertNoSidecars(databasePath: string) {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try { await lstat(databasePath + suffix); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") continue; throw error; }
    throw new Error("The backup has SQLite sidecar files. Create a closed consistent backup before export.");
  }
}

function parseAvatarBase(value: string | undefined) {
  if (!value) return undefined;
  const avatarBase = new URL(value);
  if (avatarBase.username || avatarBase.password || avatarBase.hash || avatarBase.search || (avatarBase.protocol !== "https:" && !(avatarBase.protocol === "http:" && isLoopback(avatarBase.hostname)))) {
    throw new Error("The avatar base must be a public HTTPS URL or rehearsal loopback URL.");
  }
  if (!avatarBase.pathname.endsWith("/")) avatarBase.pathname += "/";
  return avatarBase;
}

function tableColumns(db: DatabaseSync, table: string) {
  return new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map((row) => z.object({ name: z.string() }).parse(row).name));
}

function requireColumns(columns: Set<string>, names: string[], message: string) {
  for (const name of names) {
    if (!columns.has(name)) throw new Error(message);
  }
}

type SourceLink = { provider: "google" | "github"; providerId: string };

function linksBySourceUser(links: z.infer<typeof sqliteLink>[]) {
  const linksByUser = new Map<string, SourceLink[]>();
  for (const link of links) {
    const entries = linksByUser.get(link.recordRef) ?? [];
    entries.push({ provider: link.provider, providerId: link.providerId });
    linksByUser.set(link.recordRef, entries);
  }
  return linksByUser;
}

function readSnapshot(db: DatabaseSync, sourceVersion: string, modern: boolean, avatarBase: URL | undefined) {
  const check = db.prepare("PRAGMA quick_check").get();
  if (!check || check.quick_check !== "ok") throw new Error("The offline backup failed its integrity check.");
  const collections = db.prepare(`SELECT id, name, type FROM _collections WHERE name = 'users'`).all();
  if (collections.length !== 1) throw new Error("The backup must contain exactly one users collection.");
  const collection = z.object({ id: z.string(), name: z.literal("users"), type: z.literal("auth") }).parse(collections[0]);
  const columns = tableColumns(db, "users");
  const passwordColumn = modern ? "password" : "_passwordHash";
  requireColumns(columns, ["id", "email", "verified", "created", "updated", passwordColumn, "emailVisibility"], "The users schema does not match the declared PocketBase version.");
  const linkColumns = tableColumns(db, "_externalAuths");
  const recordColumn = modern ? "recordRef" : "recordId";
  const collectionColumn = modern ? "collectionRef" : "collectionId";
  requireColumns(linkColumns, [recordColumn, collectionColumn, "provider", "providerId"], "The external-auth schema does not match the declared PocketBase version.");
  const links = db.prepare(`SELECT "${recordColumn}" AS "recordRef", provider, "providerId" FROM "_externalAuths" WHERE "${collectionColumn}" = ? ORDER BY "${recordColumn}", provider, "providerId"`).all(collection.id).map((row) => sqliteLink.parse(row));
  const linksByUser = linksBySourceUser(links);
  const field = (name: string, fallback: string) => columns.has(name) ? `"${name}"` : `${fallback} AS "${name}"`;
  const sourceUsers = db.prepare(`SELECT id, email, ${field("name", "''")}, verified, created, updated, "${passwordColumn}" AS "passwordHash", ${field("avatar", "''")}, ${field("preferredLanguage", "NULL")}, ${field("username", "''")}, "emailVisibility" FROM users ORDER BY id`).all().map((row) => sqliteUser.parse(row));
  const ids = new Set(sourceUsers.map((user) => user.id));
  if (links.some((link) => !ids.has(link.recordRef))) throw new ImportFailure("missing_identity_link", "An external identity has no source user.");
  const users = sourceUsers.map((user) => {
    if (user.avatar && !avatarBase) throw new Error("Set an avatar base to preserve source avatar URLs.");
    const avatarPath = [collection.id, user.id, user.avatar].map((value) => encodeURIComponent(value)).join("/");
    return {
      ...user,
      verified: user.verified === 1,
      emailVisibility: user.emailVisibility === 1,
      avatarUrl: user.avatar && avatarBase ? new URL(avatarPath, avatarBase).href : null,
      externalAuths: linksByUser.get(user.id) ?? [],
    };
  });
  return parseSnapshot({ version: 1, source: { kind: "pocketbase", version: sourceVersion, collectionId: collection.id, offline: true }, users });
}

export async function exportPocketBase(options: PocketBaseExportOptions) {
  if (!options.offlineBackup) throw new Error("Export requires an explicit offline backup declaration.");
  const modern = sourceIsModern(options.sourceVersion);
  const databasePath = resolve(options.database);
  await assertPrivateDatabaseFile(databasePath);
  await assertNoSidecars(databasePath);
  const avatarBase = parseAvatarBase(options.avatarBase);
  const db = new DatabaseSync(databasePath, { readOnly: true });
  let snapshot;
  try {
    db.exec("BEGIN");
    snapshot = readSnapshot(db, options.sourceVersion, modern, avatarBase);
    db.exec("COMMIT");
  } finally { db.close(); }
  const output = await open(resolve(options.output), "wx", 0o600);
  try { await output.writeFile(JSON.stringify(snapshot, null, 2) + "\n"); await output.sync(); }
  finally { await output.close(); }
  return { status: "exported", users: snapshot.users.length, externalAuths: snapshot.users.reduce((count, user) => count + user.externalAuths.length, 0) };
}
