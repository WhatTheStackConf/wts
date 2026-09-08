# Check-in automated verification

This is software verification for issue #45, not event-use or physical-device approval. Admission, printing, email delivery, upstream credentials and camera outcomes are not simulated as ready.

## Run locally

Use the versions in `package.json`: Node 22.23.2 (minimum 22.22.2) and pnpm 11.24.0.

```sh
pnpm install --frozen-lockfile
pnpm pocketbase:download-test
pnpm exec playwright install chromium
pnpm test:checkin-browser
```

On a supported Linux CI image, install browser OS dependencies with `pnpm exec playwright install --with-deps chromium`. The download command requires PocketBase **0.30.4**, using release asset `pocketbase_0.30.4_linux_amd64.zip`; missing binaries/migrations are errors, not skipped persistence coverage. Other local platforms must supply the same version manually at `pocketbase/pocketbase`.

Pass Playwright filters through the command, for example:

```sh
pnpm test:checkin-browser --grep 'unauthenticated'
pnpm test:checkin-browser --repeat-each=2
```

`pnpm exec playwright test --list` lists tracked scenarios without starting services. Direct execution without the disposable runner fails; this suite intentionally accepts no external `BASE_URL`, existing session state, or database URL.

## Isolation and evidence

- The runner creates its own private `wts-checkin-browser-*` OS-temporary directory, database, migrations/hooks directories, generated test-only credentials and loopback ports.
- It copies source/content/public/build configuration into a temporary app and symlinks dependencies. It never reads/copies `.env*`, normal PocketBase data, research artifacts, production tokens or the developer's `.output`.
- Temporary `node_modules` is a real directory with dependency entries symlinked individually; Nitro/Vite/cache directories remain private to the disposable build.
- Environment variables use an explicit allowlist. The app receives only generated disposable PocketBase credentials; Hi.Events and newsletter/captcha keys are unset/empty. The built server denies external `fetch`, and browser contexts block external resources and fail on unexpected external fetch/XHR. No upstream/Pi/printer/email action is part of this gate.
- Named legacy schema prerequisites are selected because historical ID-addressed migrations are not applicable to a fresh PocketBase database. All `checkin*.js` feature hooks and `*checkin*.js` migrations are copied **unchanged**, with the same prerequisites as the persistence helper.
- Login is through the actual `/login` form and real server-issued session cookie, not localStorage role injection or a mocked auth response. Privileged fixture access is confined to generated synthetic account setup and database readback.
- The runner builds and exercises the actual production server. It tears down only its own child processes and temporary directory on success/failure/signals. It never calls `pnpm dev`, `pocketbase:start`, normal migrations or production APIs.
- `test-results/` and `playwright-report/` are ignored. Failure artifacts may contain **disposable** login cookies/provisioning codes; do not reuse them as credentials or attach real sessions. CI retains failed-run artifacts for three days.

## Gates

`.github/workflows/verification.yml` runs `pnpm test`, `pnpm check`, `pnpm typecheck` and `pnpm build` as independent, non-fail-fast matrix jobs. Browser verification is a separate required job, not a replacement for any existing gate. Unrelated failures stay visible.

`pnpm test` explicitly includes `checkin-http.test.ts`, `checkin-pocketbase.integration.test.ts` and `pocketbase-public-url.test.ts`. Browser tests live under `tests/checkin*.spec.ts`; both the normal typecheck and the browser command include their config and tests.

The shell intentionally remains unready even after station/system restore. Successful browser checks establish neither real camera behavior nor printer calibration, admission safety, upstream availability, retention compliance, or owner event-use approval.

## Browser regression matrix

`tests/checkin-lifecycle.spec.ts` exercises real administrative reason/confirmation controls, station configuration and database readback, rendered reusable QR issuance, fragment removal, review/cancel without binding, same-station replay, three independent phone identities and the warning, stale confirmation across station disable/restore, cross-station rebind, system stop/restore, QR replacement without unbinding, revocation and login handoff, and disabled admission/printing throughout. Mobile evidence asserts no document overflow and records full-page screenshots. The reason selector must receive keyboard focus when an action opens.

The restart scenario closes a real persistent Chromium browser process and reopens its private profile; it does not substitute a storage-state injection for browser restart. It then clears cookies/browser storage and verifies a new unbound session. Negative API cases verify operator/admin separation, absent/foreign Origin, malformed provisioning input, content type, privacy headers and no audit writes.

Concurrent first-time previews use a same-origin Web Lock until the response body is received, so a delayed preview cannot replace another tab's confirmed identity cookie. Browsers without Web Locks fail closed before sending a provisioning request; use a current browser over HTTPS (the loopback fixture is a trustworthy development origin). A test-only loopback reverse proxy holds **real** preview responses before Chromium processes their `Set-Cookie` headers. This reproduced the two-binding race before the fix; ordinary Playwright request interception alone did not reproduce that response-ordering bug.

Screenshots are written to the corresponding test's `test-results/checkin/` directory (`admin-desktop.png`, `operator-mobile-bound.png`, `admin-mobile-revoked.png`). Playwright retains failures and traces. Missing prerequisites fail rather than becoming skipped green tests.

For explicitly requested manual inspection, `pnpm test:checkin-browser --inspect` builds the same disposable stack and prints its loopback URL and private fixture path. It holds until SIGTERM/SIGINT, then stops its children and removes its temporary data. Never publish the fixture contents. A manual hold is not a passing automated gate.

## Local verification (2026-09-08)

- `pnpm test`: **425 tests passed across 41 files**, including real PocketBase migration, transaction rollback, replay, stale-binding confirmation, authorization and restart coverage.
- `pnpm check`: **passed**, zero errors; 87 existing warnings remain visible.
- `pnpm typecheck`: **passed**, including browser tests.
- `pnpm build`: **passed**, including generated server JavaScript syntax verification.
- `pnpm test:checkin-browser`: **9 scenarios passed**, using the production server and a real Chromium process restart. Desktop and mobile screenshots were inspected; the mobile checks also assert no document overflow.
- `pnpm test:checkin-browser --grep 'concurrent first previews' --repeat-each=5`: **5 passed**, exercising delayed response ordering across two tabs.
- The original seven-scenario suite also passed twice consecutively (**14 passed**) before the two cross-tab safety scenarios were added.

### Code review

- **Standards:** no blocking documented-standard findings remain. One non-blocking advisory: share the prerequisite migration/hook manifest between persistence and browser fixtures to reduce future drift.
- **Spec:** the review's stale cross-station confirmation finding was fixed with binding-version fencing and a retained real-PocketBase regression test. A delayed earlier review exposed an additional first-preview identity race that the initial final review missed; it was reproduced through the real browser/HTTP/PocketBase path and fixed with cross-tab preview serialization.

Follow-up Standards/Spec reviews found no blocking issues after adding the browser-environment guard. A pending preview deliberately retains the cross-tab lock until its response settles or its tab closes; other tabs' previews wait, while status, binding confirmation and admin controls remain independent. Explicit stalled-request cancellation coverage remains a non-blocking follow-up.

Browser verification exposed a Nitro/Rolldown server chunk-linking defect: compilation succeeded but the generated server exported an undefined namespace. `nitro.inlineDynamicImports` avoids that second-pass server splitting; client route splitting remains enabled. The build now runs `scripts/check-server-bundle.mjs` so invalid emitted JavaScript fails the build instead of surviving until deployment.

The disposable test also exposed a local URL resolver that replaced explicitly configured loopback ports with `8090`. The resolver now preserves those ports, with regression tests. Authenticated status probes execute browser `fetch`; negative wire tests explicitly attach only the generated test-session cookies because Playwright's API context does not send Secure cookies on HTTP loopback the way Chromium does.

Known non-failing output remains visible: Vitest's shutdown warning and public-page collection-not-found diagnostics from the deliberately minimal disposable schema. These are not claims that the full production schema or physical integrations were tested. The tracked CI workflow has not run remotely until this commit is pushed; local green results do not assert GitHub branch-protection configuration or production deployment.
