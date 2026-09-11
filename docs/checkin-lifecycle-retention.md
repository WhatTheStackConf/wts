# Lifecycle backend handoff and restore runbook

## Verified scope

Service API unchanged: `status()`, `close({operationId, confirmEdition})`,
`approveRestore({generation, confirmEdition})`. Closure is irreversible, distinct
from a temporary stop. Fixed deadline is closedAt + 2,592,000,000 ms. Tests use
actual disposable PocketBase 0.30.4, installed feature/ledger guards and real
SQLite journal files. No live service or printer is used. 0.34.0 uses the same
intended API surface but was not exercised in this lane; do not infer 0.36 APIs.

## Station agent CLI lifecycle (implemented)

`agent-lifecycle.ts` gates the actual agent entrypoint before recovery, heartbeat,
work or printer creation. `/v1/agent` accepts `policy` with exact station/journal
and `purge_complete` with the retirement receipt. The coordinator hashes the
original agent bearer and calls the superuser-only
`/api/wts/checkin-lifecycle-proxy`; this route authenticates the hash, station AND
journal before reading policy. No PB credential reaches the Pi. Revoked/expired
original credentials retain only their own reporting/retirement authority.

The existing journal directory owns `lifecycle-fence.json` (policy fields only,
0600, atomic rename plus file/directory fsync) and allowlisted flat `spool/` files.
No additional systemd writable path or lock is needed: preserve outer `flock`.
Closed agents do reporting/neutralization only. A cached deadline retires locally
before network calls, even offline; receipt delivery retries on later cycles or
restart. Every receipt reruns exact journal/spool validation and retirement.
Missing, corrupt, foreign, symlinked or hardlinked material blocks receipt and
remains outstanding. No learned closure means no invented deadline or offline
active authority. Operator remediation must not recreate a missing journal.

The compiled CLI integration test uses disposable PB, a pending synthetic label,
a revoked/expired original credential, offline proxy, receipt readback and unsafe
material cases; it never connects a real printer.

## Central worker wiring contract (separate coordinator lane)

POST `/api/wts/checkin-lifecycle-worker` is superuser-only, server-to-server.
Never expose it directly to a browser/Pi or forward arbitrary client bodies.
Worker owns `nowMs`; agent-supplied clocks are not authoritative centrally.

- `tick`: deadline deletion transaction. Schedule even with no ready agents.
- `compact`: after tick reports centralDeletedAt; checkpoint + VACUUM + checkpoint;
  only then persist centralCompactedAt. Run off the request/effect hot path.
- `device_policy`: `{credentialHash, stationId}` returns
  `{edition:'WTS2026',mode:'purge_only',purgeDeadline,purgeToken,stationId,
  journalIdentity,completed}` for a CLOSED edition. Current endpoint rejects an
  open edition; do NOT treat that rejection as active authority.
- `device_complete`: same credential binding plus `{purgeToken,journalIdentity,
  method:'retired_and_compacted'}`. Stable receipt is retryable; mismatched tokens,
  identities and early receipts fail. Expired/revoked machine credential hashes
  can authenticate this isolated retirement path ONLY, never work/status authority.
  Coordinator hashes the authenticated raw machine credential itself, not a
  client-provided hash. Do not gate retirement on normal active-agent readiness.
- `reconcile_restore`: `{generation,evidenceDigest:<64 hex>,
  identitiesReconciled:true,hiEventsReconciled:true,unresolved:0}` from an actual
  supervised read-only reconciliation worker. These are attestations, not a
  browser checkbox. Current hook validates the attestation, not its substance.

### Fresh agent authority vs irreversible local fence

1. Acquire exclusive OS ownership of state root and USB for the entire process.
2. Before journal replay, transport initialization or USB: call
   `localLifecycleMode(root)` and `canRequestActiveAuthority(root)`.
3. `purge_only` means NEVER request/accept active authority for this state root.
   Load the stored policy (full policy is in lifecycle-fence.json), authenticate
   purge-only when online, quiesce and retire at the deadline even offline.
4. `quarantined` is deliberately NOT active. `canRequestActiveAuthority` true
   merely means no local fence exists and a server handshake may be attempted.
   It DOES NOT prove a journal exists, is healthy, or has the expected identity.
   Open the existing AgentJournal normally; never auto-provision empty history.
5. For an unfenced, valid known journal, parent must obtain explicit live server
   lifecycle status proving edition open AND restoreRequired false, then perform
   existing credential/identity/generation/digest/readiness checks. Only that
   conjunction yields ephemeral ACTIVE authority. Network/errors deny activity.
   The legacy worker endpoint has no open-edition active response. The CLI uses
   the authenticated lifecycle-proxy response instead, never a 400 fallback.
6. A malformed fence or mismatched policy is intervention-required quarantine.
   Never delete/overwrite it to repair readiness. Missing fence after disk loss
   is NOT safe: central journal watermark checks remain required. Offline reboot
   cannot obtain fresh active authority.
7. Recheck central lifecycle at intake, dispatch, pre-start and restart; do not
   blindly replay queued work. Stop/close does not promise instant USB abort.
   Already-started outcome reports may complete before purge; after deletion
   they must not recreate history or extend the deadline.

`retireCheckinJournal` requires exclusive ownership; `quiesce` closes the journal,
awaits in-flight physical work and clears in-memory rendered payloads. It checks
station/journal identity + journal digest before writing, binds fence/token/deadline,
compacts the actual database and retires it. Receipt retries re-run retirement,
including if a stale same-identity journal was copied over the retired file.
Missing/corrupt identity cannot be automatically erased: report outstanding and
use supervised inventory/wipe. No arbitrary recursive deletion. Only regular,
single-link flat `spool/*.{raster,png,bin}` files are accepted; other material is
an inventory error. Ancestor symlinks, file symlinks, traversal are rejected.
There is no crash-stale lock directory; OS ownership belongs to caller.

## Retention registry and remaining merge checks

`checkin-lifecycle.js` exports `PURGE_TABLES` (baseline seven attendee-linked
collections) and `OPTIONAL_PURGE_TABLES` (recovery/monitoring additive slices).
Registry includes recovery resets, isolations, cancellations, observations,
reads, audit, commands, workflows; monitoring audit, commands, deliveries,
incidents. Missing optional collections are skipped. Parent must test with BOTH
actual slice migrations/hooks installed and guard their creates/updates after
closure/deletion. Add future attendee-bearing collections explicitly; never
mark deletion complete while an unregistered attendee link remains.

Generic `admin_actions` checkin envelopes are deleted; agent journal digest and
sequence cleared; lifecycle audit actor/operation identifiers scrubbed at purge.
Only workflow/print counts are anonymous totals. Device identity, machine auth
hashes, station/profile/event configuration, user accounts and monitoring
recipient configuration are operational records, NOT anonymous data. They must
not contain attendee free text. Audit links in retained profile configuration
point to removed admin actions, not retained attendee records. No Hi.Events
adapter is imported or called by this lifecycle worker.

No central raster storage exists in the baseline (renderer uses memory). Parent
must inventory any later central spool/cache or monitoring email archive. Do not
claim an external email archive, PB logs or snapshots were purged by SQL deletion.

## Backup, expiry and restore procedure

1. Stop producers and obtain exclusive filesystem/database ownership. Inventory
   central DB/WAL, Pi journals/sidecars/spools, PB backups, replicas, snapshots,
   logs and any email provider archive. Record each feature-bearing backup's
   fixed edition deadline in a restricted external manifest.
2. Exclude feature state from general long-lived backups where possible. If a
   mixed DB backup contains attendee records, its WHOLE backup must expire by
   this deadline; it cannot remain just because it also contains other data.
3. `expireFeatureBackups(root, manifest, nowMs)` expires explicit regular files
   only, never a recursive directory. Test proves deadline/allowlist behavior.
   Schedule it; configure object version/snapshot/replica expiry separately.
   Unlink/VACUUM are logical retirement, not guaranteed SSD/flash secure erasure.
4. Restore only into a disconnected/disabled deployment. Restored PB with
   boot_seen=true increments restoreGeneration, disables system/stations,
   rotates coordinator ownership and applies overdue deletion before serving.
   Old pre-lifecycle backups require manually disabled configuration and the
   lifecycle migration before network access; first-ever bootstrap is NOT a
   cryptographic restore detector.
5. Run tick + compact when overdue, verify all registry tables are empty, check
   every local device receipt or keep it visibly outstanding. Never enable a
   closed edition. Lost/offline devices need supervised wipe before reuse.
6. For open editions reconcile original workflow/attempt identities with known
   agents and exact Hi.Events lists read-only. Unknown journal/possibly-sent
   outcomes remain unresolved, never authorization to resend. Submit evidence
   for the CURRENT restore generation; admin explicitly approves afterwards.
7. Approval does not enable stations/system. Parent must ensure reconciliation
   neutralizes old queues before explicit enable; no blanket replay permission.

## Verification checkpoint

Six tests passed across lifecycle.integration, lifecycle-files and
lifecycle-persistence.integration on PB 0.30.4; runtime tsc passed. The first
real purge test found/fixed PB empty-string bound-filter inventory duplication
which otherwise blocked deadline deletion. Vite reports an existing 10-second
shutdown-handle warning after successful tests. Additive registry changes must
be rerun before merge; end-to-end runtime wiring remains the parent lane.
