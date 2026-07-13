# WTS — WhatTheStack Conference 2026

Web app for the WhatTheStack 2026 conference. Public-facing site, CFP system, reviewer workflow, admin tools, ticketing, and content (blog/agenda/speakers).

Live: [wts.sh](https://wts.sh)

## Stack

- [SolidStart](https://start.solidjs.com/) (Solid.js meta-framework) on Nitro
- [PocketBase](https://pocketbase.io/) backend (auth, data, hooks, migrations)
- [Tailwind CSS 4](https://tailwindcss.com/) + [DaisyUI](https://daisyui.com/)
- [Velite](https://velite.js.org/) for MDX content (blog, pages)
- TypeScript
- Node `>= 22`, pnpm

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
pnpm install

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

The September gamification award, redemption, code-operation, score-schedule, and rate-limit paths coordinate through PocketBase-backed locks and uniqueness constraints. Multiple `webapp` replicas must share the same PocketBase database and the same `GAMIFICATION_CODE_PEPPER`; do not split these services across independent PocketBase databases.

## Roles

- **user** — default, can submit CFP and buy tickets
- **reviewer** — rates proposals, votes on weights
- **applicant** — linked speaker profile for CFP submissions
- **admin** — full access to admin routes (`/admin/*`)

## License

See [LICENSE.md](./LICENSE.md).
