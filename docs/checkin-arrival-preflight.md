# Arrival preflight

Scope: [#49](https://github.com/WhatTheStackConf/wts/issues/49), WTS 2026. This release validates and durably reserves arrivals. It **does not submit admission requests, create print intents, enable the camera, or perform attendee lookup by name/email**. The independent coordinator and station-agent readiness are prerequisites, not proof of physical readiness. Event use remains disabled.

## Operator surface

1. Log in with a current Check-in Operator or admin User, confirm this phone's Station Client Binding, and explicitly select a configured event.
2. In **Arrival preflight**, paste the exact attendee QR identity and choose **Validate arrival**. This input is not a name/email search and accepts no URL wrapper or normalization.
3. Eligible work shows **Not submitted to Hi.Events**, the immutable owning station and originating event, and the Name Label text. A repeated arrival reopens existing work; another station sees only bounded already-handled information.
4. Failed affiliation reads are not missing answers. Choose **Retry affiliation read** or **Continue with blank affiliation**. Both are explicit new commands linked to the failed preflight; they retain the original selection fence and revalidate eligibility. After an event/rebinding/configuration change, deliberately start a new arrival rather than retargeting that continuation.
5. If a response is lost, unreadable or mismatched, **Retry same preflight** retains the original UUID and exact payload, even if a context/history refresh fails. **New arrival** is an intentional new command, not a transport retry. The QR is memory-only; reloading requires re-entering it. Durable work remains in station history.
6. **Station arrival work** pages through all unresolved work, including earlier days, and completed decisions from the current Europe/Skopje day. A terminal continuation resolves earlier read exceptions through the immutable continuation/audit chain; their original replay results are retained, but the queue no longer presents them as unresolved. Admins can inspect all stations without provisioning their browser. Changing this phone's event does not change the query's station ownership. Rebinding hides prior-station results, including delayed responses, while preserving a frozen command for safe replay.

## Application and storage boundaries

`POST /api/checkin-arrivals` accepts authenticated same-origin JSON only:

- `preflight`, with `command` containing `operationId`, `context`, `qrIdentity`, `affiliationChoice` and optional `priorOperationId`.
- `history`, with optional `query` containing `scope` (`station` or admin-only `all`), `cursor` and `limit` (1–100).

The browser supplies no source URL, list capability, upstream attendee record, label text, agent credential or readiness assertion. Private responses are no-store, non-frameable and no-referrer. Response envelopes are validated before a browser considers the command settled.

`CheckinArrivalService` passes only a one-way QR fingerprint to the privileged PocketBase command seam. `1790000006_create_checkin_arrivals.js` adds locked `checkin_arrival_commands` and `checkin_arrival_workflows` collections and bounded audit references. Workflow identity has a database uniqueness constraint on edition/upstream event/upstream attendee. Command UUIDs are globally unique; canonical payload fingerprints reject changed payload under the same key.

Command begin/result and corresponding audit transitions are transactional. External reads run outside database transactions. A final result replays without another mutation; an interrupted pending preflight can repeat only read-only work. Current human role, station binding, selected event, system/station/event generations and dependency/profile readiness fence acceptance. Reserved workflow snapshots cannot be updated or transferred. Browser and Pi direct collection mutation is denied; even direct privileged record API writes do not bypass the command guard.

This preflight ledger is not the later admission possibly-sent journal. No successful preflight implies that an attendee has been admitted, or that a label is authorized. Already checked-in upstream without existing WTS work is rejected for this slice; admin truth recovery belongs to later work.

## Hi.Events contract

The admission reader is separate from `src/lib/hievents.ts`, preserving existing ticket/gamification consumers. It uses private authenticated discovery to obtain the exact configured active list and a server-only capability, then resolves one exact public identity from that list's attendee query. A direct attendee lookup alone and aggregate check-in counts are not admission authority.

Contract evidence is the pinned upstream commit `cfbf468bb5b1b4ed3cba18184edc2e1094318f17` plus [controlled deployed fixtures](../research/wayfinder/hievents-checkin-fixtures.md). In particular, list attendees use Laravel **simple pagination** (no total/last-page metadata), unlike authenticated event discovery. Pagination paths, page continuity, bounds, identity and selected-list product membership are validated; missing/ambiguous/partial evidence fails closed. The QR validator preserves the exact upstream `A-` identity format; it does not repair malformed tokens.

Configured attendee/product question IDs supply affiliation through authenticated attendee detail. Missing mapping, out-of-scope product or genuinely absent answer yields blank affiliation. Failed or malformed answer reads yield an explicit choice, never silent missing data. Cancelled, awaiting-payment and unknown eligibility fail closed. Synthetic awaiting-payment coverage does not assert a deployed fixture for a state unavailable in the observed WTS checkout configuration.

The GET-only transport bounds response size to 2 MiB and read duration to 10 seconds, refuses redirects, applies jittered backoff with at most three automatic attempts, observes rate-budget headers and honors Retry-After. Backpressure ends in explicit retry rather than an unbounded request queue. Discovery/options and arrival reads share a **process-local** upstream-origin budget. This is not a distributed/IP-wide rate limiter: before enabling multiple web/coordinator producers behind one upstream limit, provide a shared external gate or retain one read producer. No generic read retry helper may wrap admission POST or reset operations.

## Verification and deployment limits

The default test command explicitly registers the arrival adapter, HTTP, client and real-PocketBase suites. `tests/checkin-arrivals.spec.ts` uses the existing disposable production browser runner, synthetic upstream fixtures and test-only physical attestation/heartbeat evidence. It does not use production credentials, mutate a real attendee, connect a Pi/printer, or establish phone-camera behavior.

Run the manifest's `pnpm test`, `pnpm check`, `pnpm typecheck`, `pnpm build` and `pnpm test:checkin-browser`; see [checkin-verification.md](checkin-verification.md) for recorded execution results. Deployed source/account/list mappings, actual runtime topology, rate-limit scope, physical profiles, hardware checks, later lifecycle purge and owner event-use approval remain separate work. No fixture identifiers are production defaults.
