# Registration browser checkpoint — 2026-09-12

Isolated worktree: `/home/darko/.local/state/wts/coordinator-rosters-release`, base `d114927eef3a28ffe18ebfde9bc6952adf1cc13f`. No commit, deployment, production configuration, station or schema changes. Main working tree untouched.

## Implemented

- Client-only `/registrations`, admin/checkin_operator guard, fixed safe post-login destination, native role-gated desktop/mobile navigation.
- Programme selector from conference-week configured freeTicketProductId values: event 5 products 15/16/17. Local name/email search, filtered/total count, manual refresh and last successful timestamp. Clears prior roster during refresh/failure. Auth scope disposal aborts and fences late responses.
- `/api/registrations` uses POST solely for existing same-origin cookie/session read conventions; all HiEvents requests are GET. Revalidates live operator identity/role before and after upstream await. Explicit validated DTO; no capabilities, orders, notes or check-in array returned.
- Existing normalized operational privacy boundary extended to page/API (case, encoded spelling, trailing slashes): no analytics/third-party shell, private no-store, no-referrer, noindex and restrictive CSP.
- Read-through only; no DB mirror, admission, label, printing, station binding or coordinator calls. Ticket ACTIVE/CANCELLED copied only from authoritative status; other statuses Unknown. Arrival omitted: event-wide list-specific check-ins cannot prove this programme's arrival.

## Verified

- Privately read deployed product category metadata: products 15/16/17 and event 5 match conference-week names. No credentials/real attendee data emitted or saved.
- Actual adapter live GET test passed complete pagination/schema/projection. Unsorted upstream traversal initially duplicated/omitted a row despite stable totals. Inspected pinned upstream QueryParamsDTO, GetAttendeesAction, GetAttendeesHandler and AttendeeRepository at `cfbf468bb5b1b4ed3cba18184edc2e1094318f17`; implemented supported `sort_by=id&sort_direction=asc`, then validated monotonic IDs on every row. Sorted complete live traversal passed. No guessed product filters.
- 31 tests passed across registrations unit, opt-in private live contract, route authorization and checkin HTTP. Unit covers roles, unauthenticated/cross-origin denial, post-await revocation, no-station success, failure vs empty, GET-only pagination/projection, duplicate/incomplete rejection and normalized privacy/native links.
- Production `velite` + `vp build` passed; server bundle syntax check passed; `tsc --project tsconfig.checkin-runtime.json` passed.
- Full typecheck has only existing missing dependencies in public-api files (`openapi-types`, swagger-parser, ajv, ajv-formats plus consequential typing). No registration diagnostics after fixes.
- pnpm 11 tried to reconcile external node_modules and safely refused; used verified installed direct `.bin/vp`/`.bin/tsc` shims instead. Vite test plugin logs Nitro dev-entry warning / shutdown timeout despite successful tests. No dependency purge/install or root writes.

## Verification continuation checkpoint

- Full typecheck reproduced five diagnostics caused by missing public-api dev dependencies in the shared main node_modules, not registration types. Removed only this worktree's node_modules symlink and successfully installed its frozen pnpm lockfile locally; main dependencies untouched.
- Read every new feature/test file and reviewed authorization refresh before/after await, source projection, error-vs-empty handling and privacy headers. Added synthetic event-5 fixture rows and real mobile browser tests covering both allowed roles without station bindings, ordinary/reviewer/anonymous denial, programme selection/search/refresh, unavailable state and live PocketBase role-revocation redaction. No production access.
- `pnpm typecheck` and `pnpm exec tsc --project tsconfig.checkin-browser.json` now both PASS with genuine frozen-lockfile dependencies; no source suppression or public-api edits needed.
- Focused `vp test run --maxWorkers=4` over registrations, opt-in registrations-live, route-authorization and checkin-http: 33 PASS, 1 deliberately SKIPPED live test. Added populated late-response actor-switch redaction, strict DTO rejection, foreign-event, malformed included row and oversize rejection cases.
- `node scripts/run-checkin-browser.mjs tests/checkin-registrations.spec.ts`: 3 PASS, exercising the actual production build and real disposable PocketBase authentication at 390x844 plus desktop role denials. Full production build, server syntax and checkin-runtime compilation passed inside this isolated runner. Browser confirms all pages projected (six synthetic upstream rows, five allowed DTOs), local search, all three programme choices, no page overflow, no-store headers, 503 distinct from empty, successful refresh and 403 clearing both rows and search after real role revocation. No upstream writes.
- First browser attempt exposed only a test locator mismatch: wrapped select label includes its options for `getByLabel(exact)`. Fixed test to use its actual accessible `combobox` role/name; no feature behavior was weakened or changed. Fivefold browser stability repeat also PASS: 15/15 tests in 22.8s; disposable server shut down successfully.
- Existing harness warns about missing unrelated public-content collections in its disposable database; focused Vite tests still emit the known successful-test shutdown warning. Neither prevents these gates.

## Remaining review / acceptance gaps

- Browser interaction, phone layout and auth-loss DOM redaction are now verified locally; populated in-flight authority switching is covered by a deferred-read unit test. Deployed web-container credential availability still requires parent verification. No deployment attempted.
- Shared paginator bounds entire upstream event at 1000 rows/40 pages; exceeding this fails unavailable, not partial. Refresh currently reads all event pages and projects only configured products. Revisit source-verified product filters before event grows beyond bound / many simultaneous operators; process-local shared rate budget is not distributed.
- Pagination is not an upstream transactional snapshot; changing totals or duplicate/nonmonotonic IDs fail closed, but concurrent status edits can span observation times.
- Only three mapped WTS free-ticket programmes are covered; external DevFest/MAUI/other unconfigured products not invented.
- Opt-in live test reads configuration from WTS_REGISTRATION_LIVE_CONFIG and is skipped in ordinary CI. Never set it in untrusted PR execution.
