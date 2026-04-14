# WTS — WhatTheStack Conference 2026

Web app for the WhatTheStack 2026 conference. Public-facing site, CFP system, reviewer workflow, admin tools, ticketing, and content (blog/agenda/speakers).

Live: [wts.rs](https://wts.rs)

## Stack

- [SolidStart](https://start.solidjs.com/) (Solid.js meta-framework) on Nitro
- [PocketBase](https://pocketbase.io/) backend (auth, data, hooks, migrations)
- [Tailwind CSS 4](https://tailwindcss.com/) + [DaisyUI](https://daisyui.com/)
- [Velite](https://velite.js.org/) for MDX content (blog, pages)
- TypeScript
- Node `>= 22`, pnpm

## Features

- Marketing pages (home, about, agenda, speakers, sessions, FAQ, partnerships)
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
POCKETBASE_URL="http://localhost:8090"
POCKETBASE_SUPERUSER_EMAIL="admin@example.com"
POCKETBASE_SUPERUSER_PASSWORD="supersecret"
VITE_POCKETBASE_URL="http://localhost:8090"   # client-side

# Tito (tickets)
TITO_ACCOUNT="wts"
TITO_EVENT="conference-2026"

# HiEvents
HIEVENTS_API_URL="https://hievents.example.com"
HIEVENTS_EMAIL=""
HIEVENTS_PASSWORD=""
HIEVENTS_EVENT_ID=1
HIEVENTS_ACCOUNT_ID=1

# Listmonk (newsletter)
LISTMONK_USERNAME="bot"
LISTMONK_API_TOKEN=""
VITE_LISTMONK_LIST_ID=2
```

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

## Roles

- **user** — default, can submit CFP and buy tickets
- **reviewer** — rates proposals, votes on weights
- **applicant** — linked speaker profile for CFP submissions
- **admin** — full access to admin routes (`/admin/*`)

## License

See [LICENSE.md](./LICENSE.md).
