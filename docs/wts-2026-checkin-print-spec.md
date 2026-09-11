# WTS 2026 Attendee Check-in and Name Label Printing

Status: approved for implementation, including owner sign-off on the scanner/recovery and Name Label prototypes. Not an event-use approval.
Updated: 2026-09-08.
Map: [Specify WTS 2026 Attendee Check-in and Name Label Printing](https://github.com/WhatTheStackConf/wts/issues/19).

## Evidence and authority

This document consolidates the approved product and operational decisions. The owner explicitly signed off on the scanner/recovery interaction and two-row Name Label prototype. Collection and API names below specify new work, not existing repository symbols. This document does not assert that production, mobile hardware, printers, or a coordinator have been tested or deployed.

- Terminology: [CONTEXT.md](../CONTEXT.md).
- Existing authority: [station operator and provisioning decision](https://github.com/WhatTheStackConf/wts/issues/23).
- Deployed integration evidence: [controlled fixtures](../research/wayfinder/hievents-checkin-fixtures.md). This supersedes earlier research's missing-fixture conclusions, not its unverified production configuration.
- Hardware research: [Pi/NIIMBOT runtime contract](../research/wayfinder/pi-niimbot-label-runtime-contract.md). Its 40×20 mm / 384×120 profile is historical, not approved for the newly selected stock.
- Owner reports that all three printers now accept generic sticker paper. This is owner evidence of media support, not a reproduced runtime, feed, or calibration test.

### Current repository versus historical deployment research

Use [package.json](../package.json), the lockfile, and [vite.config.ts](../vite.config.ts) as implementation tooling authority. The August deployment research predates the Solid 2 / Nitro 3 / Vite+ migration: its old `@solidjs/start`, Nitro 2 plugin, Nitropack and PocketBase SDK version claims are obsolete. Current configuration enables Solid Start mode, SSR/server functions, filesystem HTTP routing and Nitro's `node-server` preset; it does not configure a task runner. The separate coordinator remains an approved lifecycle/recovery decision, not a workaround justified by the obsolete Nitro 2 incompatibility claim.

The manifest now requires Node `>=22.22.2` and provides `check` and `typecheck` scripts; older AGENTS guidance about their absence and the lower Node minimum is stale. Use the actual manifest commands when implementing. Repository configuration still does not establish the deployed image/version, effective production settings, or actual station runtime.

## Confirmed product boundary

WTS 2026 only, using Hi.Events as admission truth and WTS as the durable workflow/printing coordinator. Three fixed Check-in Stations, each with its assigned Raspberry Pi and USB NIIMBOT B1. No offline admission queue, browser-to-printer transport, cross-station work transfer, generalized conference platform, or gamification awards.

One initial Name Label per Hi.Events event and ticketed attendee. Identity is not inferred by matching names or email addresses. Explicit station-local corrections/replacements remain available without a hard cap, with the existing warning after two attempts and immutable attempt history. A rescan is never a replacement command.

### Identity and station binding

Keep the settled existing-login User role model: Check-in Operator plus admin authority; no separate supervisor identity. Every human mutation records its actor. Reusable station QRs bind authenticated clients to a station and contain neither attendee data nor User credentials. A binding survives login handoffs and browser restarts; role/session validity is checked independently on every operation.

Operators see their station's current-day completed history and unresolved work, including unresolved work originating on earlier days. Admins see all stations. No history or attempt chain changes station when a phone changes station or event.

### Per-phone event selection

Operators choose from all WTS 2026 events in the authorized Hi.Events account. Unconfigured events are visible but cannot scan. Admin configuration supplies an explicit event/admission-list mapping; neither list choice nor WTS-year membership is guessed from a fuzzy title match. The exact event-discovery/configuration adapter remains an implementation proof requirement.

Selection belongs to the client, not the station. Show the event and station on scan, result, queue, lookup, and recovery surfaces. Snapshot event/list/configuration generation when work is accepted; subsequent client selection or admin configuration changes cannot retarget that work.

### Arrival flow

1. Require a valid login/role, station binding, enabled system/station/event configuration, and live dependency readiness.
2. QR is primary. An eligible first scan automatically checks in and authorizes the initial print only after attributable upstream success; no routine preview-confirmation stop.
3. The phone waits for this attendee's print outcome before scanning the next attendee. An operator can explicitly park an exception; parking does not cancel, transfer, retry, or change truth.
4. Repeat WTS scans reopen the durable result without another check-in POST or initial label.
5. A different station gets a bounded already-handled message, not another station's attendee history or a transfer/reprint option.
6. Returning to another WTS event may produce that event's initial label.

### Manual lookup and privacy exception

Provide server-mediated active-admission-list search by name and/or email. Search does not mutate admission state. The operator selects a specific ticketed attendee and explicitly confirms check-in before the normal workflow begins. Revalidate exact identity, eligibility, list, and configuration at confirmation time.

Full email is allowed only in the restricted lookup/results and confirmation view. This narrowly supersedes the previous blanket operator-email exclusion. Email is absent from labels, station history, audit details, logs, and Pi payloads. Search strings are transient: no persistence, analytics, request URL logging, localStorage, or browser-history parameters. Results are bounded and paginated; ambiguous matches require selection, never first-result admission. A typed name/email is never an idempotency key.

### Name Label

Confirmed stock: **50×30 mm pre-cut generic gap labels**.

- Exactly two rows: attendee name first, affiliation second.
- Missing affiliation leaves the second row blank. Operators may add it through label-only correction.
- Fit each row independently: shrink to its readable minimum, then visible ellipsis. No wrapping into another row.
- Correction preview shows the exact text to be rendered and visibly identifies shortening. Corrections affect labels, not Hi.Events source data.
- Support realistic Latin and Macedonian Cyrillic, mixed scripts, punctuation, diacritics, and descenders.
- Calibrate physical printable bounds, direction, feed, safe margins, density, threshold, and offsets separately for every printer/stock combination. Nominal millimetres are not permission to reuse or mathematically infer the old raster.
- Version and pin the production renderer, font, and station profile. A screen preview or raster hash is not physical approval.

Production affiliation uses existing answers selected by configured immutable question IDs, optionally scoped by product. Without a mapping or an answer, leave row two blank. Do not add checkout questions or backfill tickets as part of this effort. Failure to fetch a configured answer is distinguished from a genuinely missing answer; fetch label inputs before submitting check-in, and surface an explicit retry/blank-label choice on read failure rather than silently treating a dependency error as missing data.

### Authoritative outcome rule

The owner reconfirmed the admin gate for lost responses and pre-existing check-ins outside attributable WTS work. Operators may resolve physical label output only; they cannot declare uncertain admission truth.

| Evidence | Admission outcome | Initial label |
|---|---|---|
| Exact eligible list member, no check-in; our single POST returns the matching new check-in in `data`, with no attendee error | Attributably accepted | Atomically authorize once |
| Existing attributable WTS workflow | Existing result | No new initial intent |
| Existing check-in found before our POST, or POST returns attendee-keyed already-checked-in error | Existing but unattributed | Admin decision required |
| POST timeout, disconnect, malformed response, or crash after send boundary | Uncertain | No automatic print or repeat POST |
| List reconciliation after uncertain POST finds a check-in | Existing but unattributed | Still admin decision required |
| Reconciliation finds none after uncertain POST | Still uncertain; absence does not prove a delayed request cannot finish | No automatic repeat POST |
| Wrong list, unknown attendee, cancelled, awaiting payment, or unknown eligibility | Rejected/fail closed | None |
| Dependency unavailable before any mutation | Not submitted | None |

HTTP 200 alone does not establish admission success. Reconcile through the exact list, require one exact attendee identity, classify `data` and attendee errors together, and never parse localized message text as authority. Generic GET retry helpers must not be reused for check-in POSTs or resets.

## Confirmed deployment and retention decisions

Keep the coordinator and Pi agent in this WTS repository. Run one independently supervised coordinator alongside the web service and PocketBase; run one systemd-supervised outbound-only agent per Pi. PocketBase is the central durable ledger; each Pi has a file-backed local print journal. Web requests and PocketBase cron are not the external-side-effect worker.

Delete attendee-linked workflow history and label text 30 days after the explicit WTS check-in closure. The policy covers central records, Pi journals, any persisted raster payloads, and documented backup expiry/restore cleanup. Keep only anonymous totals afterward. This feature does not delete Hi.Events tickets.

Dashboard and station warnings are supplemented by email to designated WTS admins. Notifications contain station/workflow references and bounded failure categories, never attendee text, email, QR payloads, credentials, or raw upstream diagnostics. A designated admin recipient list is deployment configuration; an empty list is a visible readiness/configuration warning, not a silent fallback to emailing every User with an admin role.

Trained operators may pause work and invoke native Hi.Events scanning plus handwritten labels without waiting for admin approval. This does not bypass the admin gate on an already uncertain WTS check-in. For that attendee, resolve admission truth first; never issue another POST merely because a different scanner is available. For an already accepted WTS check-in, handwritten fulfillment does not require another check-in.

The owner will manually test the system and owns event-use go/no-go. There is **no mandated 100-workflow rehearsal count or formal rehearsal gate**. Implementation is not blocked on physical testing. Production inspection and per-station physical validation remain explicit outstanding rollout-readiness work; they cannot be reported as passed from software checks. Automated correctness tests remain implementation requirements.

## Approved durable model

### Records and transaction boundaries

Additive PocketBase collection boundaries (new implementation, not existing collections):

- `checkin_events`: WTS edition membership, Hi.Events event/list references, optional affiliation-question mapping, enabled state, versioned configuration. Capabilities/credentials are server-only secret references, not operator-readable fields.
- `checkin_stations`: fixed station identity, assigned agent/printer/profile identity, enabled state, heartbeat/readiness and generation.
- `checkin_bindings`: hashed opaque binding identity, station, revocation state; independent from User login.
- `checkin_workflows`: unique `(edition, upstreamEventId, upstreamAttendeeId)`, immutable owning station and originating event/list/config snapshot; current admission/fulfillment projection and label snapshot.
- `checkin_commands`: stable command ID, actor, operation, payload fingerprint, result; uniqueness makes same-key/same-payload replay converge and rejects key reuse with changed payload.
- `checkin_attempts`: immutable upstream attempt identity and send-boundary evidence; separate outcome records retain what was learned later.
- `checkin_print_attempts`: ordered immutable initial/replacement identities linked to workflow and prior attempt, exact text/profile snapshot and payload hash; unique initial-purpose constraint per workflow.
- `checkin_audit_events`: append-only bounded transition/outcome history without secrets, QR payloads, email, raw rasters, or free-form upstream errors.

A transaction commits the admission projection plus initial print intent and audit together. Each later transition atomically advances the projection, command result, and corresponding audit. External calls occur outside database transactions. Only coordinator routes may mutate workflow records; browser and Pi collection access is denied by default.

### Ownership and crash recovery

Use database-enforced uniqueness and compare-and-set generations for work acquisition. A lease expiration permits takeover only before a side-effect send boundary. It never makes a possibly sent Hi.Events request or print safe to repeat. A stale worker cannot update current work; database fencing alone does not cancel an already-sent upstream request.

Persist an upstream `possibly_sent` boundary before the POST. Lost outcomes remain unresolved for admin review even when a later GET reports no check-in. Supervisor restarts preserve the boundary. Do not advertise exactly-once physical printing or upstream mutations.

Pi receipt deduplicates by immutable print-attempt ID and rejects payload mismatch. The agent journals `received` before acknowledging receipt and `possibly_printing` before the first side-effecting printer command. It records protocol completion separately from operator-observed output. Result delivery to the coordinator is replayable and cannot cause printing again.

Safe pre-command failures may retry the same attempt with bounded backoff while readiness permits. After a possibly-printing boundary, restart/disconnect/lost status means `output_uncertain`. The operator records observed printed/not printed. A not-printed resolution enables an explicit new replacement attempt; it does not automatically print. An unresolved attempt blocks another print on that workflow. A retry/replace double tap converges on one command.

Printer traffic is serialized for the complete physical task; one OS process owns the stable USB by-id device and local journal. A Pi with a lost/corrupt journal or changed identity is quarantined; restoring an older journal/database is not permission to replay old work.

### Stop, correction, and stale-client boundaries

Station/global stops prevent new admission claims and print starts; a physically started task may finish and reports its result. Preserve every queued/in-flight record. An admin restore does not blindly replay uncertain work. Polling/dispatch carries an expiring authorization generation; a revoked agent cannot receive future work. Instant cancellation of commands already handed to USB is not promised.

Freeze print payloads once dispatched. A correction made while an attempt is active is staged; it must wait for known output before an explicit replacement. Handwritten resolution must first cancel and acknowledge any not-started print at the Pi, or physically isolate a disconnected printer and reconcile it before restarting, so an old queue cannot later print unexpectedly.

### Suggested API boundary

Browser-to-WTS authenticated commands: event catalogue/config readiness, provision/bind, select active event, lookup, confirm lookup/scan, workflow status/history, park/resume, preview/correct/replace, record observed output/handwritten, and admin truth/control actions. Use opaque internal references; no list capability or printer transport reaches the browser.

Pi-to-coordinator API: per-agent authentication, heartbeat, receive/acknowledge station work, pre-start authorization, and idempotent outcome reporting. A station QR is never an agent credential. An agent can read only its station's minimal label payload and report only its own attempts; it cannot check attendees in or use PocketBase superuser credentials.

Admin commands include event/list and optional affiliation configuration, profile approval, binding/agent revocation, station/global stop, reconciliation, audited explicit label authorization for an existing check-in, reset, cancellation, and edition closure. Reset never silently authorizes a new initial sticker or erases an old print chain.

## Approved operational defaults

Monitoring thresholds are configurable; these are the approved initial values.

- A valid heartbeat is expected every 5 seconds; after 15 seconds without one, mark the station unready and stop new admission/print starts. A received print authorization expires within 10 seconds and is checked at the agent's pre-start boundary. An already started physical operation may complete; display that distinction during a stop.
- Highlight waiting work older than 30 seconds. Raise an admin email incident for station unavailability or stalled work lasting 60 seconds; admission uncertainty and uncertain physical output are visible immediately and email immediately. Deduplicate by incident, send one recovery message, and repeat an unresolved incident at most every 15 minutes. Alert delivery failure remains visible in the dashboard.
- Retry safe reads/pre-send work with jittered bounded backoff and honor upstream rate limits; maximum three automatic attempts, then explicit retry. A definitely rejected response is classified, not blindly retried. No automatic retries cross uncertain side-effect boundaries. Preserve pending work during outages instead of an endless hot retry loop.
- A successful scanner decode pauses acquisition immediately. Resume after protocol-reported completion and a short visible attendee result; no required confirmation tap on routine success. Sound/haptics are optional progressive feedback, never the only status indication. Operator-observed corrections remain available if a protocol-success label did not physically emerge or was illegible.
- Admin resolution operations are explicit: authorize one label for a reconciled existing check-in, deny/cancel label fulfillment, continue read-only reconciliation, or reset a positively identified erroneous check-in. Truth-changing reset requires reason/confirmation and known producer quiescence. A possibly running or delayed upstream POST cannot be made safe to resubmit by a WTS lease expiry or an empty GET. Leave it unresolved until attributable evidence/admin investigation resolves it; no force-new-check-in shortcut.
- Edition closure is an explicit admin control. It stops new work, revokes future dispatch authorization, and schedules the purge deadline; it is distinct from a temporary global stop. Preserve unresolved history until the deadline but do not let it silently postpone deletion. The admin dashboard surfaces the deadline, unreachable Pis, and purge status.
- Prefer memory-only raster rendering. Delete transient spools promptly after attempt completion; journal the payload identity and minimum recoverable label snapshot only for the approved retention period. Purge central and local attendee-linked records at deadline and compact/securely retire journal files as required; SQL row deletion alone is not a secure-erasure claim. Offline Pis must be wiped or reconnect into purge-only mode before reuse.
- Backups containing feature data must expire or be sanitized by the approved retention deadline. Before a restored system accepts traffic, keep all scanning and printing disabled, apply overdue purges, reconcile restored attempt identities against agent history and Hi.Events, rotate ownership generations, and receive admin authorization. A rollback/restore never replays a print from an old snapshot. The existing backup operator must approve a concrete expiry/restore procedure before claiming retention compliance.
- Roll out additive schema first, coordinator next, agents next, then UI and one station before enabling the other stations. Use the same protocol/schema generation and explicit compatibility readiness. Stop-and-drain coordinator changes rather than intentionally overlap active producers. Quarantine unknown journal/profile/printer identities.

## Open evidence, not unfinished product decisions

- No product or prototype design sign-off remains outstanding. The following implementation and rollout evidence is still unverified.
- Live PocketBase/Coolify immutable build identity, actual process topology, health/migration ordering, and backup/restore retention procedure are unverified.
- Each Pi's runtime/native-module build, stable printer identity, generic-stock feed/offset calibration, actual print-status behavior, and journal recovery are unverified.
- Real Android/iPhone camera, keyboard, orientation, permissions, resume behavior, and physical label legibility require owner-led manual testing. A desktop demo does not establish them.
- Hi.Events all-event discovery, per-event/list configuration, production affiliation mappings, and exact deployed name/email search pagination must be verified during adapter implementation. No fixture list/question ID is a production default.

Suggested manual checks cover normal arrivals, repeat scans, name/email ambiguity, corrections, Cyrillic/long text, wrong-event/station handling, USB/network loss, process restart, power interruption, revoked bindings, stops, and handwritten recovery. The owner chooses the sample count and timing. Record actual observations rather than generating a passed checklist.

## Interactive review artifact and observed software checks

- Owner sign-off covers the demonstrated interaction and two-row label direction, not final production UI polish, physical calibration, or event readiness.
- Open [the standalone review demo](../research/wayfinder/prototypes/checkin-print.review.html). It contains synthetic data, an embedded Cyrillic-capable Noto Sans font, and an in-memory interaction model. No live camera, Hi.Events, authentication, Pi, or printer is connected.
- The neighbouring `checkin-print.prototype.html` is the editable pre-bundling source; its local-font dependency is not suitable for portable visual approval. Use the bundled review file above.
- The simulated-outcome controls are review harness controls, not production operator actions. Admin truth reconciliation, durable recovery, real multi-client operation, live readiness and actual device provisioning are specified here but not implemented in that demo.
- Local Chromium execution exercised all nine guided scenarios: normal/repeat, lost response, parked admission, uncertain output confirmed printed, uncertain output confirmed missing plus replacement, correction, handwritten fulfillment, wrong station, and event change.
- Observed one initial attempt per event/attendee, zero prints for uncertain upstream admission, explicit replacements only, preserved prior text, no foreign station history exposure, and manual email lookup requiring confirmation before any admission request.
- No JavaScript page errors or horizontal overflow at 320px/390px were observed. The embedded font loaded; the canvas visually rendered Cyrillic with independent fitting and ellipsis. These are desktop-browser simulation results, not physical/mobile acceptance.

## Operator runbook content for implementation

1. Log in, bind the phone using its station QR, confirm the station/printer identity, and choose the configured event. Check visible readiness before opening the queue.
2. Scan the attendee QR. For an unreadable/missing QR, search name/email within the selected event/list, select the exact ticketed attendee, and confirm. Hand over the matching label after the normal result; do not rescan to request a replacement.
3. For typos or damaged labels, open the owning station's record, edit the label-only draft, inspect the preview, and explicitly request a replacement. Source ticket data and prior attempt snapshots remain unchanged.
4. For uncertain admission, park the record and ask an admin; continue with unrelated attendees if dependencies are ready. Do not submit that attendee through another scanner as a retry.
5. For uncertain physical output, inspect the printer/label and record printed or not printed. The latter enables a separate explicit replacement or safe handwritten fulfillment. A parked physical exception does not make an unsafe printer ready.
6. For an unrecoverable station, pause that client's work and use the trained native Hi.Events/handwritten fallback for fresh attendees only. Existing accepted work stays at its station; neutralize queued output before recording handwritten fulfillment.
7. Hand off by normal logout/login. Pending station history survives. Admins handle truth decisions, revocations, station/global stops and final edition closure.

## Implementation sequence

1. Add roles, explicit event/station configuration, binding and ledger migrations, and deny-by-default authorization tests. No upstream mutation or physical print enabled.
2. Implement command deduplication, admission adapter, supervised coordinator, and synthetic fixture integration tests. Prove lost-response and duplicate suppression before live admission.
3. Implement deterministic renderer, agent protocol, local journal, recovery, and synthetic/simulated printer tests; then calibrate each actual station.
4. Build scanner, restricted lookup, correction/recovery and admin operational views against those boundaries. Test actual mobile devices as well as browser automation.
5. Verify the real deployment/backup/restore contract, provide the manual test/runbook checklist, and support owner-led testing and incremental station enablement. No prescribed rehearsal count blocks implementation; the owner controls event-use approval.

No commit, push, deployment, production mutation, hardware print, or acceptance pass is implied by this document.
