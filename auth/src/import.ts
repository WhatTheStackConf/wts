import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { assertInstalledIssuer } from "./migration.js";

export const snapshotSchema = z.strictObject({
  version: z.literal(1),
  source: z.strictObject({
    kind: z.literal("pocketbase"), version: z.string().regex(/^0\.\d+\.\d+$/),
    collectionId: z.string().min(1).max(128), offline: z.literal(true),
  }),
  users: z.array(z.strictObject({
    id: z.string().regex(/^[a-z0-9]{15}$/),
    email: z.email().max(254).refine((value) => value === value.trim()),
    name: z.string().max(200),
    verified: z.boolean(),
    created: z.string().min(1).refine((value) => Number.isFinite(Date.parse(value))),
    updated: z.string().min(1).refine((value) => Number.isFinite(Date.parse(value))),
    passwordHash: z.string().refine((value) => value === "" || /^\$2[aby]\$(0[4-9]|[12]\d|3[01])\$[./A-Za-z0-9]{53}$/.test(value)),
    avatar: z.string().max(1024),
    avatarUrl: z.url().nullable(),
    preferredLanguage: z.string().max(64).nullable(),
    username: z.string().max(200),
    emailVisibility: z.boolean(),
    externalAuths: z.array(z.strictObject({ provider: z.enum(["google", "github"]), providerId: z.string().min(1).max(255) })),
  })).min(1),
});
export type PocketBaseSnapshot = z.infer<typeof snapshotSchema>;

type ImportFailureCode = "missing_email" | "duplicate_normalized_email" | "missing_identity_link" | "conflicting_ownership" | "invalid_snapshot" | "source_snapshot_conflict";

export class ImportFailure extends Error {
  constructor(readonly code: ImportFailureCode, message: string) {
    super(message);
    this.name = "ImportFailure";
  }
}

function userWithoutEmail(user: unknown) {
  return typeof user === "object" && user !== null && (!("email" in user) || typeof user.email !== "string" || user.email.trim() === "");
}

function snapshotFailure(raw: unknown) {
  const users = typeof raw === "object" && raw !== null && "users" in raw ? raw.users : undefined;
  if (Array.isArray(users) && users.some(userWithoutEmail)) {
    return new ImportFailure("missing_email", "The snapshot contains a user without an email.");
  }
  return new ImportFailure("invalid_snapshot", "The PocketBase snapshot is invalid.");
}

type SourceUser = PocketBaseSnapshot["users"][number];

function claimIdentities(user: SourceUser, identities: Set<string>) {
  for (const link of user.externalAuths) {
    const key = JSON.stringify([link.provider, link.providerId]);
    if (identities.has(key)) throw new ImportFailure("conflicting_ownership", "The snapshot contains duplicate provider identities.");
    identities.add(key);
  }
}

export function parseSnapshot(raw: unknown): PocketBaseSnapshot {
  const parsed = snapshotSchema.safeParse(raw);
  if (!parsed.success) throw snapshotFailure(raw);
  const snapshot = parsed.data;
  const ids = new Set<string>();
  const emails = new Set<string>();
  const identities = new Set<string>();
  for (const user of snapshot.users) {
    const email = user.email.toLowerCase();
    if (ids.has(user.id)) throw new ImportFailure("conflicting_ownership", "The snapshot contains duplicate user IDs.");
    if (emails.has(email)) throw new ImportFailure("duplicate_normalized_email", "The snapshot contains duplicate normalized emails.");
    ids.add(user.id);
    emails.add(email);
    if (!user.passwordHash && user.externalAuths.length === 0) throw new ImportFailure("missing_identity_link", "A source user has no password or external identity.");
    if (Date.parse(user.updated) < Date.parse(user.created)) throw new Error("A source user has invalid timestamps.");
    claimIdentities(user, identities);
  }
  return snapshot;
}

type ImportContext = { client: PoolClient; issuer: string; sourceKey: string; committed: boolean };
type ImportLink = { provider: string; providerId: string };
type ImportPlan = { user: SourceUser; email: string; sourceHash: string; links: ImportLink[] };

function ownsOnlyTarget(rows: { id: string; email: string }[], id: string, email: string) {
  return rows.length === 1 && rows[0]?.id === id && rows[0].email.toLowerCase() === email;
}

async function assertSourceOwnership({ client, issuer, sourceKey, committed }: ImportContext, user: SourceUser, email: string, sourceHash: string) {
  const ledger = await client.query<{ sourceHash: string; sourceEmail: string; sourceKey: string }>(`SELECT "sourceHash", "sourceEmail", "sourceKey" FROM wts_import_user WHERE "sourceId" = $1`, [user.id]);
  const old = ledger.rows[0];
  const target = await client.query<{ id: string; email: string }>(`SELECT id, email FROM "user" WHERE id = $1 OR lower(email) = $2 FOR UPDATE`, [user.id, email]);
  if (!committed) {
    if (old || target.rowCount) throw new ImportFailure("conflicting_ownership", "A source user ID or normalized email belongs to another account.");
    return;
  }
  const ledgerMatches = old !== undefined && old.sourceKey === sourceKey && old.sourceHash === sourceHash && old.sourceEmail === email;
  if (!ledgerMatches || !ownsOnlyTarget(target.rows, user.id, email)) {
    throw new ImportFailure("conflicting_ownership", "The imported user ownership conflicts with the source snapshot.");
  }
  const mapping = await client.query(`SELECT 1 FROM wts_identity WHERE issuer = $1 AND subject = $2 AND "authUserId" = $2 AND "wtsUserId" = $2`, [issuer, user.id]);
  if (mapping.rowCount !== 1) throw new ImportFailure("missing_identity_link", "The imported identity binding conflicts with the source snapshot.");
}

async function assertLinksAvailable({ client, committed }: ImportContext, user: SourceUser, links: ImportLink[]) {
  for (const link of links) {
    const account = await client.query<{ userId: string }>(`SELECT "userId" FROM account WHERE "providerId" = $1 AND "accountId" = $2 FOR UPDATE`, [link.provider, link.providerId]);
    if (committed ? account.rows[0]?.userId !== user.id : Boolean(account.rowCount)) {
      throw new ImportFailure("conflicting_ownership", "A provider identity belongs to another account or import.");
    }
  }
}

async function planUser(context: ImportContext, user: SourceUser): Promise<ImportPlan> {
  const sourceHash = createHash("sha256").update(JSON.stringify(user)).digest("hex");
  const email = user.email.toLowerCase();
  await assertSourceOwnership(context, user, email, sourceHash);
  const links = [
    ...(user.passwordHash ? [{ provider: "credential", providerId: user.id }] : []),
    ...user.externalAuths,
  ];
  await assertLinksAvailable(context, user, links);
  return { user, email, sourceHash, links };
}

async function insertPlan(client: PoolClient, sourceKey: string, { user, email, sourceHash, links }: ImportPlan) {
  await client.query(
    `INSERT INTO "user"(id, email, name, "emailVerified", image, "preferredLanguage", username, "emailVisibility", "profileRevision", "sourceAvatar", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10,$11)`,
    [user.id, email, user.name, user.verified, user.avatarUrl, user.preferredLanguage, user.username, user.emailVisibility, user.avatar, new Date(user.created), new Date(user.updated)]);
  for (const link of links) {
    await client.query(`INSERT INTO account(id,"userId","providerId","accountId",password,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(), user.id, link.provider, link.providerId, link.provider === "credential" ? user.passwordHash : null, new Date(user.created), new Date(user.updated)]);
  }
  await client.query(`INSERT INTO wts_import_user("sourceKey", "sourceId", "sourceEmail", "sourceHash") VALUES ($1,$2,$3,$4)`, [sourceKey, user.id, email, sourceHash]);
}

function sortedUsers(snapshot: PocketBaseSnapshot) {
  return snapshot.users.map((user) => ({ ...user, externalAuths: [...user.externalAuths].sort((a, b) => a.provider.localeCompare(b.provider) || a.providerId.localeCompare(b.providerId)) })).sort((a, b) => a.id.localeCompare(b.id));
}

async function committedImport(client: PoolClient, sourceKey: string, snapshotHash: string, userCount: number) {
  const committed = await client.query<{ snapshotHash: string; userCount: number }>(`SELECT "snapshotHash", "userCount" FROM wts_import WHERE "sourceKey" = $1`, [sourceKey]);
  const previous = committed.rows[0];
  if (previous && (previous.snapshotHash !== snapshotHash || previous.userCount !== userCount)) throw new ImportFailure("source_snapshot_conflict", "The source snapshot conflicts with a committed import.");
  return previous;
}

export async function importSnapshot(pool: Pool, issuer: string, raw: unknown, dryRun: boolean) {
  const snapshot = parseSnapshot(raw);
  const users = sortedUsers(snapshot);
  const snapshotHash = createHash("sha256").update(JSON.stringify({ ...snapshot, users })).digest("hex");
  const sourceKey = `pocketbase:${snapshot.source.collectionId}`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(89730101)");
    await assertInstalledIssuer(client, issuer, "Migrate the configured issuer before importing users.");
    const previous = await committedImport(client, sourceKey, snapshotHash, users.length);
    const context = { client, issuer, sourceKey, committed: Boolean(previous) };
    const plans = [];
    for (const user of users) plans.push(await planUser(context, user));
    const externalAuths = users.reduce((count, user) => count + user.externalAuths.length, 0);
    if (previous || dryRun) {
      await client.query("ROLLBACK");
      return { status: previous ? "unchanged" : "dry_run", users: users.length, externalAuths };
    }
    await client.query(`INSERT INTO wts_import("sourceKey", "snapshotHash", "userCount") VALUES ($1,$2,$3)`, [sourceKey, snapshotHash, users.length]);
    for (const plan of plans) await insertPlan(client, sourceKey, plan);
    await client.query("COMMIT");
    return { status: "imported", users: users.length, externalAuths };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
