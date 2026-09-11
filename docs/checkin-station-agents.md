# Station agent and coordinator runtime

The supervised protocol now includes admission, reset, journal recovery, monitoring and retirement. See [current operating/acceptance guide](checkin-operations-and-acceptance.md) for software evidence and remaining deployment/device gates. The legacy preflight `operationsEnabled: false` field is not a live authorization switch. Station-1 calibration evidence is retained separately; local execution is not production readiness or approval for every station.

## Build and smoke

Use Node 22.23.2 (native experimental `node:sqlite`, no native npm journal dependency) and the repository's pinned pnpm. `pnpm build` compiles the runtime after the web build, which can replace `.output`; use `pnpm build:checkin-runtime` for a standalone rebuild. Deploy the entire `.output/checkin-runtime/` tree (both `runtime/checkin/` and `src/lib/`), the root ESM package manifest, lockfile/workspace build policy, and target-native production dependencies together under `/opt/wts`. The web Docker image alone does not supply root runtime dependencies. See [deployment readiness](checkin-deployment-readiness.md) for migration ordering, artifact boundaries, station permissions and outstanding host/configuration blockers.

Run the tracked disposable smoke and focused tests:

```sh
pnpm exec vp test run src/lib/checkin-agent-runtime.test.ts
```

The smoke compiles the actual entrypoint, starts an isolated PocketBase with unchanged feature migrations/hooks and disposable credentials, runs separate coordinator/agent CLI processes over loopback, verifies the persisted heartbeat and then verifies sticky quarantine after journal loss. It neither reads production environment files nor communicates with a printer. It is not production/systemd/Pi evidence.

## Configuration and process separation

Package the compiled runtime into a new, empty release directory with `node scripts/package-checkin-runtime.mjs /path/to/new-release`. The manifest records every shipped file checksum and explicitly excludes native dependencies, credentials, normal PocketBase data and test modules. On a compatible target/staging machine, run `pnpm install --prod --frozen-lockfile`, then `node scripts/verify-checkin-runtime.mjs` from that release. The latter checks manifest integrity, native imports, a synthetic raster and a disposable journal reopen without contacting the network or opening a printer. This is not a signed-origin guarantee or device/production approval. Never copy x86 node_modules onto an ARM station.

All JSON configuration and credential files must be regular private files (0600 or 0400), readable by the respective service user. CLI arguments contain **only a subcommand and configuration path**. Do not put tokens/passwords in argv, `PUBLIC_*`, `VITE_*`, browser storage or logs. No `.env` is loaded. Do not copy the coordinator credential file to a Pi.

Coordinator `/etc/wts-checkin/coordinator.json`:

```json
{
  "pocketbaseUrl": "http://127.0.0.1:8090",
  "superuserCredentialFile": "/run/credentials/wts-checkin-coordinator.service/pocketbase",
  "admissionCredentialFile": "/run/credentials/wts-checkin-coordinator.service/hievents",
  "host": "127.0.0.1",
  "port": 8787,
  "heartbeatIntervalMs": 5000,
  "heartbeatTimeoutMs": 15000,
  "authorizationTtlMs": 10000
}
```

The systemd `LoadCredential` source `/etc/wts-checkin/pocketbase-credential.json` is a private JSON object with `email` and `password` for the server-only PocketBase superuser. Authentication occurs on startup and is bounded. Controlled authentication failures require an explicit restart after diagnosis; only unexpected crashes use the bounded supervisor restart policy. The coordinator CLI binds HTTP only to loopback. Configure a separate HTTPS reverse proxy for remote Pis, restricted to POST `/v1/agent`; disable request-body and Authorization logging. Preserve the coordinator's rejection of Cookie/Origin/browser metadata. Never proxy this route into a browser session API. The agent refuses non-HTTPS endpoints except loopback, and both clients reject redirects.

The separate private `hievents-credential.json` contains exactly `apiUrl`, `apiKey`, and `accountId` (all strings), using the server-only contract in [Hi.Events configuration](checkin-hievents-contract.md). An explicitly supplied but invalid/missing/world-readable file fails startup with a redacted `invalid_config`; it never silently turns admission off. Omitting `admissionCredentialFile` retains legacy environment configuration for controlled diagnostics; startup reports `admission: "disabled"` when no valid processor is configured. The normal systemd template requires both credential sources. Do not copy either server credential to a Pi.

Before acquiring coordinator ownership, startup verifies the actual snapshot fields in `checkin_arrival_workflows` and `checkin_print_attempts`. Missing or incompatible schema exits with `schema_incompatible` and status 78; HTTP health or a zero migration CLI exit alone cannot establish schema readiness. Verify the complete release migrations and hooks separately before service start.

Agent `/etc/wts-checkin/agent.json` (replace identity/profile references with the explicitly issued assignment):

```json
{
  "identity": {
    "stationId": "wts2026station1",
    "agentIdentity": "assigned-pi",
    "printerIdentity": "assigned-printer",
    "journalIdentity": "assigned-journal",
    "profileId": ""
  },
  "journalPath": "/var/lib/wts-checkin-agent/journal.sqlite",
  "coordinatorUrl": "https://checkin-coordinator.example.invalid",
  "agentCredentialFile": "/run/credentials/wts-checkin-agent.service/agent-token",
  "pollIntervalMs": 5000,
  "printerMode": "serial",
  "printerAddress": "/dev/serial/by-id/usb-NIIMBOT_B1_LABEL_PRINTER_<serial>-if00",
  "printerDebug": false
}
```

An empty profile is unconfigured and cannot authorize. Never edit an initialized journal's identity: the assignment is immutable and a changed identity fails closed. The credential source `/etc/wts-checkin/agent-token` contains only the issued `wts_agent_` bearer. `once: true` is available for a one-heartbeat disposable diagnostic, not continuous service operation.

`printerMode: "serial"` is required for physical output and must be paired with the exact stable `/dev/serial/by-id/...` path. `printerMode: "simulated"` is test-only. A queued work item with no printer mode fails closed as `printer_unconfigured`; it is never reported as printed.

Commands (after installing private config/service users and directories):

```sh
# Explicit first-time journal initialization, with the service stopped.
# Run as the agent service user; the lock path is identical to the service.
flock --nonblock --no-fork /var/lib/wts-checkin-agent/owner.lock \
  node /opt/wts/.output/checkin-runtime/runtime/checkin/cli.js init-agent /etc/wts-checkin/agent.json
node /opt/wts/.output/checkin-runtime/runtime/checkin/cli.js coordinator /etc/wts-checkin/coordinator.json
# Manual agent invocations MUST also hold this same stable owner lock.
flock --nonblock --no-fork /var/lib/wts-checkin-agent/owner.lock \
  node /opt/wts/.output/checkin-runtime/runtime/checkin/cli.js agent /etc/wts-checkin/agent.json
```

Use the separate templates in `deployment/systemd/`. They are examples to install and validate on the target host, not an asserted deployment. Verify the pinned Node executable path before installation; the templates use `/usr/bin/node`, which is not present on every host. A Node executable under `/home` is hidden by `ProtectHome=yes`; substituting it in temporary copies for local `systemd-analyze verify` proves syntax only, not a runnable service. The agent uses OS `flock --nonblock --no-fork` for lifetime ownership. The one fixed lock covers the assigned journal/device; never run an alternative config under another lock against the same device. `PrivateDevices=no` is required for serial access. Replace `<serial>` in `DeviceAllow` with the station's exact by-id serial, matching `printerAddress`: systemd does not expand device-path globs. Keep `DevicePolicy=closed` and separately grant the service user UNIX device permissions through an approved narrowly scoped udev rule or device-group assignment. Connect the device before service start; a changed kernel device number after hotplug requires paused/reconciled work and an explicit service restart. Service hardening separates users, credentials, writable journal state and read-only application code. No unit was installed or started and no systemd command was run against production.

## Recovery and retry contract

- Provisioning exclusively creates a new file and refuses any existing path. Opening never initializes a missing/corrupt replacement. SQLite uses FULL synchronous transactions and a checksummed identity/sequence/attempt snapshot. Each heartbeat advances the sequence durably before sending. File replacement during an open process and stale local concurrent writers fail closed.
- Lost/corrupt/identity-replaced journals send a bounded failure heartbeat, including when opening fails. This asks the central ledger to quarantine; if the network is unavailable, exit rather than claim delivery. Restore detection depends on comparison with a higher central observation: an older valid local snapshot is not intrinsically distinguishable in isolation. Never restore or initialize a replacement journal to clear quarantine. Keep the station disabled and perform audited recovery/reconciliation.
- Receipt preserves exact attempt/profile/payload identity. Authorization stores a random-derived SHA-256 authorization hash before sending and reuses it on explicit retry, including after restart. Store and validate the authorization envelope before start. Wall-clock and monotonic deadlines reject expiry, clock rollback and delayed responses. Restart requires a fresh successful coordinator authorization response before the local start seam becomes available again.
- Before the start-validation request, persist `possibly_starting`; immediately before the first device command, persist `possibly_printing`. Neither HTTP failures nor a process restart may replay start or printer I/O. Lost responses are reportable only as `output_uncertain`.
- Outcome intent is persisted before sending. Explicit retries reuse exactly the same outcome/hash, including after reopen and credential expiry/revocation; changing an outcome is rejected. An empty `reportUntil` means reporting remains allowed until lifecycle purge, not unlimited data retention. The CLI does not synthesize successful output reports. Unresolved started output blocks the whole fixed station, including replacement agents.
- Heartbeat/work/status retry at most three times per batch with jitter and capped exponential delay, honoring Retry-After. Backpressure longer than 30 seconds terminates the bounded batch rather than retrying early. Definite 4xx rejection (other than 429) does not retry. Authorize/start/outcome have no automatic transport retries. Network calls and JSON response size are bounded; errors/logs expose generic categories only.
- Controlled runtime failures (including exhausted read retries, revoked credentials and journal quarantine) exit with status 78. Both systemd templates prevent automatic restart for that status: investigate, then explicitly restart. Unexpected process crashes retain a separately bounded supervisor restart policy. A supervisor must never replenish an exhausted request retry budget.
- Credential rotation retains the highest observed sequence/digest for the stable station/journal identity, including rotation away and back. Replacing a bearer is not permission to reset journal history; changed stable identities remain quarantined.
- Validated administrative storage failures roll back station/agent authority changes before recording a bounded failed Admin Action. Exact retries retain its action/target identity and cannot overwrite a newer attempt. A hard crash or further storage failure between rollback and failure-history persistence can leave no failed record; absence of such a record is not evidence that a command was never submitted. This limitation does not allow partially committed authority or automatic replay of external effects.

## Rollout and retention boundaries

Install additive schema first; stop-and-drain coordinator updates, then agents, then enable one station only under owner control. No overlapping coordinator producer is intended. Preserve queued/in-flight records and keep unknown output unresolved. A server lease cannot cancel a request already sent.

The journal stores the minimum recoverable label payload (name and affiliation plus pinned profile/version data) only for queued or in-flight print attempts, alongside attempt IDs/hashes and protocol evidence; it never stores email, QR/list capability or raw raster data. Treat those payloads as attendee-linked retention data. At the approved closure+30-day deadline stop and disable the agent, retire/wipe journal files and backups according to the approved storage-erasure procedure, and reconcile before explicit re-provisioning; SQL deletion or overwriting is not a secure-erasure claim. Offline Pis must not resume from an expired snapshot. Automated purge orchestration and the backup operator's concrete expiry/restore procedure remain follow-up work; this slice does not claim retention compliance or safe hardware reuse.
