import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import { schemaVersion } from "./migration.js";

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

export function parseSnapshot(raw: unknown): PocketBaseSnapshot {
  const parsed = snapshotSchema.safeParse(raw);
  if (!parsed.success) {
    const users = typeof raw === "object" && raw !== null && "users" in raw ? raw.users : undefined;
    if (Array.isArray(users) && users.some((user: unknown) => typeof user === "object" && user !== null && (!("email" in user) || typeof user.email !== "string" || user.email.trim() === ""))) {
      throw new ImportFailure("missing_email", "The snapshot contains a user without an email.");
    }
    throw new ImportFailure("invalid_snapshot", "The PocketBase snapshot is invalid.");
  }
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
    for (const link of user.externalAuths) {
      const key = JSON.stringify([link.provider, link.providerId]);
      if (identities.has(key)) throw new ImportFailure("conflicting_ownership", "The snapshot contains duplicate provider identities.");
      identities.add(key);
    }
  }
  return snapshot;
}

export async function importSnapshot(pool: Pool, issuer: string, raw: unknown, dryRun: boolean) {
  const snapshot = parseSnapshot(raw);
  const users = snapshot.users.map((user) => ({ ...user, externalAuths: [...user.externalAuths].sort((a, b) => a.provider.localeCompare(b.provider) || a.providerId.localeCompare(b.providerId)) })).sort((a, b) => a.id.localeCompare(b.id));
  const snapshotHash = createHash("sha256").update(JSON.stringify({ ...snapshot, users })).digest("hex");
  const sourceKey = `pocketbase:${snapshot.source.collectionId}`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(89730101)");
    const instance = await client.query<{ issuer: string; schemaVersion: number }>(`SELECT issuer, "schemaVersion" FROM wts_instance WHERE singleton = true`);
    if (instance.rows[0]?.issuer !== issuer || instance.rows[0]?.schemaVersion !== schemaVersion) throw new Error("Migrate the configured issuer before importing users.");
    const committed = await client.query<{ snapshotHash: string; userCount: number }>(`SELECT "snapshotHash", "userCount" FROM wts_import WHERE "sourceKey" = $1`, [sourceKey]);
    const previous = committed.rows[0];
    if (previous && (previous.snapshotHash !== snapshotHash || previous.userCount !== users.length)) throw new ImportFailure("source_snapshot_conflict", "The source snapshot conflicts with a committed import.");
    const plans = [];
    for (const user of users) {
      const sourceHash = createHash("sha256").update(JSON.stringify(user)).digest("hex");
      const ledger = await client.query<{ sourceHash: string; sourceEmail: string; sourceKey: string }>(`SELECT "sourceHash", "sourceEmail", "sourceKey" FROM wts_import_user WHERE "sourceId" = $1`, [user.id]);
      const old = ledger.rows[0];
      const email = user.email.toLowerCase();
      const target = await client.query<{ id: string; email: string }>(`SELECT id, email FROM "user" WHERE id = $1 OR lower(email) = $2 FOR UPDATE`, [user.id, email]);
      if (previous) {
        if (!old || old.sourceKey !== sourceKey || old.sourceHash !== sourceHash || old.sourceEmail !== email || target.rows.length !== 1 || target.rows[0]?.id !== user.id || target.rows[0].email.toLowerCase() !== email) {
          throw new ImportFailure("conflicting_ownership", "The imported user ownership conflicts with the source snapshot.");
        }
        const mapping = await client.query(`SELECT 1 FROM wts_identity WHERE issuer = $1 AND subject = $2 AND "authUserId" = $2 AND "wtsUserId" = $2`, [issuer, user.id]);
        if (mapping.rowCount !== 1) throw new ImportFailure("missing_identity_link", "The imported identity binding conflicts with the source snapshot.");
      } else if (old || target.rowCount) {
        throw new ImportFailure("conflicting_ownership", "A source user ID or normalized email belongs to another account.");
      }
      const links = [
        ...(user.passwordHash ? [{ provider: "credential", providerId: user.id }] : []),
        ...user.externalAuths,
      ];
      for (const link of links) {
        const account = await client.query<{ userId: string }>(`SELECT "userId" FROM account WHERE "providerId" = $1 AND "accountId" = $2 FOR UPDATE`, [link.provider, link.providerId]);
        if (previous ? account.rows[0]?.userId !== user.id : Boolean(account.rowCount)) {
          throw new ImportFailure("conflicting_ownership", "A provider identity belongs to another account or import.");
        }
      }
      plans.push({ user, email, sourceHash, links });
    }
    const externalAuths = users.reduce((count, user) => count + user.externalAuths.length, 0);
    if (previous || dryRun) {
      await client.query("ROLLBACK");
      return { status: previous ? "unchanged" : "dry_run", users: users.length, externalAuths };
    }
    await client.query(`INSERT INTO wts_import("sourceKey", "snapshotHash", "userCount") VALUES ($1,$2,$3)`, [sourceKey, snapshotHash, users.length]);
    for (const { user, email, sourceHash, links } of plans) {
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
    await client.query("COMMIT");
    return { status: "imported", users: users.length, externalAuths };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
