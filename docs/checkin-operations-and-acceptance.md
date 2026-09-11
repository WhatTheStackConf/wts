# WTS check-in operating and acceptance guide

## Status and evidence boundary — 2026-09-11

The camera/lookup, recovery, monitoring, retention and supervised runtime implementation is integrated locally. **This is not deployment or event-use approval.** Do not enable production from passing synthetic tests. Production credentials, backups, endpoints and physical-station acceptance are separate gates below.

Verified in the actual `/var/home/darko/Work/wts` checkout:

| Gate | Result |
| --- | --- |
| `pnpm test` | 1,113 passing tests, 105 files; includes the preserved public-API suite |
| `pnpm typecheck` | Pass |
| `pnpm check` | Pass, 0 errors; warnings remain visible |
| `pnpm build` | Pass, production server syntax and runtime TypeScript included |
| `pnpm test:checkin-browser` | 41 passing actual-app browser scenarios, disposable PocketBase and synthetic upstream/media |
| `pnpm test:checkin-lifecycle-browser` | 1 passing isolated actual-app closure/lost-response scenario |
| `pnpm test:checkin-components` | 34 passing mounted component/browser scenarios; explicitly mocked transport |
| PocketBase 0.34.0 compatibility snapshot | 183 passing integration tests across 26 files; original database/binary unchanged |

`checkin-migration-history.integration.test.ts` reads back every selected prerequisite/feature migration and the runtime's required field names/types. The profile-snapshot migration remains after journaled delivery. The feature sequence currently ends at `1790000016_checkin_arrival_projection.js`; do not infer migration success from exit status alone. Compatibility tests use fresh disposable databases, not production data or production schema readback.

A Vite/Nitro shutdown/open-handle warning remains in unit runs despite successful exits. Component mocks, synthetic upstream effects, printer protocol completion, central PocketBase state, local journal state and visible physical output are distinct evidence. None of this run's automated output is a new physical-label claim.

## Before opening a station

1. An admin configures edition membership, the exact event/list/affiliation mapping and an explicitly approved label profile for each physical station. Reusing another printer's profile is not approval.
2. Provision a human phone with the station QR after login. Station provisioning QR authority is separate from an attendee QR. Verify the displayed station/event before intake.
3. Verify current machine readiness: coordinator lease, original agent identity, journal, physical printer identity, approved profile/media and system/station gates. Merely connecting a device is insufficient.
4. Configure designated admin notification recipients and verify real delivery separately. The maintenance service must run independently of the admission/print coordinator.
5. The legacy protocol-1 `operationsEnabled: false` preflight metadata remains for wire compatibility; it is **not** a live producer switch. Actual authorization comes from system/station settings, ownership/generations and per-operation server fences. Use live readiness and admission/output projections, never that compatibility field, as the operational evidence.

## Normal intake

- Select the event for this phone. Start the attendee camera, or use restricted name/email lookup when QR acquisition is unavailable. Manual exact-QR input is an exception path, not a way around held work.
- Lookup requires a specific matching attendee and explicit confirmation. Names/email queries are private display data, not label/history payloads.
- A decoded/submitted attendee is held. Repeated frames do not create a new arrival. Keep the immutable operation identity after a lost/malformed response; retry that command, not another scan.
- Follow live reservation → admission → output state. `protocol_complete` means a protocol acknowledgement, not that a human saw a usable label. Record observed output separately when recovery is needed.
- Parking releases only the phone. It never cancels, transfers, re-admits or neutralizes uncertain output. Use owning-station **Resume** to observe existing work.

## Failed reads, interruptions and recovery

- On affiliation/dependency failure, explicitly retry the read or choose blank affiliation. These are linked continuations with a new operation UUID; transport retries retain the continuation's UUID.
- After reload, opaque references recover the original work. Camera preflight recovery may require reacquiring the same QR; raw QR data is not stored. Lookup recovery uses its authenticated server snapshot. Corrupt/unreadable held storage blocks fresh intake rather than guessing no work exists.
- Exhausted admission **pre-send** reads have an explicit owning-station recovery action. It renews only that exhausted read budget once per audited command; it does not replay a possibly-sent admission or perform an immediate admission POST.
- Admission uncertainty goes to an admin for a fresh upstream reconciliation and explicit decision. Do not use native scanning as an automatic retry. Reset requires stopped producers, fresh target evidence and a one-use grant immediately before DELETE. A lost claim/grant/DELETE/result never authorizes another DELETE automatically.
- Label-only correction/replacement does not change admission identity or re-check in the attendee. All attempts remain tied to the owning station and immutable payload/profile snapshots. Attempt history is paginated; a bounded display is not a business-history limit.
- Handwriting is two separate facts: first neutralize pending output or establish explicit physical isolation; **then a human confirms the label was handwritten** with another command. Agent cancellation acknowledgement cannot establish human fulfillment. Keep isolation until explicitly released.
- Access denial immediately hides private details and invalidates late responses. Frozen command identity remains for authorized recovery; refreshing or switching away/back cannot legitimize an old response.

## Supervised runtime and retention

- Run coordinator and central maintenance as separate supervised services. The coordinator schedules admission, print dispatch and reset work independently from heartbeat. Only agents open printers.
- Maintenance observes authoritative readiness, deduplicates incidents and sends to the designated eligible recipients. Uncertain email delivery is not automatically replayed. Transient loop failures emit `maintenance_tick_degraded` and do not cancel later retention passes; investigate service/authentication/configuration failures rather than assuming a daemon is healthy.
- Edition closure is permanent and fixes the purge deadline. New production stops, while the reporting-only gateway can accept authorized late evidence until retention expires. A database restart/restore quarantines production; restore approval is idempotent but does not automatically enable stations.
- Agents authenticate and cache their own retirement policy before work. A cached deadline can retire journal/spool material offline. Missing/corrupt/foreign journals or unexpected/symlink material produce no false purge receipt. Original credential authority is not inherited by a replacement identity.
- Central deletion, database compaction, each device's receipt and unreachable devices are separate statuses. Restored data and late audit writes cannot recreate purged feature history. Backup copies, external storage and offline devices require operational inventory and their own deletion evidence.

## Packaging and known target

Run `pnpm build:checkin-runtime`, then `node scripts/package-checkin-runtime.mjs <new-empty-output-directory>`. Install production dependencies for the target architecture and run the packaged `scripts/verify-checkin-runtime.mjs`; it uses synthetic render/journal data and opens no printer. Do not deploy a local x64 native dependency tree to ARM64.

Station 1 was inspected read-only: `wts-station-1.local`, verified existing host key under `/home/darko/.cache/wts-station-prep/known_hosts` using the original `192.168.1.136` host-key alias; ARM64 Node 22.23.2/pnpm 11.24.0, `/opt/wts`, restricted `wts-checkin-agent` user and exact NIIMBOT device permissions. Agent/coordinator services and `/etc/wts-checkin/agent.json` plus `agent-token` were absent. The uninstalled `deployment/systemd/station-1-host-paths.conf.example` matches the observed `/usr/bin/flock`, `/usr/local/bin/node` and printer path. Base unit plus drop-in syntax was checked locally.

The accepted calibration reference remains `productionApproved: false`. Prior owner-confirmed physical label evidence is preserved; no new label was printed during this implementation run.

## Gates still requiring owner/access action

- **Production:** provide/approve the coordinator SSH identity/host, reachable HTTPS endpoint/reverse proxy, WTS Coolify application identity and the authorized release scope. Then inspect that exact target's PocketBase version, migrations/schema and backup state before any write. No production endpoint or credential was guessed.
- **Station activation:** after separately approved provisioning, install the ARM64 runtime, private configuration/credentials, production profile and preserved journal identity, the reviewed unit/drop-in, and verify as the restricted service account. Only then authorize `sudo systemctl enable --now wts-checkin-agent`; that command has **not** been executed.
- **External integration:** verify the deployed Hi.Events list/search contract and perform the approved real test-event → application → Pi → visible label acceptance, retaining each evidence layer separately.
- **Devices:** verify the other intended station deployments, real phone platforms and power/USB-loss recovery. The earlier station-1 queue-to-physical test does not certify every station or the new event deployment.
- **Retention:** inventory approved backup locations and offline devices, rehearse restore/expiry against authorized copies and record actual deletion/compaction/device outcomes. Automated disposable tests are not proof that real backups have expired.

Related issues: #48–#58, #31 and #32. No GitHub issue state was changed. Local changes are uncommitted on `master`; one delegated worker created isolated commit `17f627d605f7c15220ea6730407e6c9d4f80ee42` contrary to instructions. It was disclosed, not cherry-picked or pushed, and no history was rewritten to hide it.
