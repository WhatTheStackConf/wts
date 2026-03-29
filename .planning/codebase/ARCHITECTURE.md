# Architecture

**Analysis Date:** 2026-03-29

## Pattern Overview

**Overall:** SolidStart SSR/Hybrid Application with PocketBase Backend

**Key Characteristics:**
- SolidStart (v2 alpha) with file-based routing and Nitro v2 server engine
- Hybrid rendering: SSR for initial page load, client-only (`clientOnly()`) for interactive/auth-gated pages
- PocketBase as the sole database and auth provider, accessed via two distinct paths: client-side SDK and server-side admin service
- Velite-based MDX content pipeline for static pages (about, terms, privacy, etc.)
- `"use server"` directives for server functions; no separate REST API layer beyond a few API routes

## Layers

**Presentation Layer (Routes + Components):**
- Purpose: Render pages, handle user interaction, manage local UI state
- Location: `src/routes/`, `src/components/`, `src/layouts/`
- Contains: Page components, reusable UI components, layout wrappers
- Depends on: Auth context, PocketBase client, cfp-store, lib utilities
- Used by: SolidStart file-based router

**Auth Layer:**
- Purpose: Manage authentication state, provide auth context to all components
- Location: `src/lib/auth-context.tsx`, `src/lib/auth-cookie.ts`, `src/lib/pocketbase-utils.ts`
- Contains: AuthProvider context, login/logout/register functions, cookie sync
- Depends on: PocketBase client SDK
- Used by: All authenticated pages and components

**Data Access Layer (Client-side):**
- Purpose: Direct PocketBase SDK calls from browser for user-scoped operations
- Location: `src/lib/pocketbase.ts`, `src/lib/pocketbase-utils.ts`, `src/lib/cfp-store.ts`
- Contains: CRUD operations for cfp_applicants, cfp_submissions, user auth
- Depends on: PocketBase JS SDK singleton (`src/lib/pocketbase.ts`)
- Used by: CFP form steps, user profile, submission management

**Data Access Layer (Server-side Admin):**
- Purpose: Privileged PocketBase operations using superuser credentials, bypassing collection rules
- Location: `src/lib/pocketbase-admin-service.ts`, `src/lib/admin-actions.ts`, `src/lib/reviewer-actions.ts`
- Contains: `PocketBaseAdminService` singleton class, server functions with `"use server"` directive
- Depends on: PocketBase JS SDK (separate server-side instance), env vars for superuser creds
- Used by: Admin dashboard, reviewer portal, API routes

**Security Layer:**
- Purpose: Request-level auth validation for server functions
- Location: `src/lib/admin-security.ts`
- Contains: `requireAdmin()`, `requireAuth()`, `requireReviewer()` guards
- Depends on: Request cookies (via `getRequestEvent()`), PocketBase auth token validation
- Used by: All `"use server"` functions in admin-actions and reviewer-actions

**Content Layer:**
- Purpose: Markdown-based static pages compiled at build time
- Location: `content/pages/`, `.velite/` (generated), `velite.config.ts`
- Contains: MDX content for about, terms, privacy, code-of-conduct, partnerships
- Depends on: Velite build tool, solid-jsx runtime
- Used by: `src/routes/[slug].tsx` catch-all route

**External Integration Layer:**
- Purpose: Third-party API integration (ticketing)
- Location: `src/lib/hievents.ts`
- Contains: hi.events API client for ticket/attendee data
- Depends on: hi.events REST API, env vars for auth
- Used by: `src/routes/tickets.tsx`, `src/routes/admin/tickets.tsx`

## Data Flow

**Client-Side Auth Flow:**

1. User submits credentials on `/login` page (`src/routes/login.tsx`)
2. `AuthProvider` calls `loginUtil()` in `src/lib/pocketbase-utils.ts`
3. PocketBase SDK authenticates via `pb.collection("users").authWithPassword()`
4. Token stored in PocketBase `authStore` (localStorage) AND synced to cookie via `setAuthCookie()` in `src/lib/auth-cookie.ts`
5. Cookie sync enables server functions to validate auth via `getRequestEvent()` headers

**CFP Submission Flow:**

1. User navigates through multi-step form: `src/routes/cfp/01-intro.tsx` through `06-confirmation.tsx`
2. Form data persisted in `cfp-store` (`src/lib/cfp-store.ts`) using `makePersisted(createStore(...))` backed by localStorage
3. Step 2 creates/updates `cfp_applicants` record via direct PocketBase client SDK call
4. Step 6 calls `submitProposal()` which creates/updates `cfp_submissions` record via direct PocketBase client SDK call
5. All client-side calls use the user's own auth token (collection rules enforced by PocketBase)

**Admin/Reviewer Server Action Flow:**

1. Admin/reviewer triggers action in UI (e.g., fetch leaderboard in `src/routes/admin/proposals.tsx`)
2. UI calls exported server function (e.g., `adminFetchLeaderboardData()` in `src/lib/admin-actions.ts`)
3. Server function calls `requireAdmin()` or `requireReviewer()` from `src/lib/admin-security.ts`
4. Security guard reads cookie from `getRequestEvent()`, creates fresh PocketBase instance, validates token and role
5. Server function uses `getAdminPB()` singleton to execute privileged PocketBase operations
6. Result returned to client as serialized JSON

**MDX Content Flow:**

1. Velite processes `content/pages/*.md` at build time (configured in `velite.config.ts`)
2. Compiled MDX output stored in `.velite/` directory
3. `src/routes/[slug].tsx` imports `pages` from `.velite` and matches by slug param
4. `MDXContent` component (`src/components/MDXContent.tsx`) runs compiled MDX via `@mdx-js/mdx` `runSync()` with `solid-jsx` runtime

**State Management:**
- **Auth state:** SolidJS Context (`AuthProvider` in `src/lib/auth-context.tsx`) wrapping the entire app via `src/app.tsx`
- **CFP form state:** SolidJS Store with localStorage persistence via `@solid-primitives/storage` `makePersisted()` in `src/lib/cfp-store.ts`
- **UI state:** Local signals (`createSignal`) within individual components
- **Server data:** `createResource()` for async data fetching in route components (e.g., reviewer dashboard, tickets page)

## Key Abstractions

**PocketBase Client Singleton:**
- Purpose: Single PocketBase instance for all client-side operations
- Location: `src/lib/pocketbase.ts`
- Pattern: Module-level singleton, URL resolved from `VITE_POCKETBASE_URL` env var or auto-detected from window.location

**PocketBaseAdminService:**
- Purpose: Server-side privileged PocketBase operations
- Location: `src/lib/pocketbase-admin-service.ts`
- Pattern: Lazy-initialized singleton class with superuser auth; auto-initializes on first operation call
- Methods: `createRecord()`, `updateRecord()`, `deleteRecord()`, `fetchAllRecords()`, `fetchRecordById()`, `batchCreate()`, `rawDatabaseOperation()`

**AuthProvider Context:**
- Purpose: App-wide reactive auth state
- Location: `src/lib/auth-context.tsx`
- Pattern: SolidJS Context with `createSignal` for reactive user record; exposes `isAuthenticated()`, `login()`, `logout()`, `githubLogin()`, `googleLogin()`
- Enforcement: Unverified users treated as logged out (verification check on mount and onChange)

**Layout Component:**
- Purpose: Consistent page shell with navbar, footer, background effects
- Location: `src/layouts/Layout.tsx`
- Pattern: Wrapper component accepting `title`, `description`, `children` props; includes `Navbar`, `CodeBackground`, `Footer`, `NewsletterPopup`

**CfpStepLayout:**
- Purpose: Consistent layout for CFP multi-step form pages
- Location: `src/components/cfp/CfpStepLayout.tsx`
- Pattern: Wraps `Layout` with step indicator and form container

## Entry Points

**Client Entry:**
- Location: `src/entry-client.tsx`
- Triggers: Browser hydration
- Responsibilities: Mounts `StartClient` to `#app` DOM element

**Server Entry:**
- Location: `src/entry-server.tsx`
- Triggers: SSR request handling
- Responsibilities: Creates server handler with HTML document shell, includes Umami analytics script, loads `dotenv/config`

**App Root:**
- Location: `src/app.tsx`
- Triggers: Both client and server rendering
- Responsibilities: Initializes PocketBase, wraps app in `Router` > `MetaProvider` > `AuthProvider` > `Suspense`, uses `FileRoutes` for file-based routing

## Error Handling

**Strategy:** Try/catch with console.error logging; errors bubble up as thrown exceptions or returned error objects

**Patterns:**
- Server functions return `{ success: boolean, data?: any, error?: string }` objects (see `src/lib/admin-actions.ts`)
- Client-side PocketBase utils throw errors after logging (see `src/lib/pocketbase-utils.ts`)
- Auth errors show inline via `createSignal`-based error state in form components
- Security guards (`requireAdmin`, `requireAuth`, `requireReviewer`) throw errors that propagate to server function callers

## Cross-Cutting Concerns

**Logging:** `console.error()` and `console.warn()` throughout; no structured logging framework

**Validation:**
- Client-side form validation in CFP step components (manual checks with error signals)
- Server-side auth/role validation via `src/lib/admin-security.ts` guards
- PocketBase collection rules enforce data-level access control
- CFP deadline check via `isCfpOpen()` in `src/lib/cfp-utils.ts`

**Authentication:**
- PocketBase auth with OAuth2 (GitHub, Google) and email/password
- Client stores token in PocketBase `authStore` (localStorage) + HTTP cookie for SSR
- Server reads cookie from request headers, creates ephemeral PocketBase instance to validate
- Role-based access: `user`, `reviewer`, `admin` roles on `UserRecord`

**Rendering Boundaries:**
- Most interactive/auth-gated pages use `clientOnly()` wrapper: admin pages, reviewer pages, CFP steps, login/register
- Static content pages (slug routes) render server-side
- `Navbar` uses `clientOnly()` for sub-components (`LoginMenu`, `Lottie`, `MultiLineCyberpunkText`)
- `Layout` uses `clientOnly()` for `NewsletterPopup` and `NRPlayer`

---

*Architecture analysis: 2026-03-29*
