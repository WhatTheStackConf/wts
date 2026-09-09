# Station agent and coordinator runtime

Issue #48 provides an independently supervised machine protocol, not a printer driver. There is **no USB access, raster transmission, automatic authorization/start, or physical output** in these CLIs. `operationsEnabled` remains false. Actual calibration, Pi power-loss testing, production topology and event-use approval remain outstanding.

## Build and smoke

Use Node 22.23.2 (native experimental `node:sqlite`, no native npm journal dependency) and the repository's pinned pnpm. Compile with `pnpm build:checkin-runtime` after the web build, which can replace `.output`. Deploy `.output/checkin-runtime/*.js`, the root ESM package manifest, and production dependencies together under `/opt/wts`.

Run the tracked disposable smoke and focused tests:

```sh
pnpm exec vp test run src/lib/checkin-agent-runtime.test.ts
```

The smoke compiles the actual entrypoint, starts an isolated PocketBase with unchanged feature migrations/hooks and disposable credentials, runs separate coordinator/agent CLI processes over loopback, verifies the persisted heartbeat and then verifies sticky quarantine after journal loss. It neither reads production environment files nor communicates with a printer. It is not production/systemd/Pi evidence.

## Configuration and process separation

All JSON configuration and credential files must be regular private files (0600 or 0400), readable by the respective service user. CLI arguments contain **only a subcommand and configuration path**. Do not put tokens/passwords in argv, `PUBLIC_*`, `VITE_*`, browser storage or logs. No `.env` is loaded. Do not copy the coordinator credential file to a Pi.

Coordinator `/etc/wts-checkin/coordinator.json`:

```json
{
  "pocketbaseUrl": "http://127.0.0.1:8090",
  "superuserCredentialFile": "/run/credentials/wts-checkin-coordinator.service/pocketbase",
  "host": "127.0.0.1",
  "port": 8787,
  "heartbeatIntervalMs": 5000,
  "heartbeatTimeoutMs": 15000,
  "authorizationTtlMs": 10000
}
```

The systemd `LoadCredential` source `/etc/wts-checkin/pocketbase-credential.json` is a private JSON object with `email` and `password` for the server-only PocketBase superuser. Authentication occurs on startup and is bounded. Controlled authentication failures require an explicit restart after diagnosis; only unexpected crashes use the bounded supervisor restart policy. The coordinator CLI binds HTTP only to loopback. Configure a separate HTTPS reverse proxy for remote Pis, restricted to POST `/v1/agent`; disable request-body and Authorization logging. Preserve the coordinator's rejection of Cookie/Origin/browser metadata. Never proxy this route into a browser session API. The agent refuses non-HTTPS endpoints except loopback, and both clients reject redirects.

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
  "pollIntervalMs": 5000
}
```

An empty profile is unconfigured and cannot authorize. Never edit an initialized journal's identity: the assignment is immutable and a changed identity fails closed. The credential source `/etc/wts-checkin/agent-token` contains only the issued `wts_agent_` bearer. `once: true` is available for a one-heartbeat disposable diagnostic, not continuous service operation.

Commands (after installing private config/service users and directories):

```sh
# Explicit first-time journal initialization, with the service stopped.
# Run as the agent service user; the lock path is identical to the service.
flock --nonblock --no-fork /var/lib/wts-checkin-agent/owner.lock \
  node /opt/wts/.output/checkin-runtime/cli.js init-agent /etc/wts-checkin/agent.json
node /opt/wts/.output/checkin-runtime/cli.js coordinator /etc/wts-checkin/coordinator.json
# Manual agent invocations MUST also hold this same stable owner lock.
flock --nonblock --no-fork /var/lib/wts-checkin-agent/owner.lock \
  node /opt/wts/.output/checkin-runtime/cli.js agent /etc/wts-checkin/agent.json
```

Use the separate templates in `deployment/systemd/`. They are examples to install and validate on the target host, not an asserted deployment. Verify the pinned Node executable path before installation; the templates use `/usr/bin/node`, which is not present on every host. Local `systemd-analyze verify` passed only after substituting this workstation's actual Node path into temporary copies; no unit was installed or started. The agent uses OS `flock --nonblock --no-fork` for lifetime ownership. The one fixed lock covers the assigned journal/device; never run an alternative config under another lock against the same device. `PrivateDevices=yes` and `DevicePolicy=closed` deliberately deny printer access. Service hardening separates users, credentials, writable journal state and read-only application code. No systemd command was run against production.

## Recovery and retry contract

- Provisioning exclusively creates a new file and refuses any existing path. Opening never initializes a missing/corrupt replacement. SQLite uses FULL synchronous transactions and a checksummed identity/sequence/attempt snapshot. Each heartbeat advances the sequence durably before sending. File replacement during an open process and stale local concurrent writers fail closed.
- Lost/corrupt/identity-replaced journals send a bounded failure heartbeat, including when opening fails. This asks the central ledger to quarantine; if the network is unavailable, exit rather than claim delivery. Restore detection depends on comparison with a higher central observation: an older valid local snapshot is not intrinsically distinguishable in isolation. Never restore or initialize a replacement journal to clear quarantine. Keep the station disabled and perform audited recovery/reconciliation.
- Receipt preserves exact attempt/profile/payload identity. Authorization stores a random-derived SHA-256 authorization hash before sending and reuses it on explicit retry, including after restart. Store and validate the authorization envelope before start. Wall-clock and monotonic deadlines reject expiry, clock rollback and delayed responses. Restart requires a fresh successful coordinator authorization response before the local start seam becomes available again.
- Before the start-validation request, persist `possibly_starting`. Neither HTTP failures nor a process restart may replay start. Successful return represents only the future protocol seam; there is no device effect here. Lost responses are reportable only as `output_uncertain`.
- Outcome intent is persisted before sending. Explicit retries reuse exactly the same outcome/hash, including after reopen and credential expiry/revocation; changing an outcome is rejected. An empty `reportUntil` means reporting remains allowed until lifecycle purge, not unlimited data retention. The CLI does not synthesize successful output reports. Unresolved started output blocks the whole fixed station, including replacement agents.
- Heartbeat/work/status retry at most three times per batch with jitter and capped exponential delay, honoring Retry-After. Backpressure longer than 30 seconds terminates the bounded batch rather than retrying early. Definite 4xx rejection (other than 429) does not retry. Authorize/start/outcome have no automatic transport retries. Network calls and JSON response size are bounded; errors/logs expose generic categories only.
- Controlled runtime failures (including exhausted read retries, revoked credentials and journal quarantine) exit with status 78. Both systemd templates prevent automatic restart for that status: investigate, then explicitly restart. Unexpected process crashes retain a separately bounded supervisor restart policy. A supervisor must never replenish an exhausted request retry budget.
- Credential rotation retains the highest observed sequence/digest for the stable station/journal identity, including rotation away and back. Replacing a bearer is not permission to reset journal history; changed stable identities remain quarantined.
- Validated administrative storage failures roll back station/agent authority changes before recording a bounded failed Admin Action. Exact retries retain its action/target identity and cannot overwrite a newer attempt. A hard crash or further storage failure between rollback and failure-history persistence can leave no failed record; absence of such a record is not evidence that a command was never submitted. This limitation does not allow partially committed authority or automatic replay of external effects.

## Rollout and retention boundaries

Install additive schema first; stop-and-drain coordinator updates, then agents, then enable one station only under owner control. No overlapping coordinator producer is intended. Preserve queued/in-flight records and keep unknown output unresolved. A server lease cannot cancel a request already sent.

The journal currently stores attempt IDs/hashes and protocol evidence, not names, email or raster data. Treat its linkable references as attendee-linked retention data. At the approved closure+30-day deadline stop and disable the agent, retire/wipe journal files and backups according to the approved storage-erasure procedure, and reconcile before explicit re-provisioning; SQL deletion or overwriting is not a secure-erasure claim. Offline Pis must not resume from an expired snapshot. Automated purge orchestration and the backup operator's concrete expiry/restore procedure remain follow-up work; this slice does not claim retention compliance or safe hardware reuse.
