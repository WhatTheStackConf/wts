# Codebase Concerns

**Analysis Date:** 2026-03-29

## Tech Debt

**Duplicate Auth Implementations:**
- Issue: Two completely separate authentication systems exist side-by-side: a context-based one (`AuthProvider`) and a signal-based one (`useAuth` from `auth-service.ts`). They both wrap PocketBase auth but use different patterns and have different collection name typos.
- Files: `src/lib/auth-context.tsx`, `src/lib/auth-service.ts`
- Impact: `auth-service.ts` references collection `"userrs"` (typo, lines 48 and 71), meaning its `login()` and `register()` functions are broken. The app actually uses `auth-context.tsx` which delegates to `pocketbase-utils.ts`, so `auth-service.ts` appears to be dead code.
- Fix approach: Delete `src/lib/auth-service.ts` entirely. It is unused dead code with bugs.

**Hardcoded Superuser Credentials in Source:**
- Issue: `PocketBaseAdminService` contains hardcoded fallback credentials (`admin@wts.rs` / `supersecret`) when env vars are missing.
- Files: `src/lib/pocketbase-admin-service.ts` (lines 47-49)
- Impact: If env vars are not set, the service silently falls back to default credentials. This is a security risk in production and masks configuration errors.
- Fix approach: Remove hardcoded defaults. Throw an explicit error if `POCKETBASE_SUPERUSER_EMAIL` or `POCKETBASE_SUPERUSER_PASSWORD` are not set.

**Excessive `any` Types:**
- Issue: 45 occurrences of `any` across `src/lib/` files. Many function parameters accept `any` (e.g., `adminCreateEvent(eventData: any)`, `submitReview(data: any)`, `createRecord(collectionName: string, data: any)`).
- Files: `src/lib/admin-actions.ts`, `src/lib/pocketbase-admin-service.ts`, `src/lib/reviewer-actions.ts`, `src/lib/cfp-store.ts`
- Impact: No compile-time type safety for data flowing to/from PocketBase. Bugs only discovered at runtime.
- Fix approach: Define proper interfaces for each collection's create/update payloads. Replace `any` parameters with typed alternatives.

**Manual PocketBase Type Definitions:**
- Issue: The `generate:pb-types` script is a no-op echo message. Types in `src/lib/pocketbase-types.ts` are manually maintained and may drift from the actual PocketBase schema.
- Files: `src/lib/pocketbase-types.ts`, `package.json` (line 16)
- Impact: Type definitions can silently become stale as migrations add/change fields. The `meta` field on `CfpSubmissionRecord` is typed as `any`.
- Fix approach: Use a PocketBase type generation tool (e.g., `pocketbase-typegen`) or at minimum validate types against migrations periodically.

## Security Considerations

**Unauthenticated Admin API Endpoint (CRITICAL):**
- Risk: `src/routes/api/admin.tsx` exposes a POST endpoint that performs arbitrary CRUD operations on ANY PocketBase collection using superuser privileges. There is NO authentication check whatsoever.
- Files: `src/routes/api/admin.tsx`
- Current mitigation: None. Any HTTP client can POST to `/api/admin` and create, update, delete, or read any record in any collection.
- Recommendations: Either delete this file entirely (the `"use server"` functions in `admin-actions.ts` already provide safe admin CRUD with `requireAdmin()` checks) or add `requireAdmin()` authentication. This is the highest priority security fix.

**Unauthenticated User Data API Endpoint (CRITICAL):**
- Risk: `src/routes/api/user-data.tsx` exposes a GET endpoint that reads any record from any PocketBase collection using superuser privileges. The code has a comment "This would typically check authentication first" but never does.
- Files: `src/routes/api/user-data.tsx`
- Current mitigation: None. Any HTTP client can GET `/api/user-data?collection=users` to dump all user records.
- Recommendations: Delete this file or add proper authentication. The admin server actions already cover this functionality safely.

**PocketBase Filter Injection:**
- Risk: Several PocketBase queries interpolate user-controlled values directly into filter strings using template literals, which could allow filter injection.
- Files:
  - `src/lib/pocketbase-utils.ts` (lines 212, 301): `filter: \`user = "${userId}"\``
  - `src/lib/cfp-store.ts` (line 72): `filter: \`user.id = '${pb.authStore.record.id}'\``
  - `src/lib/reviewer-actions.ts` (lines 46, 51): `filter: \`submission = "${id}"\``
- Current mitigation: Values come from PocketBase auth store or function parameters, not raw user input. Server actions use `requireAdmin()`/`requireReviewer()` so the user identity is verified.
- Recommendations: Use PocketBase's parameterized filter syntax where available to prevent injection if input sources change in the future.

**Auth Cookie Not HttpOnly:**
- Risk: The PocketBase auth cookie is set with `httpOnly: false` (line 22 of `auth-cookie.ts`), meaning JavaScript can read the auth token. This exposes the token to XSS attacks.
- Files: `src/lib/auth-cookie.ts` (line 22)
- Current mitigation: SameSite=Lax helps against CSRF. No CSP headers observed.
- Recommendations: Set `httpOnly: true` if server-side token validation (via `requireAdmin`/`requireAuth`) is used for all sensitive operations. The cookie is currently read server-side via `loadFromCookie()` which works with httpOnly cookies.

**Admin Auth Check is Client-Side Token Validation Only:**
- Risk: `requireAdmin()` in `admin-security.ts` validates the JWT token from the cookie using PocketBase's `authStore.isValid` (which checks expiry and signature locally) and checks `record.role`. It does not verify the token against the PocketBase server. If the signing key is compromised or the role was revoked, the check would still pass.
- Files: `src/lib/admin-security.ts`
- Current mitigation: JWT signature validation provides reasonable security for most cases.
- Recommendations: Consider adding a `pb.collection('users').authRefresh()` call for sensitive admin operations to verify token validity server-side.

## Performance Bottlenecks

**Unbounded `getFullList()` Calls:**
- Problem: Multiple locations use `getFullList()` which fetches ALL records from a collection with no pagination limit. As the dataset grows, these become increasingly slow and memory-intensive.
- Files:
  - `src/lib/pocketbase-utils.ts` (lines 211, 286, 300)
  - `src/lib/cfp-store.ts` (lines 71, 225)
  - `src/lib/admin-actions.ts` (lines 72-73, 129-131)
  - `src/routes/admin/weights.tsx` (line 57)
- Cause: PocketBase's `getFullList()` auto-paginates internally but loads everything into memory.
- Improvement path: Use `getList(page, perPage)` with pagination for user-facing views. For admin leaderboard calculation, consider server-side aggregation or caching.

**Hi.Events Attendees Fetched Without Pagination:**
- Problem: `fetchHiEventsAttendees()` fetches only the first page of attendees from the hi.events API (default page size). For events with many attendees, data will be incomplete.
- Files: `src/lib/hievents.ts` (line 265)
- Cause: No pagination loop implemented.
- Improvement path: Implement pagination loop or use `per_page` parameter to fetch all pages.

**Leaderboard Computation is N+1-ish:**
- Problem: `adminFetchLeaderboardData()` fetches all submissions, all reviews, and all weight votes in parallel (good), but then does O(submissions * reviews) filtering in JavaScript.
- Files: `src/lib/admin-actions.ts` (lines 121-193)
- Cause: No server-side aggregation; all computation happens in the server action.
- Improvement path: Acceptable for small-to-medium datasets (< 500 submissions). Consider caching results or computing scores in PocketBase hooks if scale increases.

**NRPlayer Metadata Polling:**
- Problem: The Nightride FM player polls `/api/nr-metadata` every 20 seconds for every connected client. Each poll makes an external HTTP request to `stream.nightride.fm`.
- Files: `src/components/NRPlayer.tsx` (line 78), `src/routes/api/nr-metadata.ts`
- Cause: No server-side caching of metadata responses.
- Improvement path: Add a simple TTL cache (10-15 seconds) in the API route to avoid redundant external requests.

## Fragile Areas

**PocketBase URL Resolution:**
- Files: `src/lib/pocketbase.ts`
- Why fragile: The client-side PocketBase URL resolution has a complex fallback chain: `import.meta.env.VITE_POCKETBASE_URL` -> `process.env.POCKETBASE_URL` -> `window.location.hostname:8090`. The last fallback assumes PocketBase runs on port 8090 of the same host, which only works in development.
- Safe modification: Always ensure `VITE_POCKETBASE_URL` is set as a build arg in Docker (it is) and in `.env` files.
- Test coverage: None.

**CFP Store Persistence:**
- Files: `src/lib/cfp-store.ts`
- Why fragile: The CFP form data is persisted to `localStorage` via `makePersisted`. If the `CfpFormData` interface changes (fields added/removed), existing persisted data from users' browsers may have a stale schema, potentially causing runtime errors or data loss.
- Safe modification: Add schema versioning to the persisted store key (e.g., `cfp-form-data-v2`) when changing the interface.
- Test coverage: None.

**PocketBase Hook Email Sending:**
- Files: `pocketbase/pb_hooks/cfp.pb.js`
- Why fragile: The hook calls `e.next()` after the try/catch block. If `e.next()` itself throws, the submission creation will fail silently. The email HTML is inline with no templating system.
- Safe modification: Keep email sending failures non-blocking (current behavior is correct). Consider moving HTML to a template.
- Test coverage: None.

## Missing Infrastructure

**No Test Suite:**
- Problem: Zero test files exist in the entire codebase. No test framework is configured (no jest, vitest, or playwright config).
- Files: No `*.test.*` or `*.spec.*` files anywhere.
- Risk: All changes are deployed without automated verification. Regressions in auth, admin security, CFP submission flow, and payment integration go undetected.
- Priority: High. At minimum, add tests for `src/lib/admin-security.ts`, `src/lib/admin-actions.ts`, and `src/lib/reviewer-actions.ts`.

**No CI/CD Pipeline:**
- Problem: No `.github/workflows/`, no `Jenkinsfile`, no CI configuration of any kind.
- Risk: No automated linting, type checking, or deployment pipeline. Manual deployments are error-prone.
- Priority: High. Set up at least `tsc --noEmit` and (when tests exist) test execution on push.

**No Linting or Formatting Configuration:**
- Problem: No ESLint, Prettier, Biome, or any code formatting tool is configured.
- Risk: Inconsistent code style across contributors. No automated detection of common JS/TS issues.
- Priority: Medium. Add Biome or ESLint + Prettier.

**No Error Monitoring:**
- Problem: All error handling uses `console.error()` (88 occurrences across 28 files). No Sentry, LogRocket, or similar error tracking service.
- Risk: Production errors are only visible in server logs (if anyone checks them). Client-side errors are invisible.
- Priority: Medium. Add at minimum a server-side error tracking integration.

**No Database Backup Strategy:**
- Problem: PocketBase data is stored in a Docker volume (`pocketbase_data`). No backup script, cron job, or volume backup configuration exists.
- Files: `docker-compose.yml` (line 23)
- Risk: Data loss if the Docker volume is destroyed. PocketBase stores everything in SQLite (`data.db`), which can be corrupted by improper shutdowns.
- Priority: High. Add a scheduled backup of the `pb_data` directory.

## Deployment Concerns

**PocketBase Version Mismatch:**
- Problem: The local PocketBase binary is version 0.30.4 (`pocketbase_0.30.4_linux_amd64.zip`), but the Docker image builds PocketBase version 0.34.0 (from `pocketbase/Dockerfile` ARG).
- Files: `pocketbase/pocketbase_0.30.4_linux_amd64.zip`, `pocketbase/Dockerfile` (line 3)
- Impact: Migrations and hooks may behave differently between local development and Docker/production. PocketBase had breaking changes between 0.30 and 0.34.
- Fix approach: Update the local binary to match the Docker version, or parameterize the version in both places.

**PocketBase Hooks Not Copied in Docker:**
- Problem: The PocketBase Dockerfile copies `pb_migrations` but does NOT copy `pb_hooks/`. The hooks (`cfp.pb.js`, `email.pb.js`) will not be present in the Docker container.
- Files: `pocketbase/Dockerfile` (line 17 copies migrations only)
- Impact: CfP confirmation emails will not be sent in production. The custom email send endpoint will not exist.
- Fix approach: Add `COPY ./pb_hooks /pb/pb_hooks` to `pocketbase/Dockerfile`.

**No Port Exposure for Webapp:**
- Problem: The `docker-compose.yml` `webapp` service does not expose any ports. The app runs on port 3000 inside the container but is not accessible from outside.
- Files: `docker-compose.yml`
- Impact: The webapp cannot be reached without a reverse proxy or adding `ports:` configuration.
- Fix approach: Add `ports: ["3000:3000"]` or document that a reverse proxy is required.

**No Port Exposure for PocketBase:**
- Problem: The `pocketbase` service in `docker-compose.yml` does not expose port 8090. While the webapp can reach it internally via `http://pocketbase:8090`, the PocketBase admin UI is inaccessible.
- Files: `docker-compose.yml`
- Impact: Cannot access PocketBase admin dashboard in Docker deployments without port mapping.
- Fix approach: Intentional if using a reverse proxy; document this. Otherwise add `ports: ["8090:8090"]`.

## Dependencies at Risk

**Alpha Framework Version:**
- Risk: `@solidjs/start` is pinned to `2.0.0-alpha.0` - an alpha release. Breaking changes are expected.
- Files: `package.json` (line 24)
- Impact: Upgrading SolidStart may require significant refactoring. Alpha APIs may be removed or changed.
- Migration plan: Monitor SolidStart releases. Pin to stable when available. The `@solidjs/vite-plugin-nitro-2` dependency is also new/experimental.

**Heavy Rich Text Editor Dependencies:**
- Risk: Six ProseMirror packages are included (`prosemirror-commands`, `prosemirror-history`, `prosemirror-keymap`, `prosemirror-model`, `prosemirror-schema-basic`, `prosemirror-state`, `prosemirror-view`) adding significant bundle weight.
- Files: `package.json` (lines 29-35)
- Impact: Increases client-side bundle size. Unclear if actively used throughout the app or only in one component.
- Migration plan: Verify ProseMirror is still actively used. If only needed in one route, ensure it is lazy-loaded.

**`sqlite3` in devDependencies:**
- Risk: Native `sqlite3` module requires Python 3, make, and g++ to compile (visible in Dockerfile build stage). This slows Docker builds and adds attack surface.
- Files: `package.json` (line 51)
- Impact: Build failures on systems without native build tools. The `--dangerously-allow-all-builds` flag in `pnpm install` is used to work around this.
- Migration plan: Evaluate if `sqlite3` is actually used (PocketBase handles its own SQLite). If unused, remove it. If needed, consider `better-sqlite3` which has prebuilt binaries.

## Test Coverage Gaps

**All Application Code is Untested:**
- What's not tested: Authentication flows, admin authorization, CFP submission pipeline, reviewer actions, hi.events integration, PocketBase CRUD operations, all UI components.
- Files: Every file in `src/lib/` and `src/routes/`
- Risk: Security regressions (especially in `admin-security.ts`), data corruption in CFP submission flow, broken OAuth flows after PocketBase upgrades.
- Priority: High. Start with:
  1. `src/lib/admin-security.ts` - auth guard functions
  2. `src/routes/api/admin.tsx` - the unauthenticated endpoint (after fixing it)
  3. `src/lib/admin-actions.ts` - server actions with auth checks
  4. `src/lib/hievents.ts` - external API integration

---

*Concerns audit: 2026-03-29*
