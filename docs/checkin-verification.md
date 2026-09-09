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

## Name Label profiles and rendering verification (2026-09-09)

Issue [#47](https://github.com/WhatTheStackConf/wts/issues/47); usage and production-boundary contracts are in [checkin-name-labels.md](checkin-name-labels.md).

Verification used an isolated snapshot of the staged implementation (code tree `25c50de21635b9198c4893138a82922047b67a5b`), excluding concurrent, unrelated agenda/week edits and `.env` files. Dependency/cache/build output and disposable PocketBase/upstream instances were isolated. Subsequent verification-document edits do not change the tested code.

| Gate | Actual result |
| --- | --- |
| `pnpm test` | **559 passed across 48 files** |
| `pnpm typecheck` | **Passed** |
| `pnpm check` | **Passed: zero errors, 87 pre-existing warnings** |
| `pnpm build` | **Passed**, including emitted server syntax verification |
| `pnpm test:checkin-browser` | **19 passed**, with a separately built and booted production server |

The new default suites are `checkin-label-renderer.test.ts`, `checkin-label-profiles.integration.test.ts` and `checkin-label-http.test.ts`. The existing browser glob/CI job runs `checkin-labels.spec.ts` and `checkin-label-profiles.spec.ts` alongside all retained station/event scenarios.

### Observed behavior

- Actual pinned Noto Sans Regular/Bold bytes, hashes, glyph coverage and no-fallback errors were verified. Deterministic PNGs, independent shrinking/ellipsis, blank affiliation, grapheme boundaries, two-row bounds, offsets, rotation, immutable input snapshots and payload identity were exercised through the renderer boundary.
- Real temporary PocketBase tests verified version persistence/restart, immutable profile/approval records, live role revocation, direct-access denial, exact replay, competing versions, approval replay, atomic rollback of profile/approval plus Admin Action/audit, and permanent invalidation after station/printer changes. A superseded profile remains previewable but is not effectively approved for new production work.
- Actual admin forms configured explicit dot geometry and recorded **test-only simulated** physical attestation. Synthetic profiles could not be approved. Editing an approved profile produced a new unapproved version; same-reference station edits and printer replacement visibly required a new profile.
- The browser decoded and compared actual PNG pixels with the displayed canvas. Mixed Cyrillic/Latin, diacritics and descenders, long-name ellipsis and blank affiliation rasters were visually inspected. The site's original font produced missing glyphs in editable Cyrillic text despite a correct raster; loading the pinned Noto display font fixed the inputs and row summaries. Corrected 320px preview and 320/390px configuration/confirmation screenshots were inspected, with no visible horizontal clipping. Automated overflow, focus and font-readiness checks passed; a blocked display-font request produced an actionable disabled preview.
- Preview did not add Admin Actions or check-in audits. No admission or physical printing operation was enabled. Labels and PNG metadata excluded email/QR/upstream capability fields; rasterization created no spool files.

### Review and regression evidence

- **Standards:** no findings in the independent staged-diff review.
- **Spec:** one medium finding was reproduced and fixed: HTTP 200 with valid but malformed JSON (`{}`, `null` or an error object) previously resolved successfully, allowing the UI to discard a frozen command. Shared browser-safe schemas now validate success envelopes and expected profile/version/configuration before resolving; malformed or mismatched results retain an ambiguous same-command retry. The retained unit test failed with `{}` before the fix. Real-browser regressions commit on the real server, substitute each malformed response, fail a catalogue refresh, and then converge the exact UUID/reason/note/geometry retry to one persisted version/action/audit. The transport-loss case is also retained.
- Earlier failures (missing UI, an ambiguous test locator, a boolean data-attribute assertion and an incomplete storage validator) were corrected rather than counted as passes. The full gate results above are from the reviewed, corrected implementation.
- The focused remediation review found **no remaining blocking findings**. It independently exercised malformed/mismatched configure/approve responses and submitted-payload isolation; the production renderer and full browser execution evidence are the parent-run gates above, not inferred from that review's module harness.

These are local software results, not remote GitHub CI, deployment, real attendee mutations, physical calibration, printer/Pi readiness or event-use approval. Runtime follow-up #31 and owner-led printed legibility/feed/calibration follow-up #32 remain outstanding. The existing non-failing Vitest shutdown warning and minimal-fixture diagnostics remain visible.

## Station agents and readiness verification (2026-09-09)

Issue [#48](https://github.com/WhatTheStackConf/wts/issues/48). Runtime configuration, supervision, recovery and limitations are documented in [checkin-station-agents.md](checkin-station-agents.md).

All final code gates ran against the isolated staged-tree snapshot `ace908a36b4306c5cf61576edaffee03931e09b5`, excluding unrelated programme edits and `.env` files. Dependency/cache/output isolation was retained. Only verification/runbook documentation changed afterward.

| Gate | Actual result |
| --- | --- |
| `pnpm test` | **588 passed across 54 files** |
| `pnpm check` | **Passed: zero errors, 87 existing warnings** |
| `pnpm typecheck` | **Passed**, including standalone runtime and browser sources |
| `pnpm build` | **Passed**, including server syntax verification and standalone NodeNext runtime compilation |
| `pnpm test:checkin-browser` | **25 passed**, against a separately built and booted production server |

### Verified behavior

- Separate machine bearer issuance/revocation uses live admin authorization, immutable command identity, version fences and bounded audits. Human User sessions, Station Client Bindings and provisioning QRs cannot substitute for machine authentication; agents cannot enter browser/admin or direct collection APIs.
- Real temporary PocketBase tests cover heartbeat freshness at the exact 15-second threshold, the 10-second authorization boundary, expired/revoked credentials, cross-station requests, protocol/profile/identity mismatch, sticky journal quarantine, stops/restores, coordinator replacement and stale generations. The configurable defaults remain 5-second heartbeat, 15-second timeout and authorization validity no longer than 10 seconds.
- Compiled coordinator and outbound-agent CLIs performed a real loopback handshake with a file-backed SQLite journal. Removing that disposable journal produced a bounded failure report and persisted quarantine. No physical device, USB command or production credential was used.
- Durable receipt/authorization/outcome tests exercise reopen, payload conflicts, delayed responses, exact retries, lost start responses and no repeated possibly-started boundary. Started-attempt outcomes remain reportable through the narrowly scoped protocol after credential expiry/revocation. Unresolved output blocks the entire fixed station, including replacement agents.
- The six new browser scenarios exercise actual admin issuance/revocation and operator binding/readiness, one-time masked credentials, secret-free readback, access isolation, malformed/lost response retries and failed readiness refreshes. Controlled heartbeat evidence is explicitly injected through the disposable privileged fixture, not represented as a real Pi. The UI distinguishes connection, compatibility, profile approval, journal state, coordinator availability and administrative stop. Mobile overflow and keyboard-focus checks pass. Admission and printing remain disabled throughout.
- New suites are explicitly registered in the default manifest selection: agent client, human HTTP, agent persistence, coordinator persistence/protocol, combined agent/coordinator protocol and local runtime/CLI tests. The existing browser glob and CI workflow cover the new browser file and runtime compilation.

### Review and failure evidence

- **Standards:** both P2 findings were corrected: validated failed administrative commands retain a bounded failed Admin Action after authority rollback, with safe exact retry; profile configuration now reserves its action before changing station state. Source-import, JSX control-flow and shared journal-error classification findings were also corrected. The follow-up Standards review passed.
- **Spec:** the reviewer reproduced a journal-history bypass in real PocketBase: sequence 100 followed by credential rotation could accept sequence 2. Rotation now preserves retained station/journal watermarks, including rotation away/back. Regression tests reject the old snapshot and accept an ordinary higher sequence. The follow-up Spec review passed.
- The station-wide unresolved-output regression failed before the SQL existence check was added, including a case with both completed and unresolved attempts. Disabling browser success-envelope validation made three retained client tests fail; restoring validation returned them to green. The CLI non-restart exit-status regression also failed before the supervisor-budget fix.
- The first complete suite exposed a retained #45 assertion for a hardcoded disconnected coordinator. Its assertion now reflects the separate live agent-readiness query, and the new persistence suite explicitly verifies the initial unavailable/never-seen/unconfigured states. The corrected full suite passed; no failing test was skipped or removed.

### Remaining operational limits

No push, remote CI result, deployment, live attendee mutation, physical calibration, real Pi/printer readiness or event-use approval is established by these checks. The systemd templates passed local syntax verification only with this workstation's actual Node path substituted into temporary copies; target executable paths and supervision must be verified before deployment. Node's experimental SQLite warning, Vitest's non-failing shutdown warning and disposable minimal-schema diagnostics remain visible.

A hard crash or storage failure between domain rollback and failed-action persistence can leave no failed Admin Action. Authority changes still roll back; absence of a failure record is not proof that no command was submitted. Purge/backup orchestration and physical-output recovery remain their later slices, not capabilities enabled by this protocol-only release.

## Arrival preflight verification (2026-09-09)

Issue [#49](https://github.com/WhatTheStackConf/wts/issues/49). Behavior, operator instructions and remaining integration limits are in [arrival preflight](checkin-arrival-preflight.md).

Final manifest gates ran against isolated staged tree `88c0b28c4caa3ee0406f6879bd35664748ec52b8`, excluding unrelated programme/week changes and `.env` files. Browser verification used tree `7a075a19fc1a9bd6ec06542bff380a63ef4fd66a`; the only subsequent code-tree change was an explicit boolean comparator in a persistence test to remove a new lint warning. Production code and browser tests are identical between those trees. This verification record was added afterward.

| Gate | Actual result |
| --- | --- |
| `pnpm test` | **739 passed across 59 files** |
| `pnpm check` | **Passed: zero errors, 87 existing warnings** |
| `pnpm typecheck` | **Passed** |
| `pnpm build` | **Passed**, including emitted server syntax and standalone runtime compilation |
| `pnpm test:checkin-browser` | **29 scenarios passed**, against the built production server |
| Fresh disposable runs of `--grep 'arrival answer outages'` | **Both additional runs passed** |

### Observed behavior and boundaries

- Real PocketBase tests race independent actors/stations and verify global command identity, changed-payload conflicts, unique stable attendee workflows, immutable configuration/affiliation/profile inputs, atomic rollback on an injected audit failure, restart persistence and browser/Pi direct-access denial. Feature migrations and hooks are copied unchanged.
- Live role, binding, system/station/event generations, selected-list eligibility and dependency/profile readiness fence acceptance. Existing work can reopen without another upstream read or available printer, but cannot change station or originating event. Admins can inspect all stations without a binding.
- The separate GET-only adapter verifies exact case-sensitive QR identity, selected-list membership and complete simple pagination. Tests distinguish failed affiliation reads from absent answers, reject unexpected eligibility, validate detail identities and exclude email, QR/capabilities and raw diagnostics from projections. Shared budget tests cover concurrency, observed limits, stale headers, Retry-After, maximum attempts, timeouts and early timer wakeups.
- Actual browser forms exercise reservation, same/foreign-station repeats, missing/rejected/unavailable states, explicit retry/blank continuation, event changes, reload, malformed committed responses and forbidden wire access. A held real server response verifies privacy after rebinding. Mobile overflow/focus checks pass. Screenshot inspection caught and then verified the correction of missing Cyrillic glyphs using the pinned Name Label display face.
- Terminal continuations resolve earlier read exceptions through immutable command/audit evidence. Current-day history marks them resolved; next-day unresolved queries exclude them before pagination. Original results still replay unchanged.
- No admission POST, print intent, actual Pi/printer action or production attendee mutation is performed. Synthetic upstream, physical attestation and heartbeat fixtures are labeled tests. The read budget is process-local, not a distributed deployment guarantee.

### Standards

The initial review found one P2: duplicated QR validators disagreed on case. Two retained tests failed before introducing one browser-safe uppercase-only predicate. The follow-up Standards review found no remaining hard-standard findings.

### Spec

The initial review found P1 retained/delayed foreign-station result visibility after rebinding and P2 permanently unresolved exceptions after terminal continuations. The browser privacy regression and real-PocketBase continuation regressions failed before their fixes. The follow-up Spec review closed both findings and reported no new findings.

An additional timer regression reproduced an early wake returning dependency-unavailable instead of waiting the remaining safe backoff. The reader now rechecks the remaining delay within the original bounded allowance. Its regression passes, as do the final full browser run and two separate fresh-database outage runs. A mutation test also proved that inverted exact-identity matching breaks the pagination regression; restoring the adapter returned it to green.

Earlier failures included an incorrect locked-collection expectation, stale banner/audit-count assumptions in retained browser tests, and a test interception left active during a negative access probe. They were corrected, not skipped or counted as passes. The final isolated test command still emits a non-failing Nitro development-worker path diagnostic and Vitest shutdown warning; the production bundle separately builds, boots and passes browser verification. Node's experimental SQLite warning and minimal-fixture collection diagnostics remain visible.

These are local software results. No push, remote CI, deployment, deployed-account contract verification, hardware calibration or event-use approval is claimed. Admission/printing remain disabled; runtime/device follow-ups #31 and #32 remain outstanding.
