# Technology Stack

**Analysis Date:** 2026-03-29

## Languages

**Primary:**
- TypeScript ^5.9.3 - All application code (`src/`), config files
- TSX (JSX with SolidJS) - Components and routes (`src/components/`, `src/routes/`)

**Secondary:**
- JavaScript (JSVM) - PocketBase server-side hooks (`pocketbase/pb_hooks/*.pb.js`)
- Markdown/MDX - Content pages (`content/pages/*.md`)

## Runtime

**Environment:**
- Node.js >= 22 (enforced via `engines` in `package.json`)
- Docker base image: `node:22-alpine`

**Package Manager:**
- pnpm (via corepack)
- Lockfile: `pnpm-lock.yaml` (present)
- Workspace config: `pnpm-workspace.yaml` (single package, used for `onlyBuiltDependencies`)

## Frameworks

**Core:**
- SolidJS ^1.9.9 - Reactive UI framework (`solid-js`)
- SolidStart 2.0.0-alpha.0 - Full-stack meta-framework (`@solidjs/start`)
- Nitro v2 - Server engine via `@solidjs/vite-plugin-nitro-2` ^0.1.0, preset: `node-server`
- SolidJS Router ^0.15.0 - File-based routing (`@solidjs/router`)

**CSS/Styling:**
- Tailwind CSS ^4.1.13 - Utility-first CSS via PostCSS plugin (`@tailwindcss/postcss`)
- DaisyUI ^5.5.14 - Tailwind component library
- Tailwind Typography ^0.5.18 - Prose styling for MDX content

**Content:**
- Velite ^0.3.1 - Content layer for MDX processing (`velite.config.ts`)
- solid-jsx ^1.1.4 - MDX rendering in SolidJS components
- @mdx-js/mdx ^3.1.1 - MDX compilation

**Build/Dev:**
- Vite ^7.3.0 - Build tool and dev server (`vite.config.ts`)
- concurrently ^9.2.1 - Parallel dev process runner (Vite + PocketBase + Velite)
- vite-plugin-solid-svg ^0.8.1 - SVG import as Solid components

## Key Dependencies

**Critical:**
- `pocketbase` ^0.26.6 - PocketBase JS SDK for database/auth client
- `@solidjs/start` 2.0.0-alpha.0 - **Alpha version** of the meta-framework; drives SSR, server functions, and routing
- `@solidjs/vite-plugin-nitro-2` ^0.1.0 - Nitro v2 integration for server deployment

**Rich Text Editing:**
- `prosemirror-view` ^1.41.4 - Core editor view
- `prosemirror-state` ^1.4.4 - Editor state management
- `prosemirror-model` ^1.25.4 - Document model
- `prosemirror-commands` ^1.7.1 - Editor commands
- `prosemirror-history` ^1.5.0 - Undo/redo
- `prosemirror-keymap` ^1.2.3 - Key bindings
- `prosemirror-schema-basic` ^1.2.4 - Basic schema
- Used in: `src/components/RichEditor.tsx`

**UI/Animation:**
- `lottie-web` ^5.13.0 - Lottie animations (`src/components/Lottie.tsx`)
- `@iconify-icon/solid` ^3.0.3 - Icon components

**Utilities:**
- `spark-md5` ^3.0.2 - MD5 hashing for Gravatar URLs (`src/lib/gravatar.ts`)
- `@solid-primitives/storage` ^4.3.3 - Persisted stores for form data (`src/lib/cfp-store.ts`)
- `dotenv` ^17.2.3 - Environment variable loading

**Infrastructure:**
- `sqlite3` ^5.1.7 (devDependency) - SQLite support, likely for PocketBase tooling
- `baseline-browser-mapping` ^2.9.15 (devDependency) - Browser compatibility tracking

## Database & Backend

**PocketBase** (v0.34.0 in Docker, v0.30.4 local binary):
- Location: `pocketbase/` directory
- Database: SQLite (embedded in PocketBase)
- Migrations: `pocketbase/pb_migrations/` (18 migration files)
- Server hooks: `pocketbase/pb_hooks/` (cfp.pb.js, email.pb.js)
- Data directory: `pocketbase/pb_data/`
- Collections: `users`, `cfp_applicants`, `cfp_submissions`, `cfp_reviews`, `cfp_weight_votes`, `events`
- Type definitions: `src/lib/pocketbase-types.ts`

## Configuration

**TypeScript:**
- Config: `tsconfig.json`
- Target: ESNext, Module: ESNext, moduleResolution: bundler
- Strict mode enabled
- Path aliases: `~/*` maps to `./src/*`, `.velite` maps to `./.velite`

**Vite:**
- Config: `vite.config.ts`
- Plugins: solidStart(), solidSvg(), nitroV2Plugin (preset: "node-server")
- External: `fsevents`, `../pkg`

**Velite (Content):**
- Config: `velite.config.ts`
- Root: `content/`
- Output data: `.velite/`
- Output assets: `public/static/`
- Collections: `pages` (pattern: `pages/**/*.md`, schema with title, slug, MDX content)
- MDX JSX source: `solid-jsx`

**PostCSS:**
- Config: `postcss.config.mjs`
- Plugin: `@tailwindcss/postcss`

**Environment:**
- `.env`, `.env.local`, `.env.production` files present (contents not read)
- Key env vars (from code analysis):
  - `VITE_POCKETBASE_URL` - Client-side PocketBase URL (baked into build)
  - `POCKETBASE_URL` - Server-side PocketBase URL
  - `POCKETBASE_SUPERUSER_EMAIL` / `POCKETBASE_SUPERUSER_PASSWORD` - Admin auth
  - `HIEVENTS_API_URL`, `HIEVENTS_EVENT_ID` - Hi.Events integration
  - `HIEVENTS_API_KEY` or `HIEVENTS_EMAIL` / `HIEVENTS_PASSWORD` / `HIEVENTS_ACCOUNT_ID` - Hi.Events auth

## Build & Output

**Build command:** `velite && vite build`
- Velite processes MDX content first, outputs to `.velite/`
- Vite builds the SolidStart app
- Output: `.output/` directory (Nitro server bundle)
- Dist: `dist/` directory (client + server builds)

**Dev command:** `concurrently "pnpm pocketbase:start" "pnpm start:dev"`
- `start:dev` runs: `concurrently "velite --watch" "vite dev"`
- Three parallel processes: PocketBase server, Velite watcher, Vite dev server

## Deployment

**Docker Compose** (`docker-compose.yml`):
- Two services: `webapp` and `pocketbase`
- Network: `wts_network`

**Webapp container** (`Dockerfile`):
- Multi-stage build (base -> build -> runner)
- Build stage: installs python3/make/g++ for native modules
- Runner: non-root user `solidjs`, runs `node .output/server/index.mjs`
- Exposes port 3000

**PocketBase container** (`pocketbase/Dockerfile`):
- Alpine-based, downloads PocketBase v0.34.0
- Copies migrations and entrypoint script
- Persistent volume: `pocketbase_data` mounted at `/pb/pb_data`
- Exposes port 8090
- Healthcheck: wget to `/api/health`

## Platform Requirements

**Development:**
- Node.js >= 22
- pnpm (corepack enabled)
- PocketBase binary (downloadable via `pnpm pocketbase:download`)

**Production:**
- Docker + Docker Compose
- Persistent storage volume for PocketBase data

---

*Stack analysis: 2026-03-29*
