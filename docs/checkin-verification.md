# Check-in automated verification

This is software verification for issues #45 and #46, not event-use or physical-device approval. Admission, printing, email delivery, production upstream credentials and camera outcomes are not simulated as ready. Discovery/configuration contracts and the required outstanding deployed proof are documented in [checkin-hievents-contract.md](checkin-hievents-contract.md).

## Run locally

Use the versions in `package.json`: Node 22.23.2 (minimum 22.22.2) and pnpm 11.24.0. The browser runner also requires `openssl` to create its per-run synthetic upstream TLS certificate.

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
- Environment variables use an explicit allowlist. The app receives only generated disposable PocketBase credentials and a synthetic JWT for a private loopback HTTPS fixture; newsletter/captcha keys stay unset/empty. The built server denies external `fetch`, allowing only its own app, PocketBase and that fixture. Browser contexts cannot connect directly to the synthetic upstream and fail on unexpected external fetch/XHR. No real Hi.Events/Pi/printer/email action is part of this gate.
- `scripts/checkin-hievents-fixture.mjs` is a clearly labeled synthetic contract server. A per-run self-signed certificate is trusted only by the disposable processes using `NODE_EXTRA_CA_CERTS`; production HTTPS validation is unchanged. Its authenticated test-control route injects complete, partial and unavailable discovery; it counts and rejects attempted admission/upstream writes. Fixture IDs are test-only, never application defaults or schema seeds.
- Named legacy schema prerequisites are selected because historical ID-addressed migrations are not applicable to a fresh PocketBase database. All `checkin*.js` feature hooks and `*checkin*.js` migrations are copied **unchanged**, with the same prerequisites as the persistence helper.
- Login is through the actual `/login` form and real server-issued session cookie, not localStorage role injection or a mocked auth response. Privileged fixture access is confined to generated synthetic account setup and database readback.
- The runner builds and exercises the actual production server. It tears down only its own child processes and temporary directory on success/failure/signals. It never calls `pnpm dev`, `pocketbase:start`, normal migrations or production APIs.
- `test-results/` and `playwright-report/` are ignored. Failure artifacts may contain **disposable** login cookies/provisioning codes; do not reuse them as credentials or attach real sessions. CI retains failed-run artifacts for three days.

## Gates

`.github/workflows/verification.yml` runs `pnpm test`, `pnpm check`, `pnpm typecheck` and `pnpm build` as independent, non-fail-fast matrix jobs. Browser verification is a separate required job, not a replacement for any existing gate. Unrelated failures stay visible.

`pnpm test` explicitly includes `checkin-http.test.ts`, `checkin-pocketbase.integration.test.ts`, `checkin-hievents.test.ts`, `checkin-event-http.test.ts`, `checkin-events.integration.test.ts`, `checkin-event-safety.integration.test.ts` and `pocketbase-public-url.test.ts`. Browser tests live under `tests/checkin*.spec.ts`; both the normal typecheck and the browser command include their config and tests. No CI job changes are required: the existing workflow invokes these manifest commands.

The shell intentionally remains unready even after station/system restore. Successful browser checks establish neither real camera behavior nor printer calibration, admission safety, upstream availability, retention compliance, or owner event-use approval.

## Browser regression matrix

`tests/checkin-events.spec.ts` uses actual admin forms to configure explicit edition membership, list/question/product mappings and generations, then provisions two independently authenticated browser identities at the same station and selects different events. It verifies unavailable options, reload persistence, stale context after admin edits, unchanged other-phone selection, secret-free operator JSON, audited readback and disabled admission/printing. Partial and unavailable reads are injected at the **synthetic upstream**, not by substituting browser catalogue responses. A second scenario lets the real server commit, discards that browser response, and verifies the frozen exact command/UUID retries to one Admin Action/audit result. Mobile screenshots include the populated admin mapping form and operator event/station context; document-overflow and focus assertions accompany them.

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

## Event configuration verification (2026-09-09)

- `pnpm test`: **491 tests passed across 45 files** after review remediation. New coverage includes the injected-transport discovery adapter, event HTTP commands and real PocketBase configuration/selection, replay, competing producers, rollback, role/binding revocation, generation fences and a mapped list becoming unavailable after configuration.
- `pnpm check`: **passed**, zero errors and 87 pre-existing warnings. The two newly introduced warnings were removed.
- `pnpm typecheck`: **passed**, including event browser scenarios.
- `pnpm build`: **passed**, including emitted server syntax verification; the browser runner separately built and booted the actual production server.
- `pnpm test:checkin-browser`: **11 scenarios passed**; both new event scenarios and all retained station scenarios passed together. The final populated admin-form and operator-context mobile screenshots were inspected, with no visible clipping; automated document-overflow and confirmation-focus checks passed.
- Adapter body-limit and stalled-transport tests initially failed, then passed after bounded consumption and an explicit timeout/abort race were implemented. Configuration replay exposed nested Go-map JSON ordering, fixed with recursive canonical fingerprints. These failures were not counted as passing evidence.
- The fixture server reported **zero forbidden upstream effects**. It is synthetic evidence only. No production credentials were accessed, real event/list/question IDs configured, attendee mutated, physical printer used, deployment performed or remote CI result claimed.

The required deployed discovery/configuration proof remains outstanding in [checkin-hievents-contract.md](checkin-hievents-contract.md). Admission intake and printing remain disabled.

### Independent review remediation

- **Standards:** two P3 findings. Event and sibling station configuration now reserve their pending Admin Action before saving domain state, inside the same transaction. Source imports use `~/` consistently, including type-only browser-test imports.
- **Spec:** one medium finding. An event remained selectable when its mapped list later became unavailable. The retained real-PocketBase regression failed with `available` instead of `upstream_unavailable` before the fix and passes afterward. Catalogue and selection now check exact active list and affiliation mappings, bind the evidence to configuration generation, and withhold context on missing/incomplete reads. The browser fixture also expires a configured list and checks the actual UI plus a rejected selection request.

All three findings were corrected. The default suite, check, typecheck, production build and all 11 browser scenarios were rerun successfully after those changes. The 87 baseline warnings and Vitest shutdown warning remain non-failing; no remote CI or deployment is asserted.
