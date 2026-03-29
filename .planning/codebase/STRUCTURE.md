# Codebase Structure

**Analysis Date:** 2026-03-29

## Directory Layout

```
wts/
├── content/                # Velite MDX content source
│   └── pages/              # Markdown pages (about, terms, privacy, etc.)
├── dist/                   # Vite build output (client + server bundles)
│   ├── client/             # Client-side assets
│   └── server/             # Server-side bundle
├── .nitro/                 # Nitro generated types
├── .output/                # Nitro production output
├── .planning/              # Project planning documents
│   └── codebase/           # Codebase analysis docs
├── .velite/                # Velite build output (compiled MDX data)
├── pocketbase/             # PocketBase backend
│   ├── pb_data/            # PocketBase SQLite data (gitignored contents)
│   ├── pb_hooks/           # PocketBase JS hooks (server-side extensions)
│   └── pb_migrations/      # PocketBase schema migrations
├── public/                 # Static assets served at root
│   ├── fonts/              # Web fonts
│   └── static/             # Velite-generated static assets
├── scripts/                # Development helper scripts
├── src/                    # Application source code
│   ├── assets/             # Imported assets (bundled by Vite)
│   ├── components/         # Reusable UI components
│   ├── layouts/            # Page layout wrappers
│   ├── lib/                # Shared logic, services, stores
│   ├── routes/             # File-based routes (SolidStart)
│   └── styles/             # Global CSS
├── docker-compose.yml      # Docker orchestration
├── Dockerfile              # App container definition
├── package.json            # Dependencies and scripts
├── postcss.config.mjs      # PostCSS config (Tailwind)
├── tsconfig.json           # TypeScript configuration
├── velite.config.ts        # Velite content pipeline config
└── vite.config.ts          # Vite + SolidStart build config
```

## Directory Purposes

**`src/routes/`:**
- Purpose: SolidStart file-based routing; each file becomes a route
- Contains: Page components and API endpoints
- Key files:
  - `src/routes/index.tsx`: Home page (`/`)
  - `src/routes/[slug].tsx`: Dynamic MDX content pages (`/about`, `/terms`, `/privacy`, etc.)
  - `src/routes/[...404].tsx`: Catch-all 404 page
  - `src/routes/login.tsx`: Login page
  - `src/routes/register.tsx`: Registration page
  - `src/routes/tickets.tsx`: Ticket purchase page
  - `src/routes/forgot-password.tsx`: Password reset request
  - `src/routes/confirm-password-reset.tsx`: Password reset confirmation
  - `src/routes/confirm-verification.tsx`: Email verification confirmation

**`src/routes/cfp/`:**
- Purpose: Multi-step Call for Papers submission wizard
- Contains: 6 numbered step pages + submissions list
- Key files:
  - `src/routes/cfp/01-intro.tsx` through `src/routes/cfp/06-confirmation.tsx`: Sequential form steps
  - `src/routes/cfp/my-submissions.tsx`: User's submitted proposals

**`src/routes/admin/`:**
- Purpose: Admin dashboard and management pages
- Contains: Admin-only pages (client-only rendered, role-gated)
- Key files:
  - `src/routes/admin/index.tsx`: Admin dashboard with navigation cards
  - `src/routes/admin/proposals.tsx`: Leaderboard/ranked submissions view
  - `src/routes/admin/users.tsx`: User management
  - `src/routes/admin/tickets.tsx`: Attendee list from hi.events
  - `src/routes/admin/weights.tsx`: Review scoring weight configuration

**`src/routes/reviewer/`:**
- Purpose: Reviewer portal for evaluating CFP submissions
- Contains: Reviewer-only pages (role-gated)
- Key files:
  - `src/routes/reviewer/index.tsx`: Reviewer dashboard with submission list
  - `src/routes/reviewer/[id].tsx`: Individual submission review page

**`src/routes/user/`:**
- Purpose: Authenticated user pages
- Key files:
  - `src/routes/user/index.tsx`: User dashboard
  - `src/routes/user/profile.tsx`: Profile management

**`src/routes/api/`:**
- Purpose: Server-side API endpoints (REST-style)
- Key files:
  - `src/routes/api/admin.tsx`: Generic admin CRUD endpoint (POST handler)
  - `src/routes/api/user-data.tsx`: Generic data fetch endpoint (GET handler)
  - `src/routes/api/nr-metadata.ts`: NR metadata endpoint
  - `src/routes/api/nr-metadata-sse.ts`: NR metadata SSE stream

**`src/components/`:**
- Purpose: Reusable UI components
- Contains: Visual components, form elements, layout pieces
- Key files:
  - `src/components/Navbar.tsx`: Main navigation bar (desktop + mobile drawer)
  - `src/components/Footer.tsx`: Site footer
  - `src/components/Hero.tsx`: Landing page hero section
  - `src/components/LoginMenu.tsx`: Auth-aware login/profile dropdown
  - `src/components/MDXContent.tsx`: MDX renderer using solid-jsx
  - `src/components/RichEditor.tsx`: ProseMirror-based rich text editor
  - `src/components/SmartArea.tsx`: Smart textarea component
  - `src/components/NewsletterPopup.tsx`: Newsletter signup popup
  - `src/components/NRPlayer.tsx`: NR audio/media player
  - `src/components/CodeBackground.tsx`: Animated code background effect
  - `src/components/HologramButton.tsx`: Styled CTA button
  - `src/components/Lottie.tsx`: Lottie animation wrapper
  - `src/components/CyberpunkText.tsx`: Text effect component
  - `src/components/MultiLineCyberpunkText.tsx`: Multi-line text effect
  - `src/components/AlternativelyTyping.tsx`: Typing animation component
  - `src/components/ViewTransition.tsx`, `src/components/ViewTransitionProvider.tsx`: View transition utilities

**`src/components/admin/`:**
- Purpose: Admin-specific UI components
- Key files:
  - `src/components/admin/AdminProposalsTable.tsx`: Proposals/leaderboard table
  - `src/components/admin/AdminUsersTable.tsx`: User management table

**`src/components/cfp/`:**
- Purpose: CFP form shared components
- Key files:
  - `src/components/cfp/CfpStepIndicator.tsx`: Progress indicator for form steps
  - `src/components/cfp/CfpStepLayout.tsx`: Shared layout for CFP step pages

**`src/layouts/`:**
- Purpose: Page layout wrappers
- Key files:
  - `src/layouts/Layout.tsx`: Main layout with Navbar, Footer, CodeBackground, meta tags

**`src/lib/`:**
- Purpose: Shared business logic, services, stores, types, utilities
- Contains: PocketBase clients, auth, data stores, server actions, integrations
- Key files:
  - `src/lib/pocketbase.ts`: Client-side PocketBase singleton instance
  - `src/lib/pocketbase-utils.ts`: Auth functions (login, register, logout, CRUD for cfp collections)
  - `src/lib/pocketbase-types.ts`: TypeScript interfaces for PocketBase collections (UserRecord, CfpApplicantRecord, CfpSubmissionRecord, CfpReviewRecord, AuthData)
  - `src/lib/pocketbase-admin-service.ts`: Server-side PocketBase admin service class (superuser operations)
  - `src/lib/admin-actions.ts`: Server functions for admin operations (`"use server"`)
  - `src/lib/admin-security.ts`: Auth guards (`requireAdmin`, `requireAuth`, `requireReviewer`)
  - `src/lib/reviewer-actions.ts`: Server functions for reviewer operations (`"use server"`)
  - `src/lib/auth-context.tsx`: SolidJS AuthProvider context
  - `src/lib/auth-cookie.ts`: Cookie management for SSR auth sync
  - `src/lib/cfp-store.ts`: Persisted SolidJS store for CFP form state
  - `src/lib/cfp-utils.ts`: CFP deadline/availability utilities
  - `src/lib/hievents.ts`: hi.events ticketing API integration (server-side)
  - `src/lib/gravatar.ts`: Gravatar URL generation
  - `src/lib/auth-service.ts`: Additional auth service utilities

**`src/styles/`:**
- Purpose: Global CSS
- Key files:
  - `src/styles/app.css`: Tailwind CSS v4 imports, DaisyUI theme config (custom "wts" dark theme), custom utility classes

**`src/assets/`:**
- Purpose: Assets imported and bundled by Vite
- Contains: SVG images, Lottie JSON animations
- Key files:
  - `src/assets/images/LogoSolo.svg`: Logo SVG (imported as component via vite-plugin-solid-svg)
  - `src/assets/animations/WTS.json`: Lottie animation data for navbar logo

**`content/pages/`:**
- Purpose: MDX source files for static content pages
- Contains: `about.md`, `code-of-conduct.md`, `partnerships.md`, `privacy.md`, `terms.md`
- Rendered by: `src/routes/[slug].tsx` via Velite pipeline

**`pocketbase/`:**
- Purpose: PocketBase backend instance and configuration
- Key files:
  - `pocketbase/pocketbase`: PocketBase binary
  - `pocketbase/pb_migrations/`: Schema migration files
  - `pocketbase/pb_hooks/`: Server-side JavaScript hooks
  - `pocketbase/start-local.sh`: Local dev startup script
  - `pocketbase/get-pocketbase.sh`: Binary download script
  - `pocketbase/create-superuser.sh`: Superuser creation script
  - `pocketbase/Dockerfile`: PocketBase container definition
  - `pocketbase/entrypoint.sh`: Container entrypoint

**`public/`:**
- Purpose: Static files served at web root
- Contains: Favicon, background images, fonts, video
- Key files:
  - `public/favicon.svg`: Site favicon
  - `public/bg.webp`, `public/bg.png`: Background images
  - `public/wts-square-web.webm`: Video asset
  - `public/fonts/`: Web font files
  - `public/static/`: Velite-generated static assets (images from content)

**`scripts/`:**
- Purpose: Development helper scripts
- Key files:
  - `scripts/dev-with-pocketbase.ts`: Development script for concurrent PB + app startup

## Key File Locations

**Entry Points:**
- `src/app.tsx`: Application root component (Router, AuthProvider, FileRoutes)
- `src/entry-client.tsx`: Client-side hydration entry
- `src/entry-server.tsx`: SSR handler with HTML document shell

**Configuration:**
- `vite.config.ts`: Vite build config with SolidStart, SVG, and Nitro v2 plugins
- `velite.config.ts`: Content pipeline (MDX pages from `content/` to `.velite/`)
- `postcss.config.mjs`: PostCSS with Tailwind CSS plugin
- `tsconfig.json`: TypeScript configuration
- `docker-compose.yml`: Docker orchestration for app + PocketBase
- `Dockerfile`: Application container

**Core Logic:**
- `src/lib/pocketbase-admin-service.ts`: Server-side privileged data access
- `src/lib/admin-actions.ts`: Admin server functions
- `src/lib/reviewer-actions.ts`: Reviewer server functions
- `src/lib/cfp-store.ts`: CFP form state management and submission logic
- `src/lib/hievents.ts`: Ticketing integration

**Types:**
- `src/lib/pocketbase-types.ts`: All PocketBase collection interfaces
- `src/global.d.ts`: Global type declarations (SVG module)

## Naming Conventions

**Files:**
- Route pages: `kebab-case.tsx` (e.g., `forgot-password.tsx`, `confirm-verification.tsx`)
- CFP steps: `NN-name.tsx` (e.g., `01-intro.tsx`, `02-personal.tsx`)
- Components: `PascalCase.tsx` (e.g., `Navbar.tsx`, `HologramButton.tsx`)
- Lib modules: `kebab-case.ts` (e.g., `auth-context.tsx`, `pocketbase-admin-service.ts`)
- API routes: `kebab-case.ts` or `kebab-case.tsx` in `src/routes/api/`

**Directories:**
- Lowercase, hyphenated: `cfp/`, `admin/`, `reviewer/`, `user/`
- Feature-grouped components: `components/admin/`, `components/cfp/`

## Where to Add New Code

**New Page Route:**
- Add file to `src/routes/` following file-based routing conventions
- Use `Layout` wrapper from `src/layouts/Layout.tsx`
- If auth-gated, wrap export with `clientOnly()` and check auth via `useAuth()`

**New API Endpoint:**
- Add file to `src/routes/api/` with exported HTTP method handlers (GET, POST, etc.)
- Include default component export returning `null` to satisfy SolidStart routing

**New Server Function:**
- Add to existing lib file or create new `src/lib/{feature}-actions.ts`
- Mark functions with `"use server"` directive
- Use `requireAdmin()`, `requireAuth()`, or `requireReviewer()` from `src/lib/admin-security.ts`
- Use `getAdminPB()` for privileged PocketBase operations

**New Reusable Component:**
- Add to `src/components/` as `PascalCase.tsx`
- For feature-specific components, use subdirectory: `src/components/{feature}/`

**New PocketBase Collection Type:**
- Add interface to `src/lib/pocketbase-types.ts` extending `RecordModel`
- Add type guard function following existing pattern
- Add to `CollectionRecord` union type

**New Static Content Page:**
- Add markdown file to `content/pages/{slug}.md` with `title` and `slug` frontmatter
- Automatically rendered by `src/routes/[slug].tsx`

**New External Integration:**
- Add to `src/lib/{service-name}.ts`
- Use `"use server"` for functions requiring secrets/env vars
- Add appropriate security guards if sensitive

**Shared Utilities:**
- Add to `src/lib/` as `kebab-case.ts`

## Special Directories

**`.velite/`:**
- Purpose: Compiled MDX content data (pages collection)
- Generated: Yes, by Velite at build time and during `--watch`
- Committed: No (generated output)

**`.nitro/`:**
- Purpose: Nitro server engine generated types
- Generated: Yes, by Nitro/Vite
- Committed: No

**`.output/`:**
- Purpose: Nitro production build output
- Generated: Yes, by `vite build`
- Committed: No

**`dist/`:**
- Purpose: Vite build output (client + server bundles)
- Generated: Yes, by `vite build`
- Committed: No

**`pocketbase/pb_data/`:**
- Purpose: PocketBase SQLite database files
- Generated: Yes, by PocketBase runtime
- Committed: Partially (auxiliary.db tracked, main data gitignored)

**`pocketbase/pb_migrations/`:**
- Purpose: PocketBase schema migrations
- Generated: By PocketBase when schema changes
- Committed: Yes

---

*Structure analysis: 2026-03-29*
