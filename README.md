# WTS monorepo

This pnpm workspace contains the preserved conference application, the 2027 site, shared identity, the CFP app, and the blog.
The preserved application remains at the repository root.
Its PocketBase, CFP, reviewer, and admin workflows remain intact.
Open Event Platform stays in its separate repository.

| Package | Directory | Documentation |
| --- | --- | --- |
| `what-the-stack` | Repository root | This README |
| `@wts/auth` | `auth/` | [Auth operations](auth/README.md) |
| `@wts/blog` | `blog/` | [Blog operations](blog/README.md) |
| `@wts/site` | `site/` | [2027 SQLite site operations](site/README.md) |
| `@wts/cfp` | `cfp/` | [Independent CFP app](#independent-cfp-app) |

Use Node.js `>=24.15.0` and pnpm `11.24.0`.
Run `pnpm install --frozen-lockfile` at the root to install every package.
The root `pnpm-lock.yaml` and `pnpm-workspace.yaml` control dependency versions and install policies for all packages.
Do not create nested lockfiles or workspace configurations.
The workspace disables automatic peer installation and cross-app peer resolution.
The site keeps its Vite Plus dependency without overriding the blog's Vite dependency.

Each app has its own build, runtime configuration, deployment, and database ownership.
The workspace does not merge databases or change the 2026 site's PocketBase authentication.
Local databases, uploads, environment files, and private verification artifacts stay outside Git.
The imported blog excludes the original local directory's accounts and data.

## Workspace commands

| Command | Result |
| --- | --- |
| `pnpm build:all` | Build all five applications |
| `pnpm typecheck:all` | Check TypeScript for every app |
| `pnpm dev:site` | Start the independent 2027 site after explicit SQLite initialization |
| `pnpm build:site` | Build the 2027 site only |
| `pnpm test:site` | Check disposable SQLite, recovery, account boundaries, and public contracts |
| `pnpm dev:cfp` | Start the independent CFP app after explicit SQLite initialization |
| `pnpm build:cfp` | Build the CFP app only |
| `pnpm test:cfp` | Check applicant transitions, ownership, sessions, storage, and recovery |
| `pnpm --filter @wts/cfp test:oidc` | Exercise the CFP OIDC boundary with isolated synthetic services |
| `pnpm --filter @wts/auth build` | Build auth only |
| `pnpm --filter @wts/auth acceptance` | Exercise auth with isolated synthetic services |
| `pnpm --filter @wts/blog dev` | Start the blog development server |
| `pnpm --filter @wts/blog build` | Build the blog only |
| `pnpm --filter what-the-stack build` | Build the conference site only |

Existing root commands such as `pnpm dev`, `pnpm build`, and `pnpm test` still target the preserved conference application.
Use the repository root as the Docker build context for each app.
Select `Dockerfile`, `site/Dockerfile`, `cfp/Dockerfile`, `auth/Dockerfile`, or `blog/Dockerfile` for the app you want to build.
The container builds use `pnpm deploy` to package each app with its production dependencies.
Do not change production deployment settings without a separate approved deployment.

## Independent 2027 site

`site/` uses server-owned SQLite and central OIDC without PocketBase.
It retains the public landing, legal pages, newsletter, anonymous JSON API, public MCP, owned media, OG images, and central profile access.
It owns its local sessions, edition permissions, migrations, persistent data, and backups.
It does not include the legacy operational workflows or import historical records automatically.
Read [site/README.md](site/README.md) for explicit initialization, reviewed imports, account setup, and container replacement.
No production deployment, client registration, or historical content cutover accompanies this implementation.

## Independent CFP app

`cfp/` implements the stepped applicant workflow for `cfp.wts.sh`.
It stores one reusable speaker profile and general settings per WTS user.
A fresh application starts with blank presentation fields.
Later applications skip completed speaker entry and show saved settings with an edit link.
Profile and settings changes apply to all owned applications.
Pending edits remain private drafts until confirmation.
Finalized applications can supply an independent reuse draft.
Email remains read-only central identity data.

The app owns its SQLite database, migrations, backups, OIDC client, and host-only session cookies.
It does not use PocketBase or import private 2026 CFP records.
The existing root CFP, reviewer, and admin workflows remain unchanged.
This implementation does not register a production client or deploy `cfp.wts.sh`.

### Local CFP initialization

The CLI does not load `.env` files.
Use `cfp/.env.example` for the server configuration names.
`CFP_SESSION_KEY` requires exactly 32 random bytes in canonical base64url encoding.
Keep that key and the OIDC client secret outside Git and database backups.
Local sign-in requires a separate configured OIDC client.

1. Export the CFP configuration into your development shell.
2. Initialize a fresh local edition.

   ```bash
   export CFP_DATA_DIR="$PWD/cfp/.data"
   export CFP_EDITION_ID=2027
   pnpm --filter @wts/cfp data init 2027
   ```

3. Open the local edition.

   ```bash
   pnpm --filter @wts/cfp data open 2027
   ```

4. Start the app.

   ```bash
   pnpm dev:cfp
   ```

New editions remain closed until an operator opens them.
Closing CFP blocks draft creation, draft saves, and submissions.
Saved record reads and profile or settings maintenance remain available.
CFP sessions require live central verification and expire after at most five minutes.
Local logout does not end central SSO.

### CFP maintenance and recovery

The maintenance CLI supports `migrate`, `init`, `open`, `close`, `backup`, and `restore`.
Backup uses the native SQLite online backup operation and includes a checksum manifest.
Use the online backup command instead of copying a live SQLite file.
Treat every CFP backup as private applicant data.

1. Create a backup in a new directory.

   ```bash
   pnpm --filter @wts/cfp data backup /private/cfp-backup-2026-10-02
   ```

2. Restore the backup into a new directory.

   ```bash
   pnpm --filter @wts/cfp data restore /private/cfp-backup-2026-10-02 /private/cfp-restored-2026-10-02
   ```

3. Start a replacement container with the restored directory.
4. Verify the restored profiles, settings, drafts, applications, and receipts.
5. Open the intended edition after you review its restored state.

Restore validates the checksum, schema, integrity, foreign keys, and stored domain records.
It preserves applicant data and identity bindings.
It clears all local sessions and OIDC flows and closes every edition.
Recover `CFP_SESSION_KEY` separately or create a new key before a fresh sign-in.
Enable `CFP_TRUST_PROXY` only when the proxy replaces forwarded headers and blocks direct application access.

The isolated browser fixture starts a real built CFP app and synthetic central auth over local HTTPS.
Build auth and CFP before you run `pnpm --filter @wts/cfp browser:fixture`.
The fixture accepts JSON commands for restart, closure, backup, restore, and cleanup.
It never registers a production client or reads production data.

### CFP local verification

`pnpm --filter @wts/cfp test:browser` runs the isolated built browser proof.
It requires the auth and CFP builds and an installed Playwright Chromium browser.
It checks submissions, reuse, private reads, closure, account changes, and recovery.

The container proof uses only its own synthetic data and volumes.
It checks online backup, restore, container replacement, and runtime dependency boundaries.

1. Build a Docker-format image from the repository root.

   ```bash
   podman build --format docker -f cfp/Dockerfile -t localhost/wts-cfp:verify .
   ```

2. Verify the prebuilt local image.

   ```bash
   pnpm --filter @wts/cfp test:container localhost/wts-cfp:verify
   ```



# WTS — WhatTheStack Conference 2026

Web app for the WhatTheStack 2026 conference. Public-facing site, CFP system, reviewer workflow, admin tools, ticketing, and content (blog/agenda/speakers).

Live: [wts.sh](https://wts.sh)

## Stack

- [SolidStart](https://start.solidjs.com/) (Solid.js meta-framework) on Nitro
- [PocketBase](https://pocketbase.io/) backend (auth, data, hooks, migrations)
- [Tailwind CSS 4](https://tailwindcss.com/) + [DaisyUI](https://daisyui.com/)
- [Velite](https://velite.js.org/) for MDX content (blog, pages)
- TypeScript
- Node.js `>=24.15.0` and pnpm `11.24.0`

## Features

- Marketing pages (home, about, agenda, speakers, sessions, FAQ, sponsors, partnerships)
- Blog (MDX via Velite)
- CFP submission flow with reviewer/admin dashboards
- Weighted committee scoring with per-reviewer weight votes
- Admin: user management, proposal leaderboard, weight averages
- Ticketing integrations (Tito, HiEvents)
- Newsletter via Listmonk
- OG image generation (Satori)
- Trip cost calculator

## Quick Start

```bash
# 1. Install deps
pnpm install --frozen-lockfile

# 2. Download PocketBase binary
pnpm pocketbase:download

# 3. Copy env template (see "Environment" below)
cp .env .env.local   # or create .env manually

# 4. Start dev (runs PocketBase + Vite concurrently)
pnpm dev
```

Then:
- App: <http://localhost:3000>
- PocketBase admin UI: <http://localhost:8090/_/>

First launch auto-creates the superuser from `POCKETBASE_SUPERUSER_EMAIL` / `POCKETBASE_SUPERUSER_PASSWORD`.

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Full dev: PocketBase + Velite watch + Vite |
| `pnpm start:dev` | App only (Velite watch + Vite), no PocketBase |
| `pnpm build` | Production build (Velite + Vite) |
| `pnpm start` | Run built app |
| `pnpm pocketbase:download` | Fetch PocketBase binary into `pocketbase/` |
| `pnpm pocketbase:start` | Start local PocketBase only |
| `pnpm pocketbase:createsuperuser` | Manually create superuser |
| `pnpm docker:up` / `docker:down` | Docker Compose stack |

## Environment

Required in `.env` (or `.env.local`):

```bash
# PocketBase
POCKETBASE_URL="http://127.0.0.1:8090"            # server admin API (local)
PUBLIC_POCKETBASE_URL="http://127.0.0.1:8090"     # browser + SSR file URLs (default if unset)
POCKETBASE_SUPERUSER_EMAIL="admin@example.com"
POCKETBASE_SUPERUSER_PASSWORD="supersecret"

# Canonical site origin
PUBLIC_SITE_URL="https://wts.sh"

# Optional comma-separated additional browser Origins for the MCP endpoint
MCP_ALLOWED_ORIGINS="https://trusted-client.example"
```

**Production (Coolify / Docker):** set the public PocketBase hostname for anything rendered in HTML or loaded by the browser. Keep `POCKETBASE_URL` as the internal service URL for server-side admin API calls only. Native and server MCP clients do not send an `Origin`; browser clients must use the canonical `PUBLIC_SITE_URL` Origin or an Origin listed in the server-only `MCP_ALLOWED_ORIGINS` value.

```bash
PUBLIC_POCKETBASE_URL="https://pb-2026.wts.sh"    # canonical — speaker avatars, file URLs
POCKETBASE_URL="http://pocketbase:8090"           # webapp → pocketbase on Docker network
```

Optional aliases for local dev or older compose files: `POCKETBASE_PUBLIC_URL`, `VITE_POCKETBASE_URL` (same value as `PUBLIC_POCKETBASE_URL`).

```bash
# Tito (tickets)
TITO_ACCOUNT="wts"
TITO_EVENT="conference-2026"

# HiEvents
HIEVENTS_API_URL="https://hievents.example.com"
HIEVENTS_API_KEY="" # optional alternative to email/password/account ID
HIEVENTS_EMAIL=""
HIEVENTS_PASSWORD=""
HIEVENTS_EVENT_ID=1
HIEVENTS_ACCOUNT_ID=1
HIEVENTS_REQUEST_TIMEOUT_MS=10000
HIEVENTS_MAX_RETRIES=2
HIEVENTS_RETRY_BASE_MS=200

# Gamification (server-only; required for Mission-code operations)
GAMIFICATION_CODE_PEPPER="replace-with-a-random-high-entropy-secret"

# Listmonk (newsletter)
LISTMONK_USERNAME="bot"
LISTMONK_API_TOKEN=""
LISTMONK_URL="https://listmonk.wts.sh"
LISTMONK_LIST_ID=2
VITE_LISTMONK_LIST_ID=2
```

### PocketBase hooks (Coolify / Docker)

Hooks run inside the PocketBase container. Pass variables through `docker-compose.yml` (or Coolify env on the pocketbase service).

**Outbound email** — CFP notifications and the daily report use PocketBase Admin → Settings → Mail (`e.app.newMailClient()`). Configure SMTP there (e.g. Resend). `RESEND_API_KEY` in Coolify is not read by hooks unless you wire SMTP in the admin UI.

**Listmonk user sync** (`listmonk_sync.pb.js`, on new `users` record):

| Variable | Purpose |
|---|---|
| `LISTMONK_USERNAME` | Basic auth user (required) |
| `LISTMONK_API_TOKEN` | API token (preferred) |
| `LISTMONK_PASSWORD` | Used as token if `LISTMONK_API_TOKEN` is unset (Coolify naming) |
| `LISTMONK_URL` | Listmonk base URL (default `https://listmonk.wts.sh`) |
| `LISTMONK_LIST_ID` | Subscriber list ID (default `2`) |

**Daily CFP report** (`daily_report.pb.js`, cron 08:00 UTC):

| Variable | Purpose |
|---|---|
| `CFP_DAILY_REPORT_RECIPIENT` | To address(es); comma-separated for multiple (default `darko@wts.rocks`) |
| `CFP_DAILY_REPORT_FORCE` | Set to `true` to send even when there were no new users/submissions in 24h |

HiEvents vars (`HIEVENTS_*`) are passed to both the web app evidence service and PocketBase ticket-report hooks. `GAMIFICATION_CODE_PEPPER` is passed only to the web app; never expose it through a `PUBLIC_` or `VITE_` variable.

## Administrative MCP

Admins create one-time MCP credentials at `/admin/mcp`. Select only the scopes the client needs:

- `programme:read` reads private Session and Speaker programme data.
- `cfp:read` reads private CFP Submissions and review context. Aggregate programme snapshots require both private read scopes.
- `partners:read` lists private Partner summaries and reads a Partner Note only after a human approves its current version for agent visibility.
- `partners:draft:write` creates and patches drafts. It cannot upload logos, publish, delete, approve notes, or modify Published Partners.

Every current admin can inspect safe team-wide token metadata and recent Admin Actions. Any current admin can revoke an active token with a required reason; token material remains visible only in the creation response.

The authenticated Streamable HTTP endpoint is `/api/mcp`. Native clients send the generated credential as a bearer token. Browser clients must also use an allowed Origin as described under [Environment](#environment).

### OpenCode

Keep the one-time credential in an environment variable, then add the remote server to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "wts-admin": {
      "type": "remote",
      "url": "http://localhost:3000/api/mcp",
      "enabled": true,
      "headers": {
        "Authorization": "Bearer {env:WTS_MCP_TOKEN}"
      }
    }
  }
}
```

Start OpenCode with `WTS_MCP_TOKEN` set in its environment. Use the deployed `https://wts.sh/api/mcp` URL outside local development.

### MCP Inspector

Inspector's CLI can verify discovery or call a tool directly:

```bash
export WTS_MCP_TOKEN='wts_mcp_...'

npx -y @modelcontextprotocol/inspector --cli \
  http://localhost:3000/api/mcp \
  --transport http \
  --method tools/list \
  --header "Authorization: Bearer $WTS_MCP_TOKEN"
```

### Partner Workflow

1. Call `list_partners` before creating a record. Exact normalized names and canonical URLs are blocked; similar names and shared hosts produce warnings.
2. Call `create_partner_draft` with allowlisted metadata and a unique `operation_id`. Retrying the exact input with the same ID safely replays the result.
3. Read the current `expected_updated_at` from `get_partner`, then pass it with a new `operation_id` and an allowlisted `patch` to `update_partner_draft`.
4. If a write is pending or failed, retry the exact input and operation ID. Use a new operation ID whenever input changes.
5. A human admin reviews the draft, uploads the official logo, optionally approves the current Partner Note for agent visibility, and publishes it.

Partner tools return JSON structured content plus a text fallback. Safe errors include a code, retry guidance, and the current record where relevant. MCP mutations appear in Admin Action activity without storing Partner Note text or token secrets.

## Architecture

Two-tier per PocketBase guidance:

**Client-tier** — browser SPA talks directly to PocketBase Web API via `pocketbase-js` SDK. Collection API rules enforce access.

**Server-tier** — privileged server actions use superuser credentials for operations that can't be gated with API rules (admin reads, cross-collection aggregations, webhooks).

Key files:
- `src/lib/pocketbase-client-service.ts` — client SDK wrapper
- `src/lib/pocketbase-admin-service.ts` — server superuser service
- `src/lib/auth-service.ts` — client auth store
- `src/lib/admin-actions.ts` — server actions for admin ops
- `src/lib/reviewer-actions.ts` — server actions for reviewers
- `src/routes/api/admin.tsx` — admin API route
- `pocketbase/pb_hooks/` — server-side PB hooks (JS)
- `pocketbase/pb_migrations/` — schema migrations

See [POCKETBASE_SETUP.md](./POCKETBASE_SETUP.md) for PocketBase setup details and [PB_TYPES_GUIDE.md](./PB_TYPES_GUIDE.md) for regenerating types after schema changes.

## Content (Blog)

MDX posts live under content folders picked up by Velite. Velite emits JSON consumed by routes. Run `pnpm dev` (which runs `velite --watch`) while authoring — output lands in `.velite/`.

## Preview / Build

```bash
pnpm build
pnpm start
```

The build produces a Nitro Node server. Open <http://localhost:3000>.

## Docker / Production

```bash
pnpm docker:up
```

`docker-compose.yml` spins up the web app + PocketBase with persistent volume for `pb_data`. Deploys to Coolify. Superuser auto-provisions on first run from env.

Drain every web replica running the `2cce0be` baseline before converting persisted MCP scopes, then deploy the PocketBase image and its migrations before or together with the new web image. Migration `1787000005_migrate_mcp_token_scopes.js` expands persisted `program:read` grants before the new runtime scope allowlist is used; authenticated MCP also durably expands a legacy grant on first use as a web-first rollout safeguard. Do not run baseline and new web replicas concurrently during that conversion, and do not treat the safeguard as a substitute for deploying the remaining Partner, Admin Action, and token-governance migrations and hooks.

The public MCP burst, process-wide rate, and concurrency counters are in-memory per web process. Keep `/api/mcp/public` on one serving web replica unless the reverse proxy or another shared layer enforces equivalent aggregate limits across replicas.

The September gamification award, redemption, code-operation, score-schedule, and rate-limit paths coordinate through PocketBase-backed locks and uniqueness constraints. Multiple `webapp` replicas must share the same PocketBase database and the same `GAMIFICATION_CODE_PEPPER`; do not split these services across independent PocketBase databases.

## Roles

- **user** — default, can submit CFP and buy tickets
- **reviewer** — rates proposals, votes on weights
- **applicant** — linked speaker profile for CFP submissions
- **admin** — full access to admin routes (`/admin/*`)

## License

See [LICENSE.md](./LICENSE.md).
