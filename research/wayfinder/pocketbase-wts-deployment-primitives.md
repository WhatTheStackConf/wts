# PocketBase and deployment primitives for WTS check-in coordination

**Issue context:** [Verify PocketBase atomic workflow and WTS deployment primitives](https://github.com/WhatTheStackConf/wts/issues/21)  
**Related context:** [Wayfinder: Specify WTS 2026 Attendee Check-in and Name Label Printing](https://github.com/WhatTheStackConf/wts/issues/19)  
**Worktree/branch reviewed:** `/tmp/wts-wayfinder-pocketbase` on `research/checkin-pocketbase`  
**Evidence boundary:** repository state plus first-party PocketBase, Nitro, SolidStart, GitHub release, and Coolify material captured by the completed research pass. This note does not claim to have inspected private Coolify configuration, container metadata, credentials, or production data.

## Scope

This note answers the deployment-primitives portion of the WTS check-in design:

1. Which PocketBase primitives already exist for atomic state changes, idempotency, authenticated operations, migrations, and scheduled work?
2. Which of those primitives WTS already uses?
3. What does the checked-in deployment actually supervise and persist?
4. Can PocketBase cron serve as a durable coordinator, or is a separately supervised worker required?
5. Which production facts cannot be proved from the repository and must be probed before rollout?

This is not a new architecture specification and does not choose the complete coordination domain model. It establishes the trustworthy primitives and deployment constraints that the eventual design can build on.

## Executive answer

PocketBase can be the transaction and coordination **system of record** for the WTS check-in workflow. At the version pinned by the PocketBase container build, it provides application transactions, a transactional batch endpoint, database uniqueness constraints, authenticated custom routes, transactional migrations, JavaScript hooks, cron scheduling, and a health endpoint. WTS already exercises most of these primitives: custom `/api/wts` routes, superuser-protected mutations, transaction blocks, transactional SDK batches, unique indexes used as idempotency/locking guards, migrations, hooks, and cron jobs.

The safe coordination pattern is therefore:

- commit each business transition and its idempotency marker atomically in PocketBase;
- enforce race-sensitive uniqueness in the database rather than by read-then-write checks;
- make external side effects retry-safe and record their work/lease state in PocketBase;
- expose privileged control operations through authenticated, namespaced server routes; and
- use health/readiness signals that test the dependencies needed by the coordinator, not only process liveness.

PocketBase cron is useful as an **in-process trigger**, but it is not an independently supervised durable worker. A cron callback runs inside the PocketBase `serve` process. If the workflow requires independent restarts, ownership/readiness, queue draining, deployment ordering, or scaling, add a third Compose/Coolify service whose durable state remains in PocketBase. Whether that stronger lifecycle is required is still a design decision; no such service exists in the checked-in deployment today.

### Version finding — do not collapse these three facts

| Evidence | Version conclusion |
|---|---|
| Local executable bundle/download tooling and changelog (`pocketbase/get-pocketbase.sh`, `pocketbase/CHANGELOG.md`, and the local PocketBase bundle under `pocketbase/`) | **Local development evidence says PocketBase 0.30.4.** The download script explicitly fetches `v0.30.4`; the changelog begins at `v0.30.4`. |
| Container build (`pocketbase/Dockerfile`) | **The Dockerfile independently pins `ARG PB_VERSION=0.34.0`.** Its download URL is derived from that argument. |
| Public production health endpoint (`https://pb-2026.wts.sh/api/health`) | **The production version is unproven.** The endpoint returned HTTP 200 with the v0.34-style health response during the completed research pass, but the health response does not disclose the running version or image digest. |

Do not describe production as 0.30.4 merely because that binary is in the repository, and do not describe it as 0.34.0 merely because that is the Dockerfile default. Production must be confirmed from deployed image/container metadata.

## Proven current-repository facts

Local citations below are repository-relative paths in `/tmp/wts-wayfinder-pocketbase`.

### 1. PocketBase packaging, extension points, and persisted data

- `pocketbase/Dockerfile` downloads PocketBase using `PB_VERSION`, currently defaulted to `0.34.0`, and assembles the PocketBase image.
- `pocketbase/get-pocketbase.sh` explicitly downloads the `v0.30.4` local development archive; `pocketbase/CHANGELOG.md` also identifies `v0.30.4`. This is local-version evidence, not production-version evidence.
- WTS keeps timestamped JavaScript migrations in `pocketbase/pb_migrations/` and JavaScript hooks/routes/jobs in `pocketbase/pb_hooks/`. The PocketBase image copies these extension directories into `/pb` (`pocketbase/Dockerfile`).
- The container entrypoint performs `migrate up` before starting the server (`pocketbase/entrypoint.sh`). PocketBase also supports automatic migration application on `serve`; the explicit entrypoint step makes migration failure part of container startup rather than silently deferring it.
- Compose persists `/pb/pb_data` in a named volume, so the checked-in topology does not intentionally place the PocketBase database only in an ephemeral container filesystem (`docker-compose.yml`).

### 2. Atomic mutations and race-safe guards are already available

- WTS custom PocketBase code already uses the PocketBase transaction primitive for authenticated `/api/wts` operations (`pocketbase/pb_hooks/`). Within this primitive, all database work must use the callback's transaction-scoped app; persistence occurs only when the callback succeeds.
- WTS enables the PocketBase transactional batch endpoint in `pocketbase/pb_migrations/1785000001_enable_batch_requests.js`.
- The web application pins `pocketbase` JavaScript SDK `0.26.8` (`package.json`) and the existing gamification accounting store uses `createBatch().send()` for grouped writes (`src/lib/gamification-accounting-store.ts`).
- Migrations under `pocketbase/pb_migrations/` define field-level, composite, and partial unique constraints for existing concerns such as idempotency keys, operation locks, accepted-redemption uniqueness, and admin-action identity. These database constraints—not a preceding existence query—are the repository's race-safe uniqueness primitive.
- Existing admin-action lease state and gamification operation locks demonstrate the relevant coordination shape: persist ownership/idempotency state, acquire it atomically, and make retries converge (`pocketbase/pb_migrations/`, `pocketbase/pb_hooks/`).

**Implication:** the coordination design should model each externally retried command with a stable idempotency identity protected by a unique constraint, and should update command/work state in the same PocketBase transaction as the business transition whenever those records must agree.

### 3. Authenticated server routes and session controls already exist

- WTS namespaces PocketBase custom routes below `/api/wts` and protects sensitive routes with `$apis.requireSuperuserAuth()` (`pocketbase/pb_hooks/`).
- The web server already refreshes PocketBase auth tokens, rejects unverified users where required, applies same-origin checks to mutations, and stores sessions in HttpOnly cookies (server-side code under `src/`).
- Privileged web operations use a server-only PocketBase superuser client (server-side code under `src/`).

**Implication:** administrative coordinator controls should follow the existing authenticated server-side path. A browser should not receive superuser credentials, and adding a worker does not justify bypassing route or collection authorization for human-facing operations.

### 4. Migrations are the schema/configuration delivery mechanism

- WTS uses timestamped JavaScript migrations under `pocketbase/pb_migrations/`.
- The migration enabling batch requests is checked in as `pocketbase/pb_migrations/1785000001_enable_batch_requests.js`.
- `pocketbase/entrypoint.sh` runs migrations before PocketBase starts serving.

**Implication:** check-in collections, indexes, API-rule changes, batch settings, and any coordinator work/lease tables should be delivered as reviewed migrations, not as manual production-dashboard edits.

### 5. Scheduled jobs exist, but their lifecycle is PocketBase's lifecycle

- WTS registers existing daily-report and gamification expired-operational-state jobs through `cronAdd` in `pocketbase/pb_hooks/`.
- PocketBase JavaScript cron handlers execute in their own goroutines inside the PocketBase process.
- No separate worker/coordinator service, queue-consumer command, or worker-specific health check is defined in `docker-compose.yml` or the checked-in application Dockerfiles.

**Implication:** an in-process cron job may safely *discover or enqueue* due work if duplicate execution is neutralized by database constraints/leases. It should not be treated as proof of single ownership, durable execution, or independent supervision.

### 6. Checked-in process supervision and health behavior

- `docker-compose.yml` defines PocketBase and web application services, uses `restart: unless-stopped`, and persists PocketBase data in a named volume.
- Compose probes PocketBase through `/api/health`, and web startup depends on PocketBase service health (`docker-compose.yml`).
- Compose also probes the web root (`docker-compose.yml`).
- The web build is a Nitro Node deployment: `vite.config.ts` selects the `node-server` preset, and the web container starts `node .output/server/index.mjs` (`Dockerfile`).
- The repository identifies Coolify plus Docker Compose as the intended production target (`docker-compose.yml` and repository deployment documentation/configuration).

These checks prove basic process/API liveness and startup dependency ordering in the checked-in Compose model. They do not prove business readiness, coordinator ownership, queue progress, external Hi.Events availability, or printer-station connectivity.

### 7. Nitro background tasks are not a proven primitive in this deployment

- WTS pins `@solidjs/start` `2.0.0-alpha.3`, `@solidjs/vite-plugin-nitro-2` `0.1.0`, and Nitropack `2.13.4` (`package.json`).
- `vite.config.ts` configures the Nitro Node server but does not configure a task runner.
- SolidStart v2 documentation describes Nitro v3's experimental Tasks API, but that documentation does not establish that Tasks are available or operational in the versions and build WTS deploys.

**Implication:** do not base the coordinator design on Nitro Tasks unless a narrow compatibility spike proves the exact pinned build, runtime behavior, restart semantics, and deployment integration. A conventional worker process is easier to supervise explicitly.

## First-party primitive evidence

| Primitive | First-party evidence | What the evidence establishes |
|---|---|---|
| Application transactions | [PocketBase v0.34.0 `core/db_tx.go`](https://github.com/pocketbase/pocketbase/blob/v0.34.0/core/db_tx.go), [PocketBase JS database transaction docs](https://pocketbase.io/docs/js-database/#transaction) | `RunInTransaction`/`runInTransaction` uses a transaction-scoped app. Changes commit only after a successful callback; work inside the callback must use that scoped app. |
| Transactional batch endpoint | [PocketBase v0.34.0 `apis/batch.go`](https://github.com/pocketbase/pocketbase/blob/v0.34.0/apis/batch.go), [Records API](https://pocketbase.io/docs/api-records/) | `POST /api/batch` groups supported requests in a database transaction when batch requests are enabled. It is not a distributed transaction over external services. |
| Migrations | [PocketBase v0.34.0 migration runner](https://github.com/pocketbase/pocketbase/blob/v0.34.0/core/migrations_runner.go), [JS migrations docs](https://pocketbase.io/docs/js-migrations/) | JavaScript migrations are ordered and transactional; serve can apply unapplied migrations. |
| Custom routes and middleware | [PocketBase JS routing docs](https://pocketbase.io/docs/js-routing/) | Hooks can register namespaced routes and attach authentication middleware. |
| Cron jobs | [PocketBase jobs scheduling docs](https://pocketbase.io/docs/js-jobs-scheduling/) | `cronAdd` schedules handlers within the running PocketBase application; handlers run in their own goroutines. This is process-bound scheduling, not a durable external queue. |
| Health endpoint | [PocketBase v0.34.0 `apis/health.go`](https://github.com/pocketbase/pocketbase/blob/v0.34.0/apis/health.go), [Health API docs](https://pocketbase.io/docs/api-health/) | `GET`/`HEAD /api/health` exposes basic API health. The response is not reliable proof of the deployed PocketBase version or workflow readiness. |
| Production topology considerations | [PocketBase production guide](https://pocketbase.io/docs/going-to-production/) | Production operators must explicitly manage persistence, proxying/TLS, backups, process limits, and deployment concerns; PocketBase does not make those guarantees merely by starting. |
| PocketBase 0.34 release identity | [PocketBase v0.34.0 release](https://github.com/pocketbase/pocketbase/releases/tag/v0.34.0) | Anchors source-level primitive claims to the version pinned by `pocketbase/Dockerfile`; it does not prove the production container uses that version. |
| Nitro Node runtime | [Nitro Node deployment docs](https://nitro.build/deploy/runtimes/node) | `.output/server/index.mjs` is the standalone Node server entrypoint and handles `SIGINT`/`SIGTERM` graceful shutdown. |
| SolidStart background tasks | [SolidStart v2 background tasks](https://docs.solidjs.com/solid-start/v2/guides/background-tasks), [deployment plugins](https://docs.solidjs.com/solid-start/v2/guides/deployment-plugins) | Documents the experimental Nitro v3 Tasks direction, but does not prove compatibility with WTS's pinned Nitro 2-era packages. |
| Compose on Coolify | [Coolify Docker Compose docs](https://coolify.io/docs/knowledge-base/docker/compose), [Coolify health-check docs](https://coolify.io/docs/knowledge-base/health-checks) | Coolify can deploy Compose definitions and use health checks, but repository content alone does not disclose the live application's imported Compose, replica count, rollout, or restart configuration. |

## Decision implications

### A. Treat PocketBase as the durable coordination ledger

Store command identity, current state, attempt count, lease owner/expiry, last error, and externally returned identifiers in PocketBase. Use a unique index on the stable business/idempotency identity. The winning transaction creates or acquires the work item; losing retries read the existing result rather than repeat an external action.

A uniqueness violation should be an expected concurrency outcome that resolves to “load the existing operation,” not a generic 500. Read-before-write checks alone are not sufficient under concurrent scanners, kiosks, or retrying web requests.

### B. Keep transaction boundaries local

PocketBase transactions and `/api/batch` can atomically change PocketBase records. They cannot atomically commit Hi.Events, printer, email, or other network side effects. Use an outbox/work-record pattern:

1. atomically commit the WTS business transition plus pending work record;
2. claim work using a database-backed lease or operation lock;
3. call the external service with a stable idempotency identity where supported;
4. atomically persist success/failure and the external identifier; and
5. allow expired leases and failed attempts to be retried safely.

Do not hold a PocketBase database transaction open across slow network or printer calls.

### C. Decide explicitly between in-process cron and a third service

**PocketBase cron is adequate only if** the operation is short, process coupling is acceptable, duplicate scheduler invocations are harmless because database acquisition is authoritative, and operator visibility through PocketBase/application logs is sufficient.

**Add a worker/coordinator service if** it must restart independently, expose its own health/readiness, drain work during deployments, maintain explicit single ownership, use a different runtime/toolchain, or be scaled and observed separately. If added, define it in Compose/Coolify with:

- a single explicit command and restart policy;
- no embedded superuser secret in the browser image;
- a least-privilege authentication method;
- liveness and dependency-aware readiness endpoints;
- durable work state in PocketBase, not process memory;
- lease expiry, bounded retries, dead-letter/operator recovery semantics; and
- rollout ordering that prevents new producers from requiring a schema/worker unavailable during mixed-version deployment.

### D. Expand readiness beyond `/api/health`

Keep `/api/health` as a PocketBase process/API liveness check. Add business readiness separately where needed. A coordinator readiness check should be able to establish, without mutating real business data, that:

- the expected migration/schema generation is present;
- PocketBase is readable and, if safe, can complete a scoped write/delete probe;
- only the intended worker owns or can acquire coordinator work;
- required external APIs are configured and reachable under bounded timeouts;
- queue age/failure counts remain within operational thresholds; and
- printer-station connectivity is reported separately from server readiness if stations are intermittently offline.

Readiness failures should stop new work from being assigned without killing a process that needs to finish or relinquish already leased work.

### E. Design rollouts for mixed versions and rollback

Schema changes should be backward-compatible across the rollout window: add new collections/fields/indexes first, deploy consumers next, switch producers after consumers are ready, and remove obsolete fields only in a later release. A rollback must not require reversing already-emitted external side effects. Preserve operation records and external identifiers so operators can reconcile instead.

## Unknowns and required production probes

These are blockers to claiming deployment readiness, not invitations to infer values from the repository.

1. **Actual PocketBase image/version.** Inspect the live Coolify deployment/container image reference and immutable digest, then identify the binary version from trusted container metadata or an approved non-secret command. Reconcile it with local 0.30.4 and Dockerfile-pin 0.34.0 evidence. The public health endpoint is insufficient.
2. **Actual deployed Compose definition.** Confirm whether Coolify currently deploys this exact `docker-compose.yml`, including overrides, generated settings, service commands, named volumes, and health checks.
3. **Replica/process count.** Confirm the live replica count for PocketBase and the web service, during steady state and rollout. Multiple PocketBase `serve` processes would each register in-process cron jobs; database acquisition must remain authoritative even if the intended count is one.
4. **Rollout and restart behavior.** Record Coolify's update order, stop grace period, health-check grace/retries, restart behavior, rollback behavior, and whether old and new revisions overlap.
5. **Batch limits.** Inspect the deployed PocketBase batch settings—enabled state, maximum requests, body-size limit, and timeout. The repository migration proves `enabled=true`, not the complete effective production settings.
6. **Migration/readiness behavior.** Verify a staging deployment with pending and failing migrations. Confirm PocketBase does not become healthy before required migrations are complete and that a failed migration prevents dependent services from accepting traffic.
7. **Backup and restore.** Establish the live backup target/schedule, retention, encryption, alerting, filesystem durability, and a timed restore test. A named Compose volume is persistence, not a backup.
8. **Settings and secret protection.** Confirm PocketBase settings encryption and Coolify secret injection without reading or copying secret values. Confirm no superuser credential reaches client-side bundles or generic worker logs.
9. **Coordinator lifecycle.** Decide whether coordination uses PocketBase cron or a separately supervised worker. If a worker is chosen, its service definition, command, authentication, health/readiness, lease model, shutdown/drain behavior, deployment ordering, and observability remain to be implemented and tested.
10. **External dependencies.** Probe Hi.Events and printer-station behavior in a non-production or approved test path: timeout, retry, idempotency support, duplicate response, offline duration, recovery, and reconciliation semantics.
11. **Business-level observability.** Define alerts and operator views for oldest pending work, expired leases, retry count, terminal failures, duplicate suppression, and unmatched external identifiers. Process health alone cannot detect a stuck queue.

## Sources

### Repository-local

- `pocketbase/Dockerfile`
- `pocketbase/get-pocketbase.sh`
- `pocketbase/CHANGELOG.md`
- `pocketbase/entrypoint.sh`
- `pocketbase/pb_migrations/`
- `pocketbase/pb_migrations/1785000001_enable_batch_requests.js`
- `pocketbase/pb_hooks/`
- `docker-compose.yml`
- `Dockerfile`
- `vite.config.ts`
- `package.json`
- server-side application code under `src/`
- existing `src/lib/gamification-accounting-store.ts`

### First-party and issue context

- https://github.com/WhatTheStackConf/wts/issues/21
- https://github.com/WhatTheStackConf/wts/issues/19
- https://github.com/pocketbase/pocketbase/blob/v0.34.0/core/db_tx.go
- https://github.com/pocketbase/pocketbase/blob/v0.34.0/apis/batch.go
- https://github.com/pocketbase/pocketbase/blob/v0.34.0/apis/health.go
- https://github.com/pocketbase/pocketbase/blob/v0.34.0/core/migrations_runner.go
- https://github.com/pocketbase/pocketbase/releases/tag/v0.34.0
- https://pocketbase.io/docs/js-database/#transaction
- https://pocketbase.io/docs/js-routing/
- https://pocketbase.io/docs/js-jobs-scheduling/
- https://pocketbase.io/docs/js-migrations/
- https://pocketbase.io/docs/api-records/
- https://pocketbase.io/docs/api-health/
- https://pocketbase.io/docs/going-to-production/
- https://nitro.build/deploy/runtimes/node
- https://docs.solidjs.com/solid-start/v2/guides/background-tasks
- https://docs.solidjs.com/solid-start/v2/guides/deployment-plugins
- https://coolify.io/docs/knowledge-base/docker/compose
- https://coolify.io/docs/knowledge-base/health-checks
- https://pb-2026.wts.sh/api/health
