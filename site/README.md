# WTS 2027 site

`@wts/site` is the independent 2027 SolidStart application.
It uses Node 24.15.0 `node:sqlite` for server-owned data and central OIDC for accounts.
It has no PocketBase runtime, browser SDK, database, cookie, file proxy, or container service.

The root `what-the-stack` application retains the 2026 operational source and PocketBase deployment.
The new site does not replace that deployment automatically.
CFP, reviewer workflows, ticketing, check-in, gamification, feedback, and live Q&A remain in the root application.

## Local public development

Run these commands from the repository root.
Initialization creates an explicitly empty 2027 publication, not a historical content migration.

1. Install the shared frozen dependencies.

   ```sh
   pnpm install --frozen-lockfile
   ```

2. Set an absolute directory for disposable local site data.

   ```sh
   export SITE_DATA_DIR="$PWD/site/.data"
   ```

3. Initialize the local edition.

   ```sh
   pnpm --filter @wts/site data init 2027 local-2027
   ```

4. Start the public development server.

   ```sh
   pnpm dev:site
   ```

5. Open `http://127.0.0.1:3308/`.

The server requires a migrated database before startup.
It does not create a database or run migrations during requests.
Anonymous landing, legal, JSON API, MCP, and media requests do not require the identity service.

## Configuration

Use `site/.env.example` as the configuration reference.
Keep private environment files outside Git and container build contexts.

| Setting | Purpose |
| --- | --- |
| `SITE_DATA_DIR` | Persistent directory containing `site.sqlite` and `assets/` |
| `SITE_EDITION_ID` | Publication and account edition, with `2027` as the default |
| `SITE_ORIGIN` | Exact browser origin without a trailing slash |
| `OIDC_ISSUER` | Exact central issuer without a trailing slash |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Separately registered confidential client |
| `SITE_SESSION_KEY` | Canonical base64url encoding of exactly 32 random bytes |
| `SITE_TRUST_PROXY` | Explicit acceptance of an HTTPS forwarded scheme from a trusted proxy |
| `SITE_PUBLIC_DIR` | Packaged public fonts and logo directory, set by the image |
| `PUBLIC_SITE_URL` | Public canonical URL at build time |
| `VITE_LISTMONK_LIST_ID`, `VITE_TURNSTILE_SITE_KEY` | Existing public newsletter settings at build time |

Production account access requires HTTPS.
The exact OIDC callback is `${SITE_ORIGIN}/auth/callback`.
Client registration, callback changes, deployment, and historical exports require separate authorization.
This implementation does not register a production client.

If a trusted proxy terminates HTTPS, set `SITE_TRUST_PROXY=true`.
The proxy must replace forwarded headers and prevent direct access to the application port.
The application still requires the exact configured host and checks the browser's origin on logout.
It does not use `X-Forwarded-Host` to accept a different host.
Leave proxy trust disabled for direct connections.

## Public content and owned files

The import contract is `PublicContentBatchV1` in `src/lib/public-contract.ts`.
The validator is `src/lib/publication-schema.ts`.
A batch contains `schemaVersion`, `editionId`, `sourceNamespace`, `revision`, `expectedRevision`, `graph`, and `assets`.

The graph contains reviewed public speakers, sessions, appearances, days, programmes, tracks, timed slots, and partners.
It excludes credentials, user links, contacts, private CFP records, reviews, drafts, and announcement changes.
Speaker and session slugs use lowercase hyphen-separated words with an 80-character limit.
The source-owned conference announcements remain separate from imported programme records.

Assets must be local files relative to the supplied bundle.
Their IDs equal their SHA-256 checksums.
The importer checks their size, type, path, and bytes before publication.
Only registered owned assets appear at `/media/<sha256>`.
Image transforms cannot fetch PocketBase or arbitrary remote URLs.
OG images use packaged local fonts and the logo rather than request-origin downloads.

Import a reviewed local batch with:

```sh
pnpm --filter @wts/site data import /absolute/path/to/reviewed-bundle.json
```

An import requires the current revision and a higher new revision.
Conflicting or stale imports preserve the active publication.
An identical receipt returns unchanged without reactivating an older publication.
One immutable graph supplies the anonymous JSON API and public MCP.
The existing programme DTO fields and timed-slot behavior remain intact.
Speaker photo URLs support relative URI references.

The retained programme interfaces are `/api/public/v1/*` and `/api/mcp/public`.
The site does not add speaker, session, agenda, or sponsor HTML routes.
Historical content and exact historical asset URLs need a separately reviewed release decision.
An empty local edition is not proof that production content migrated.

## Accounts and edition permissions

`/user` and `/user/profile` show the live central profile and the current edition's local admin status.
Profile edits open the central `/account` page.
The browser receives no provider access token or client secret.
HTTPS cookies are host-only, Secure, HttpOnly, SameSite=Lax, and `__Host-` prefixed.

OIDC uses authorization code flow, S256 PKCE, nonce, and single-use browser-bound state.
The site binds issuer and subject to the immutable WTS user ID, never to an email address.
It encrypts flow secrets and access tokens and stores hashes of opaque session cookies.
Local expiry cannot exceed the provider's usable five-minute proof.
Protected requests require live UserInfo and current edition-role checks.
Provider failures deny protected access without stopping anonymous content.

Grant an admin role only after the user has established a local account through OIDC.
Use the stable WTS user ID rather than an email address.

```sh
pnpm --filter @wts/site data role 2027 WTS_USER_ID enable
pnpm --filter @wts/site data role 2027 WTS_USER_ID disable
```

Role removal affects the next permission check.
Historical 2026 roles do not grant 2027 access.
Same-origin POST logout removes only the site's session.
It does not end the central session.
It does not promise global logout, offline access, refresh, or suspension semantics.

## Migrations, backups, and restore

The database uses STRICT tables, foreign keys, WAL, FULL synchronization, and a bounded busy timeout.
Explicit migrations verify installed checksums and reject unsupported or altered schema state.

```sh
pnpm --filter @wts/site data migrate
pnpm --filter @wts/site data backup /absolute/path/to/new-private-backup
pnpm --filter @wts/site data restore /absolute/path/to/private-backup /absolute/path/to/new-data-directory
```

Backup uses SQLite's native online backup API, not a copy of the live WAL database file.
It includes a versioned checksum manifest and all historically referenced owned assets.
Restore verifies database integrity, foreign keys, migrations, publications, and asset bytes.
It requires a new destination and never overwrites a live database.

Restored sessions and pending OIDC attempts are empty.
Restored admin grants remain as history but become disabled until explicit reconciliation.
Recover `SITE_SESSION_KEY` separately from protected secret storage.
The backup does not include that key.
After restore, a new key is safe because no restored session or OIDC attempt remains active.
Users must authenticate again.

1. Restore the backup into a new private directory.
2. Configure the replacement container with that directory and its separate secrets.
3. Check `/readyz`, a public record, and its owned asset.
4. Reconcile approved edition-role grants explicitly.
5. Retain the previous volume until the replacement passes verification.

## Containers and checks

Build from the repository root:

```sh
podman build --format docker -f site/Dockerfile -t wts-site:local .
```

The image runs as the nonroot `node` user.
Mount persistent local storage at `/app/data`.
Use one application node and a local filesystem, not shared network SQLite storage.
The image includes the maintenance CLI and migrations alongside the compiled server.

`site/compose.yml` defines independent migration and site services with a `site-data` volume.
Its migration service runs before the site, but it does not select an edition or import content.
Initialize the selected local edition explicitly before starting the site.
Keep the root Compose deployment unchanged.

```sh
pnpm typecheck:site
pnpm build:site
pnpm test:site
pnpm --filter @wts/site test:oidc
pnpm check
```

Storage and account-boundary tests use disposable SQLite files.
OIDC acceptance uses a real isolated auth service, PostgreSQL, synthetic users, and local mail capture.
These checks do not send production mail or change production accounts.
