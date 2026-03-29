# External Integrations

**Analysis Date:** 2026-03-29

## APIs & External Services

**Hi.Events (Ticketing):**
- Purpose: Fetch ticket/product listings and attendee data for the event
- Client: Custom fetch-based client in `src/lib/hievents.ts`
- Auth: API key (`HIEVENTS_API_KEY`) or email/password login (`HIEVENTS_EMAIL`, `HIEVENTS_PASSWORD`, `HIEVENTS_ACCOUNT_ID`)
- Token caching: In-memory with expiry buffer (5 min before actual expiry)
- Server-only: All functions use `"use server"` directive
- Endpoints consumed:
  - `GET /api/events/{event_id}/` - Fetch event products/tickets
  - `GET /api/events/{event_id}/attendees` - Fetch attendees (admin-protected via `requireAuth`)
  - `POST /api/auth/login` - Token authentication fallback
- Security: `fetchHiEventsAttendees` enforces admin role for listing all attendees, or email match for self-lookup

**NightRide FM (Internet Radio):**
- Purpose: Stream metadata for an embedded radio player
- Two API endpoints proxied through the app:
  - `src/routes/api/nr-metadata.ts` - `GET /api/nr-metadata` - Fetches current track info from Icecast (`https://stream.nightride.fm/status-json.xsl`)
  - `src/routes/api/nr-metadata-sse.ts` - `GET /api/nr-metadata-sse` - Proxies SSE stream from `https://nightride.fm/api/v2/messenger/lp`
- No authentication required
- Client component: `src/components/NRPlayer.tsx` (client-only loaded)

**Gravatar:**
- Purpose: User avatar images based on email hash
- Implementation: `src/lib/gravatar.ts`
- Uses `spark-md5` for MD5 hashing
- URL pattern: `https://www.gravatar.com/avatar/{md5}?d=mp`

## Data Storage

**Database:**
- PocketBase (SQLite-backed)
  - Server-side connection: `POCKETBASE_URL` env var (default: `http://localhost:8090`)
  - Client-side connection: `VITE_POCKETBASE_URL` env var (falls back to `window.location` hostname with port 8090)
  - Client singleton: `src/lib/pocketbase.ts`
  - Admin service (server-only singleton): `src/lib/pocketbase-admin-service.ts`
  - Collections:
    - `users` - User accounts with roles (user/reviewer/admin)
    - `cfp_applicants` - Call for Papers applicant profiles
    - `cfp_submissions` - Talk proposals
    - `cfp_reviews` - Reviewer scores (6 criteria, 1-5 scale each)
    - `cfp_weight_votes` - Criteria weight voting by reviewers
    - `events` - Event management (admin CRUD)

**File Storage:**
- PocketBase built-in file storage (via record attachments)

**Content (Static):**
- Velite-processed MDX files in `content/pages/` (about, code-of-conduct, partnerships, privacy, terms)
- Output: `.velite/` directory (build-time generated)

**Caching:**
- Hi.Events auth token: in-memory cache with TTL (`src/lib/hievents.ts`)
- CFP form data: browser localStorage via `@solid-primitives/storage` (`src/lib/cfp-store.ts`, key: `cfp-form-data`)

## Authentication & Identity

**Auth Provider:** PocketBase built-in auth

**Methods:**
- Email/password registration and login (`src/lib/pocketbase-utils.ts`: `login`, `register`)
- GitHub OAuth2 (`src/lib/pocketbase-utils.ts`: `loginWithGithub`)
- Google OAuth2 (`src/lib/pocketbase-utils.ts`: `loginWithGoogle`)

**Email verification:** Required before login is permitted. Enforced in `src/lib/auth-context.tsx` - unverified users are treated as logged out.

**Session management:**
- Client-side: PocketBase SDK `authStore` + browser cookie (`pb_auth`)
- Cookie handling: `src/lib/auth-cookie.ts` (SameSite=Lax, httpOnly=false, long expiry)
- Server-side validation: Cookie parsed via `pb.authStore.loadFromCookie()` in `src/lib/admin-security.ts`

**Authorization (role-based):**
- Roles defined in `src/lib/pocketbase-types.ts`: `"user" | "reviewer" | "admin"`
- Guards in `src/lib/admin-security.ts`:
  - `requireAuth()` - Any authenticated user
  - `requireAdmin()` - Admin role only
  - `requireReviewer()` - Reviewer or admin role
- Server functions use `"use server"` directive with these guards

**Password reset:**
- `requestPasswordReset` and `confirmPasswordReset` in `src/lib/pocketbase-utils.ts`
- Routes: `src/routes/forgot-password.tsx`, `src/routes/confirm-password-reset.tsx`

## PocketBase Server Hooks

**CFP Confirmation Email** (`pocketbase/pb_hooks/cfp.pb.js`):
- Trigger: `onRecordAfterCreateSuccess` on `cfp_submissions`
- Action: Sends confirmation email to the submitter with proposal title
- Uses PocketBase's built-in mailer

**Custom Email Endpoint** (`pocketbase/pb_hooks/email.pb.js`):
- Route: `POST /custom/send-email`
- Admin-only: Checks for valid admin in request context
- Sends arbitrary emails (to, subject, html) via PocketBase mailer

## Analytics

**Umami:**
- Added per git history (commit `6abbb91`)
- Likely integrated via script tag in layout (not visible in current `Layout.tsx` - may be in `index.html` or `public/`)

## SSE / Real-time Endpoints

**NightRide FM SSE proxy:**
- Endpoint: `GET /api/nr-metadata-sse` (`src/routes/api/nr-metadata-sse.ts`)
- Proxies `https://nightride.fm/api/v2/messenger/lp` as Server-Sent Events
- Headers: `text/event-stream`, `no-cache`, `X-Accel-Buffering: no`

**PocketBase Realtime:**
- PocketBase provides built-in SSE realtime subscriptions via its SDK
- Used implicitly through `pb.authStore.onChange()` in `src/lib/auth-context.tsx`

## Environment Configuration

**Required env vars (server-side):**
- `POCKETBASE_URL` - PocketBase server URL for server-side operations
- `POCKETBASE_SUPERUSER_EMAIL` - PocketBase admin email for server-side admin service
- `POCKETBASE_SUPERUSER_PASSWORD` - PocketBase admin password for server-side admin service

**Required env vars (build-time, baked into client):**
- `VITE_POCKETBASE_URL` - PocketBase URL exposed to client-side code

**Optional env vars (Hi.Events integration):**
- `HIEVENTS_API_URL` - Hi.Events instance base URL
- `HIEVENTS_EVENT_ID` - Event ID for ticket/attendee queries
- `HIEVENTS_API_KEY` - API key auth (preferred)
- `HIEVENTS_EMAIL` - Fallback email/password auth
- `HIEVENTS_PASSWORD` - Fallback email/password auth
- `HIEVENTS_ACCOUNT_ID` - Required for email/password auth

**Docker-specific env vars:**
- `PUBLIC_POCKETBASE_URL` - Maps to `VITE_POCKETBASE_URL` in `docker-compose.yml`

**Env files present:**
- `.env` - Base environment
- `.env.local` - Local overrides
- `.env.production` - Production values

## Webhooks & Callbacks

**Incoming:**
- OAuth2 callback handling via PocketBase SDK (`authWithOAuth2` for GitHub/Google)
- PocketBase hooks act as internal webhooks (cfp submission -> email)

**Outgoing:**
- Transactional emails via PocketBase mailer (CFP confirmation, custom admin emails)

---

*Integration audit: 2026-03-29*
