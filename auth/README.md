# WTS identity service

The Better Auth 1.7.7 service at `https://auth.wts.sh` uses PostgreSQL 18.3.
It shares the WTS pnpm workspace, not application databases, permissions, conference records, or PocketBase rules.
See [the project brief](../docs/plans/wts-shared-identity-project-brief.md) for consumer migration gates.
Its [permissions section](../docs/plans/wts-shared-identity-project-brief.md#permissions) defines the agreed authorization design.

## Identity and session contract

- An imported PocketBase user ID is preserved literally as the OAuth subject and `wtsUserId`.
- An immutable `(issuer, subject)` binding is created in the same transaction as the account.
- Canonical profile fields live on the auth user. Applications consume `/v1/me` or versioned OIDC UserInfo, not database tables.
- Google and GitHub identities belong to their exact provider IDs. Automatic email-based account linking is disabled.
- Each client has exact callback URLs, its own secret, and authorization-code flow with S256 PKCE.
- Central sessions expire after eight hours without sliding renewal. Account cookies are host-only, HttpOnly, SameSite=Lax, and Secure in production.
- HTTPS cookies use the `__Host-` prefix to prevent sibling-domain cookie injection.
- Access tokens, ID tokens, and authorization codes expire after five minutes. Refresh and client-credentials grants are disabled.
- UserInfo rejects tokens after the associated central session ends.
- Application logout ends only that application's session. Central logout does not erase existing application cookies.
- Password reset revokes central sessions. Applications remain responsible for their local sessions and permissions.
- Registration is closed by default. Do not open registration before resolving existing-account migration conflicts.

## Application authorization boundary

Auth verifies identity and supplies the stable WTS user ID and shared profile.
Each application stores its role assignments in its own database and enforces permissions on the server.
Neither shared profile fields nor central identity tokens grant application roles.
Conference roles use edition scope where required.
A CFP reviewer or administrator does not receive privileges on the main site through that assignment.

Consumers must check roles and resource-specific rules on every protected request.
They must deny protected access unless an explicit rule permits it.
Profile edits must not grant privileged access.
Role administration belongs to the owning application.

Role removal must affect later protected requests, including requests that use cached permission data.
Consumers must define local session handling after central account suspension, logout, password reset, and expiry.
The identity service's central-session checks do not terminate consumer sessions automatically.
These requirements remain consumer integration work, not behavior implemented by the identity service.


## Local verification

Requirements are Node 24.15.0 or newer, pnpm 11.24.0, rootless Podman, and Playwright Chromium.
The repository root contains the canonical `pnpm-workspace.yaml` and `pnpm-lock.yaml` for the site, auth, and blog.
Auth remains a separate runtime and database.
Acceptance also requires the repository's PocketBase 0.30.4 executable at `pocketbase/pocketbase`.
It creates isolated source credentials with that binary. It does not use the repository's PocketBase data directory.

Run these commands from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @wts/auth exec playwright install chromium
pnpm --filter @wts/auth build
pnpm --filter @wts/auth acceptance
```

Acceptance creates a private PostgreSQL container, local SMTP catcher, auth process, and two synthetic relying parties.
It exercises browser login, SSO, verification, recovery, profile ownership, protocol errors, isolation, import conflicts, restart, and dump restoration.
The service runs with a restricted runtime database role, not the migration owner.
Run-owned processes, containers, snapshots, and credential files are removed afterward.
Redacted results remain under `auth/acceptance/artifacts/`.
The current exported snapshot feeds the importer. Unicode checks use source-produced bcrypt hashes, including a 72-byte multibyte password.

These checks do not prove real Google/GitHub callbacks, production TLS, or either application's consumer integration.
Synthetic users are not production users. Do not treat this rehearsal as permission for production migration.

## Configuration

The process reads environment variables. It does not load an `.env` file automatically.
Configure these variables in Coolify or explicitly export them before invoking a command.

| Variable | Meaning |
| --- | --- |
| `AUTH_PUBLIC_URL` | Exact origin. Production: `https://auth.wts.sh`. Immutable after migration. |
| `DATABASE_URL` | PostgreSQL URL. Use the owner for administrative commands and `wts_auth_runtime` for the service. |
| `BETTER_AUTH_SECRET` | Random secret with at least 32 characters. Preserve it with the database backup. |
| `AUTH_REGISTRATION` | `closed` or `open`. Default: `closed`. |
| `NODE_ENV` | `production` by default. HTTP is allowed only for non-production loopback origins. |
| `HOST`, `PORT` | Default: `0.0.0.0`, `3000`. |
| `SMTP_HOST`, `SMTP_PORT` | Mail transport. Default port: `587`. |
| `SMTP_SECURE` | `true` for implicit TLS. `false` requires STARTTLS in production. |
| `SMTP_FROM` | Verified sender address. |
| `SMTP_USER`, `SMTP_PASSWORD` | Complete credential pair, required in production. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional complete pair. Callback: `https://auth.wts.sh/api/auth/callback/google`. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Optional complete pair. Callback: `https://auth.wts.sh/api/auth/callback/github`. |

An absent or empty provider pair disables that provider. A partial pair prevents startup.
Keep GitHub disabled until its callback migration is separately approved.
Add the Google callback to the existing OAuth client without removing the current PocketBase callback.

Do not expose PostgreSQL publicly. Put credentials in Coolify secrets, not source files or build arguments.
Use independent random secrets for Better Auth, PostgreSQL owner, PostgreSQL runtime, and each relying party.
The Compose database passwords must be base64url values to remain valid in its connection URLs.

## Initialize the database

For local administrative commands, use `auth/` as the working directory.
Container commands use `/app`.
Set owner `DATABASE_URL`, the issuer, and the required service configuration.

```sh
node dist/cli.js migrate
node scripts/provision-runtime.mjs
```

Runtime-role provisioning additionally requires `AUTH_DATABASE_RUNTIME_PASSWORD`, a varied 32–128 character base64url secret.
The owner must be able to create roles.
Provisioning refuses inherited runtime roles and removes runtime table grants before installing its limited permissions.
Only the owner can migrate, import identities, or provision clients.

Migrations use a transaction, advisory lock, and stored checksums.
Repeating an unchanged migration is safe. A changed installed migration or issuer is rejected.
Do not run the service with owner credentials.

## Provision a relying party

Create a client manifest:

```json
{
  "version": 1,
  "clientId": "wts-2026",
  "name": "What The Stack 2026",
  "redirectUris": ["https://wts.sh/auth/callback"],
  "scopes": ["openid", "profile", "email", "wts.profile"]
}
```

The callback above is an example, not an existing WTS integration.
Use the exact route implemented by the consumer. Production callbacks require HTTPS.
Write the independent client secret into an owner-only regular file with mode `0600`.

```sh
node dist/cli.js client --manifest /private/client.json --secret-file /private/client-secret
```

An identical manifest and secret is a no-op. A conflicting existing policy is rejected.
There is no HTTP client-registration or administrative endpoint.
Consumers use `/.well-known/openid-configuration`, validate issuer, audience, nonce, state, and signature, then establish their own host-only session.
The UserInfo claims `https://wts.sh/user_id` and `https://wts.sh/profile` require the `wts.profile` scope.
The profile claim has `version: 1`. It contains no application roles.

## Shared profile API

`GET /v1/me` requires the verified user's central session cookie.
`PATCH /v1/me` also requires `Origin` equal to the configured account origin.
Neither endpoint accepts bearer authentication or a caller-selected user ID.

```json
{
  "name": "Person Name",
  "avatarUrl": null,
  "preferredLanguage": "en",
  "expectedRevision": 1
}
```

All four fields are required. A stale revision returns HTTP 409.
Identity, email, credentials, username, email visibility, roles, and permissions cannot be changed through this endpoint.
The account page exposes the same operation and supports reloading after a conflict.

## Offline PocketBase export and import

Production export and import require separate approval and a rollback plan.
The exporter reads only a closed, owner-only offline SQLite backup without WAL, SHM, or journal sidecars.
It supports the legacy and current PocketBase password/external-auth column layouts.
Declare the exact source version. Unsupported schemas fail without creating a snapshot.

```sh
node dist/cli.js export-pocketbase \
  --database /private/offline-data.db \
  --output /private/snapshot.json \
  --source-version 0.30.4 \
  --offline-backup \
  --avatar-base https://wts.sh/api/files/
node dist/cli.js import --snapshot /private/snapshot.json --dry-run
node dist/cli.js import --snapshot /private/snapshot.json
```

The snapshot contains password hashes and provider identities. Keep it private and remove it under the approved retention policy.
Source avatars require a public avatar base. The importer preserves the source filename and URL, not the image bytes.
Keep the source assets available until an asset migration is separately complete.

The importer preserves bcrypt hashes, verification state, IDs, timestamps, profile fields, and exact provider ownership.
Existing-account, normalized-email, and provider conflicts abort the whole transaction. It does not merge by email.
CLI failures report safe categories: `missing_email`, `duplicate_normalized_email`, `missing_identity_link`, `conflicting_ownership`, `invalid_snapshot`, and `source_snapshot_conflict`.
They do not print credentials or source records.
An identical rerun preserves later password and profile changes.
A different snapshot for the same collection is rejected, rather than silently resynchronizing mutable source data.
Pause source account changes before taking the final migration snapshot.

## Container and Coolify release

`auth/compose.yml` defines a separate database, one-shot migration/role provisioning, and the restricted auth service.
Its build context is the repository root.
The PostgreSQL volume is mounted at `/var/lib/postgresql`, as required by the pinned PostgreSQL 18 image.
The image runs as the Node user. It contains no credentials or production account data.
The build uses a filtered frozen install and an auth-only build from the canonical dependency graph.
`pnpm --filter @wts/auth deploy --prod` creates portable production dependencies.
The root workspace sets `injectWorkspacePackages: true`, as required by pnpm 11's modern deploy command.
The auth package's `files` list limits the deployed files to its runtime, migrations, public assets, and runtime-role provisioner.
The image does not contain the site or blog runtime.

To build from the repository root:

```sh
podman build -f auth/Dockerfile -t localhost/wts-auth:local .
```

After the root frozen install, prepare a source-packaged Coolify Dockerfile without publishing a Git revision:

```sh
node auth/scripts/release.mjs /private/release-directory
```

The release directory must be outside the repository.
It contains `coolify.Dockerfile` and a manifest with source checksums.
The generator uses `pnpm deploy --lockfile-only --ignore-scripts` to export standalone auth metadata from the canonical lockfile.
The exported workspace also keeps the root `autoInstallPeers` policy for its frozen standalone install.
It does not resolve new versions or edit the dependency graph by hand.
The manifest records canonical workspace checksums and exported metadata checksums separately.
The generated Dockerfile embeds the exported auth metadata, explicit auth sources, migrations, the runtime-role provisioner, and public assets.
It excludes unrelated source, the full workspace lockfile, local databases, acceptance artifacts, and secrets.
The standalone build uses a frozen install and removes development dependencies before it copies the auth runtime.
The generator removes its private temporary files before it exits.
The two public font assets are fetched from `wts.sh` during the build, with exact SHA-256 checksums.
Runtime does not fetch these assets from WTS. Builds require those pinned public URLs to remain available.
The generator keeps the 100000-byte limit on the base64-encoded Dockerfile and limits each archive chunk to 16000 characters.
Create a separate Coolify Dockerfile application and private PostgreSQL resource only after deployment approval.
Configure the exact hostname, internal database URL, port `3000`, secrets, and health checks.
Run migration and runtime-role provisioning with owner credentials before starting the restricted service.
Do not change the existing WTS Coolify application.
Coolify's create API expects base64-encoded Dockerfile content.
Set port `3000` explicitly after creation. The observed create API otherwise retained port `80`.
Check the persisted Caddy and Traefik backend labels too. Updating the exposed port did not regenerate the initial port-80 labels.
The deployed backend labels use port `3000`.
Disable Coolify's generated curl/wget healthcheck override. Keep the Dockerfile's Node `/readyz` healthcheck enabled.
The slim runtime image does not contain curl or wget.
CLI 1.6.2 uses obsolete start and environment-write contracts. Use the current API or dashboard for those operations.
The observed update API does not permit replacing Dockerfile content. Use the dashboard for future Dockerfile updates.

Check `/healthz`, `/readyz`, discovery, JWKS, HTTPS, and real provider callbacks after deployment.
Readiness checks the issuer, schema version, migration records, identity trigger, and persisted signing key.
A successful liveness response alone does not mean that authentication is ready.

## Backup and rollback

Back up PostgreSQL with `pg_dump`, including users, credentials, identity bindings, clients, sessions, import ledger, and signing keys.
Back up `BETTER_AUTH_SECRET` and provider/client credentials separately in the secret store.
Restore into a new private database and use the same issuer and secrets.
Recreate the restricted runtime role if restoring to a different PostgreSQL cluster.
Prove login, identity equality, and JWKS verification before redirecting production traffic.

The acceptance suite rehearses database dump restoration and verifies an earlier signed token against restored keys.
It does not exercise a production backup provider or cross-cluster disaster recovery.
Consumer cutover and conference database migration remain separate work.

## Production state: 2026-10-02

- Host: `https://auth.wts.sh`.
- Coolify project/environment: WTS / production, server `fss8sk4`.
- Application: `mmchmqhj0n8rr7captzpxc3m`.
- Private PostgreSQL resource: `iin9jvhp1mpkviqccy29h7cf`.
- Verified deployment: `byqdgbcemfxn0b2r5hvicray`.
- Runtime source digest: `f68ead8b4b3b4b709237e14a8c1457c0e0697c3dbccc7740d4e371332cf4fd0d`.
- Google enabled. GitHub disabled. Registration closed.
- Imported 274 WTS-2026 users and 204 provider links. Conference data and consumer clients were not imported.
- Secrets are runtime-only Coolify environment variables. The service uses the restricted database role and runs as the Node user.

Live checks passed for TLS, HTTP-to-HTTPS redirect, readiness, discovery, public JWKS, closed registration, anonymous profile denial, and disabled dynamic registration.
Desktop and mobile account pages were inspected. Google initiation returned the correct callback and a secure host-prefixed state cookie.
SMTP authentication and TLS were verified without sending a message.
Real Google account authentication and production consumer SSO were not exercised.

Daily local backups use cron `0 2 * * *`, with seven backups and seven days of retention.
Backup configuration: `msv3xiksy85e9aydsa5ibaqz`. An initial execution succeeded.
These backups remain on the same server and do not protect against server loss. Off-site backups remain unconfigured.
The production database was not restored. Its pre-import backup restored successfully into a disposable private database before the import.

### WTS-2026 account copy

The approved import copied all users from PocketBase 0.34.0 into central auth.
It preserved IDs, bcrypt hashes, timestamps, verification states, profiles, and provider ownership.
The target contains 274 users, 274 identity mappings, 274 password accounts, 134 Google links, and 70 GitHub links.
It preserves 268 verified users and six unverified users.
GitHub links remain stored, but GitHub login remains disabled.

Field comparisons found zero mismatches. An identical production import returned `unchanged`.
Source comparisons covered all 82 tables and 5,667 rows. Source schemas and records matched the private backup after the import.
The 2026 login page, PocketBase health, auth readiness, and auth discovery returned HTTP 200.
Application configurations remained unchanged.

The 2026 site still uses PocketBase. Its data, historical roles, permissions, and relationships remain there.
This import is a one-time copy, not synchronization.
Later PocketBase account changes do not update central auth.
The import does not revoke existing PocketBase sessions.
The import does not transfer those sessions to central auth.
Real user password and provider sign-ins were not exercised.

Private rollback backups remain at `/root/wts-auth-migration-20261002` on the production server.
They include `pocketbase-before.db` and `auth-before.dump`.
The run removed its temporary JSON export and disposable rehearsal database after verification.
The migration evidence is in `.audit/wts-auth-migration-result.json`.
The decision trail is `.audit/wts-auth.tsv`.
