import type { BetterAuthOptions } from "better-auth";
import type { Pool } from "pg";
import { z } from "zod";
import { isLoopback } from "./config.js";

export interface WtsProfile {
  wtsUserId: string;
  name: string;
  avatarUrl: string | null;
  preferredLanguage: string | null;
  username: string;
  emailVisibility: boolean;
  revision: number;
}

export interface IssuerSubjectIdentity {
  issuer: string;
  subject: string;
  wtsUserId: string;
  authUserId: string;
}

export const profileFields = {
  preferredLanguage: { type: "string", required: false, input: false },
  username: { type: "string", required: true, defaultValue: "", input: false },
  emailVisibility: { type: "boolean", required: true, defaultValue: false, input: false },
  profileRevision: { type: "number", required: true, defaultValue: 1, input: false },
  sourceAvatar: { type: "string", required: true, defaultValue: "", input: false, returned: false },
} satisfies NonNullable<NonNullable<BetterAuthOptions["user"]>["additionalFields"]>;

const language = z.string().max(64).refine((value) => {
  try { return new Intl.Locale(value).toString() === value; } catch { return false; }
});
const avatar = z.string().max(2048).refine((value) => {
  try {
    const url = new URL(value);
    return !url.username && !url.password && (url.protocol === "https:" || (url.protocol === "http:" && isLoopback(url.hostname)));
  } catch { return false; }
});
export const profileWrite = z.strictObject({
  name: z.string().min(1).max(200),
  avatarUrl: avatar.nullable(),
  preferredLanguage: language.nullable(),
  expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

export async function readProfile(pool: Pool, userId: string, issuer: string): Promise<WtsProfile> {
  const result = await pool.query<WtsProfile>(
    `SELECT i."wtsUserId", u.name, u.image AS "avatarUrl", u."preferredLanguage", u.username,
      u."emailVisibility", u."profileRevision" AS revision
     FROM "user" u JOIN wts_identity i ON i."authUserId" = u.id
     WHERE u.id = $1 AND i.issuer = $2 AND i.subject = u.id`,
    [userId, issuer],
  );
  const profile = result.rows[0];
  if (!profile) throw new Error("The account identity binding is missing.");
  return profile;
}

export async function writeProfile(pool: Pool, userId: string, issuer: string, input: z.infer<typeof profileWrite>): Promise<WtsProfile | null> {
  const result = await pool.query<WtsProfile>(
    `UPDATE "user" u SET name = $2, image = $3, "preferredLanguage" = $4,
       "profileRevision" = u."profileRevision" + 1, "updatedAt" = now()
     FROM wts_identity i
     WHERE u.id = $1 AND u."profileRevision" = $5 AND i."authUserId" = u.id AND i.issuer = $6 AND i.subject = u.id
     RETURNING i."wtsUserId", u.name, u.image AS "avatarUrl", u."preferredLanguage", u.username,
       u."emailVisibility", u."profileRevision" AS revision`,
    [userId, input.name, input.avatarUrl, input.preferredLanguage, input.expectedRevision, issuer],
  );
  return result.rows[0] ?? null;
}
