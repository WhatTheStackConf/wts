import { Pool } from 'pg';

const password = process.env.AUTH_DATABASE_RUNTIME_PASSWORD;
if (!password || !/^[A-Za-z0-9_-]{32,128}$/.test(password) || new Set(password).size < 8) {
  throw new Error('Set a varied 32–128 character base64url runtime database password.');
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(89730101)');
  const role = await client.query("SELECT oid FROM pg_roles WHERE rolname = 'wts_auth_runtime'");
  if (!role.rowCount) await client.query('CREATE ROLE wts_auth_runtime LOGIN');
  const memberships = await client.query("SELECT 1 FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = 'wts_auth_runtime')");
  if (memberships.rowCount) throw new Error('The runtime role must not inherit other database roles.');
  await client.query(`ALTER ROLE wts_auth_runtime WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
  await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await client.query('GRANT USAGE ON SCHEMA public TO wts_auth_runtime');
  await client.query('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM wts_auth_runtime');
  await client.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO wts_auth_runtime');
  await client.query('GRANT INSERT, UPDATE ON "user", account TO wts_auth_runtime');
  await client.query('GRANT INSERT, UPDATE, DELETE ON session, verification, jwks, "oauthRefreshToken", "oauthAccessToken", "oauthConsent", "oauthClientAssertion" TO wts_auth_runtime');
  await client.query('COMMIT');
  process.stdout.write(JSON.stringify({ status: 'runtime_role_provisioned' }) + '\n');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
