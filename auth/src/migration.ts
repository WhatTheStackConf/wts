import { readFile, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import type { Config } from "./config.js";
import { isLoopback } from "./config.js";
import { hashClientSecret, oauthScopes } from "./auth.js";

export const schemaVersion = 2;
const migrationsDirectory = new URL("../migrations/", import.meta.url);
const manifestSchema = z.strictObject({
  version: z.literal(1),
  clientId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,127}$/),
  name: z.string().min(1).max(200),
  redirectUris: z.array(z.string().url()).min(1).max(20),
  scopes: z.array(z.enum(["openid", "profile", "email", "wts.profile"])).min(1),
});

export async function migrate(pool: Pool, issuer: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(89730101)");
    await client.query(`CREATE TABLE IF NOT EXISTS wts_schema_migrations (name text PRIMARY KEY, hash text NOT NULL, "appliedAt" timestamptz NOT NULL DEFAULT now())`);
    const files = (await readdir(migrationsDirectory)).filter((name) => /^\d+_[a-zA-Z0-9_]+\.sql$/.test(name)).sort();
    for (const name of files) {
      const sql = await readFile(new URL(name, migrationsDirectory), "utf8");
      const hash = createHash("sha256").update(sql).digest("hex");
      const previous = await client.query<{ hash: string }>("SELECT hash FROM wts_schema_migrations WHERE name = $1", [name]);
      if (previous.rows[0]) {
        if (previous.rows[0].hash !== hash) throw new Error("An installed migration checksum does not match.");
        continue;
      }
      await client.query(sql);
      await client.query("INSERT INTO wts_schema_migrations(name, hash) VALUES ($1, $2)", [name, hash]);
    }
    const installed = await client.query<{ issuer: string; schemaVersion: number }>(`SELECT issuer, "schemaVersion" FROM wts_instance WHERE singleton = true`);
    if (!installed.rows[0]) {
      await client.query(`INSERT INTO wts_instance(singleton, issuer, "schemaVersion") VALUES (true, $1, $2)`, [issuer, schemaVersion]);
    } else if (installed.rows[0].issuer !== issuer || installed.rows[0].schemaVersion !== schemaVersion) {
      throw new Error("The installed issuer or schema version does not match.");
    }
    await client.query("COMMIT");
    return { status: "migrated", schemaVersion };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function provisionClient(pool: Pool, config: Config, raw: unknown, secret: string) {
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.scopes.includes("openid")) throw new Error("The client manifest is invalid.");
  const manifest = parsed.data;
  if (new Set(manifest.redirectUris).size !== manifest.redirectUris.length || new Set(manifest.scopes).size !== manifest.scopes.length) {
    throw new Error("The client manifest contains duplicate policy entries.");
  }
  for (const uri of manifest.redirectUris) {
    const url = new URL(uri);
    if (url.hash || url.username || url.password || url.href !== uri || (url.protocol !== "https:" && (config.production || url.protocol !== "http:" || !isLoopback(url.hostname)))) {
      throw new Error("Client redirect URIs must be exact HTTPS URLs or rehearsal loopback URLs.");
    }
  }
  if (Buffer.byteLength(secret, "utf8") < 32 || new Set(secret).size < 8) throw new Error("The client secret must contain at least 32 bytes and varied characters.");
  const normalized = { ...manifest, redirectUris: [...manifest.redirectUris].sort(), scopes: oauthScopes.filter((scope) => manifest.scopes.some((entry) => entry === scope)) };
  const manifestHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  const secretHash = hashClientSecret(secret);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(89730101)");
    const instance = await client.query<{ issuer: string; schemaVersion: number }>(`SELECT issuer, "schemaVersion" FROM wts_instance WHERE singleton = true`);
    if (instance.rows[0]?.issuer !== config.origin || instance.rows[0]?.schemaVersion !== schemaVersion) throw new Error("Migrate the configured issuer before client provisioning.");
    const existing = await client.query<{ manifestHash: string; secretHash: string }>(`SELECT "manifestHash", "secretHash" FROM wts_client_manifest WHERE "clientId" = $1`, [manifest.clientId]);
    if (existing.rows[0]) {
      if (existing.rows[0].manifestHash !== manifestHash || existing.rows[0].secretHash !== secretHash) throw new Error("The installed client policy conflicts with this manifest or secret.");
      const policy = await client.query<{ clientSecret: string; name: string; redirectUris: string[]; scopes: string[]; valid: boolean }>(
        `SELECT "clientSecret", name, "redirectUris", scopes,
          (NOT disabled AND NOT "skipConsent" AND "subjectType" = 'public' AND "tokenEndpointAuthMethod" = 'client_secret_basic'
          AND "requirePKCE" AND "grantTypes" = '["authorization_code"]'::jsonb AND "responseTypes" = '["code"]'::jsonb
          AND "clientCredentialsScopes" = '[]'::jsonb) AS valid
         FROM "oauthClient" WHERE "clientId" = $1`, [manifest.clientId]);
      const row = policy.rows[0];
      if (!row || !row.valid || row.clientSecret !== secretHash || row.name !== manifest.name || JSON.stringify([...row.redirectUris].sort()) !== JSON.stringify(normalized.redirectUris) || JSON.stringify(row.scopes) !== JSON.stringify(normalized.scopes)) {
        throw new Error("The installed client policy does not match its private manifest.");
      }
      await client.query("COMMIT");
      return { status: "unchanged" };
    }
    const foreign = await client.query(`SELECT 1 FROM "oauthClient" WHERE "clientId" = $1`, [manifest.clientId]);
    if (foreign.rowCount) throw new Error("The client ID belongs to another policy.");
    await client.query(
      `INSERT INTO "oauthClient"(id, "clientId", "clientSecret", name, "redirectUris", scopes, "clientCredentialsScopes", disabled,
       "skipConsent", "enableEndSession", "subjectType", "tokenEndpointAuthMethod", "applicationType", "grantTypes", "responseTypes", "requirePKCE", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,false,false,false,'public','client_secret_basic','web','["authorization_code"]'::jsonb,'["code"]'::jsonb,true,now(),now())`,
      [randomUUID(), manifest.clientId, secretHash, manifest.name, JSON.stringify(normalized.redirectUris), JSON.stringify(normalized.scopes)]);
    await client.query(`INSERT INTO wts_client_manifest("clientId", "manifestHash", "secretHash") VALUES ($1,$2,$3)`, [manifest.clientId, manifestHash, secretHash]);
    await client.query("COMMIT");
    return { status: "created" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
