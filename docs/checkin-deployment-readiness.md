# Check-in deployment readiness

Updated: 2026-09-10. This is a local deployment-preparation record, not deployment or event-use approval.

Scope: the printing deployment portion of [#58](https://github.com/WhatTheStackConf/wts/issues/58), with production facts tracked in [#31](https://github.com/WhatTheStackConf/wts/issues/31) and station evidence in [#32](https://github.com/WhatTheStackConf/wts/issues/32). #58 also depends on unfinished mobile, lookup, recovery, monitoring and retention slices #52–#57; this record does not complete that ticket. Runtime configuration/recovery authority: [station agents](checkin-station-agents.md) and [approved spec](wts-2026-checkin-print-spec.md).

## Release and evidence boundaries

- Local starting revision: `f725ae8` on `master`, including `753b812` and `6dcbc87`. The local tracking ref has four other remote commits, so a release needs an explicitly reviewed integration base; do not blindly push `master` or roll back remote changes.
- Preserve the unrelated agenda worktree and untracked research. Never build a deployable release from this dirty checkout. Select an approved clean revision in a separate checkout after commit/integration authorization; no commit, push or deployment is authorized here.
- The previous disposable queued end-to-end test reached the real B1 and the owner saw the physical label. Do not spend another label just to repeat this evidence.

| Evidence layer | Recorded result | Boundary |
| --- | --- | --- |
| Printer protocol | Previous serial queued test returned `protocol_complete` | Acknowledgements do not prove legibility or visible output |
| PocketBase | Previous disposable print attempt reached `completed` | Not production state |
| Agent journal | Local runtime tests cover durable outcome/report replay and quarantine | No target Pi journal inspection or power-loss test |
| Physical output | Owner confirmed the previous queued label emerged | Not calibration/approval for every Pi/printer/stock combination |

## Snapshot migration and rollout order

`pocketbase/Dockerfile` copies both `pb_migrations` and `pb_hooks` into the PocketBase image. `entrypoint.sh` runs `migrate up --dir=/pb/pb_data --migrationsDir=/pb/pb_migrations` with `set -eu` before serving. A nonzero exit stops the shell, but this is not a sufficient schema-readiness gate: in a disposable PocketBase 0.34.0 invocation a missing migration asset produced `Error: failed to apply migration ...` with exit status 0. Compose waits for PocketBase health before starting the **webapp**. It does not contain a coordinator service, assert migration history, or order an external systemd coordinator. Require exact history/field readback before starting the coordinator; do not infer schema compatibility from exit status or HTTP health alone.

The relevant additive sequence is:

1. `1790000005_create_checkin_agents.js`
2. `1790000006_create_checkin_arrivals.js`
3. `1790000007_create_checkin_admission.js`
4. `1790000008_add_journaled_print_delivery.js`
5. `1790000009_add_checkin_profile_snapshots.js`

Earlier role/station/event/profile and admin-ledger dependencies must already be applied. Do not copy just the last migration into a new database or renumber migrations. PocketBase orders migrations by filename, not the timestamp's relationship to today's date.

The snapshot migration adds nullable JSON `profile_snapshot` fields (16 KiB maximum) to `checkin_arrival_workflows` and `checkin_print_attempts`. It deliberately does **not** reconstruct approval for old rows. The immutable approval attestation must be frozen by the new arrivals hook at acceptance; current profile approval cannot establish a historical snapshot. Pre-upgrade queued work without a snapshot must remain disabled for explicit investigation/reconciliation, not be auto-backfilled or reprinted. Retain IDs, payload hashes and uncertain output evidence.

After explicit authorization:

1. Stop new intake through the audited controls, drain known active work, and stop the single coordinator. Preserve unresolved work; stopping a process does not prove a sent upstream/device command was cancelled.
2. Confirm the approved backup/restore procedure, deployed image identity, actual volume, and absence of overlapping producers. Keep operations disabled throughout the upgrade.
3. Deploy the matching PocketBase hooks and complete additive migration set first. In that **identified container**, the existing entrypoint runs the migration command above. Verify the exact migration history and both collection fields, not only `/api/health`.
4. Start one compatible coordinator, then the assigned agents, then verify UI readiness. Enable only one station after owner authorization and evidence review.
5. Roll back code only with intake/printing disabled and explicit compatibility review. Do not use `migrate down` for this rollout: the snapshot migration's down function removes frozen fields. Database/journal restore is not permission to replay output.

Safe database inspection on an approved local database path (read-only, prints no attendee data):

```sh
sqlite3 -readonly /APPROVED/PATH/data.db \
  "SELECT file FROM _migrations WHERE file >= '1790000005' ORDER BY file;"
sqlite3 -readonly /APPROVED/PATH/data.db \
  "SELECT name,type FROM pragma_table_info('checkin_arrival_workflows') WHERE name='profile_snapshot'; SELECT name,type FROM pragma_table_info('checkin_print_attempts') WHERE name='profile_snapshot';"
```

Do not guess the production path or copy a live database without its WAL. A read-only connection to the approved live database is different from an inconsistent file copy. The permanent runtime suite exercises a disposable pre-snapshot upgrade with unchanged feature migrations and dependencies, legacy row preservation and repeated `migrate up`; it is not evidence that production has applied it. The workstation PocketBase binary is `0.30.4`; the Dockerfile pins `0.34.0`. Both were exercised locally below; the actual deployed binary still requires independent verification.

## Runtime artifact contract

The root Dockerfile is a **web image**, not an installable systemd runtime: it copies `.output` and `package.json`, but not root production `node_modules`. The TypeScript runtime output uses external package imports. The current Compose has only webapp and PocketBase; no independent coordinator, HTTPS agent route, or coordinator state/secret configuration is deployed by it. Neither file has been changed to guess the production topology.

For an approved clean release checkout on a builder compatible with the station architecture/libc:

```sh
pnpm install --frozen-lockfile
pnpm build
# build already compiles the runtime after Nitro has finished replacing .output
```

Install under `/opt/wts` as root-owned, service-readable code:

- The **entire** `.output/checkin-runtime/` tree, including `runtime/checkin/` and `src/lib/`, not only top-level JavaScript files.
- Root `package.json`, `pnpm-lock.yaml` and `pnpm-workspace.yaml`.
- Production dependencies installed for the actual target Node ABI, architecture and libc. In a separate staging directory containing those manifests, use `pnpm install --prod --frozen-lockfile`. Do not prune or copy this workstation's development `node_modules` onto an ARM Pi.
- Build identity/checksums for the approved source, manifest/lockfile, migration/hook files and runtime output. Pinned fonts are embedded in the compiled font-data module; there is no system-font fallback.

Use Node `22.23.2` and pnpm `11.24.0` for this recorded runtime baseline. Verify an executable path outside `/home` because `ProtectHome=yes` hides a user's Node installation. `node:sqlite` is experimental native Node functionality; Sharp and serialport need matching native binaries or a supported build toolchain. The workspace allowlist permits the serialport build and disables unused Bluetooth/USB builds. Do not override it with blanket build-script approval.

Non-printing import/ABI check from the staged release root:

```sh
node --input-type=module -e 'await import("node:sqlite"); await import("sharp"); await import("fontkit"); await import("@mmote/niimblue-node"); await import("./.output/checkin-runtime/runtime/checkin/cli.js"); console.log("runtime_imports_ok")'
```

This checks loadability only; it does not open serial, provision a journal, contact PocketBase or establish target device access.

## Station installation prerequisites

The intended model is one outbound-only systemd agent per Pi, a separate service user `wts-checkin-agent`, private configuration in `/etc/wts-checkin`, and persistent journal/lock under `/var/lib/wts-checkin-agent`. Identity/profile assignment must come from audited provisioning, not the example config. Keep coordinator credentials off the station.

Before installation, collect per host without reading secret/config contents:

```sh
hostname
uname -m
uname -r
node --version
pnpm --version
command -v node
command -v flock
systemctl show wts-checkin-agent.service -p LoadState -p ActiveState -p FragmentPath
# Substitute the station's observed exact by-id path:
readlink -f /dev/serial/by-id/usb-NIIMBOT_B1_LABEL_PRINTER_<serial>-if00
stat -Lc '%n %F %a %U %G major=%t minor=%T' /dev/serial/by-id/usb-NIIMBOT_B1_LABEL_PRINTER_<serial>-if00
udevadm info --query=property --name=/dev/serial/by-id/usb-NIIMBOT_B1_LABEL_PRINTER_<serial>-if00
```

Replace `<serial>` before executing; it is a template, not a shell token or glob. Verify actual VID/PID and interface as well as serial. Configure the same **exact** by-id path in `agent.json` and `DeviceAllow` in the installed unit. `systemd.resource-control(5)` explicitly does not support globbing in device-node paths. Keep `PrivateDevices=no` and `DevicePolicy=closed`; do not broaden access to all serial devices to hide an incorrect assignment.

The device cgroup allowlist does not grant UNIX file permissions. Prefer a separately approved udev rule scoped to the observed `SUBSYSTEM=tty`, VID/PID, serial and interface, setting group `wts-checkin-agent` and mode `0660`. Alternatively, an explicitly approved `SupplementaryGroups` drop-in can use the target's observed device group; that is broader DAC authority, not a per-printer udev rule. Do not install rules or add groups until the exact host/device and authorization are known.

Connect the assigned printer before starting the service: the device allowlist resolves at start. If unplug/replug changes the kernel device number, leave the station paused, reconcile any possibly started work, and explicitly restart after the correct by-id path returns; do not auto-restart uncertain printing. This behavior still needs target-host testing.

Before first initialization, an authorized installer must create the service user and journal directory (`0700`, owned by that user). `StateDirectory` creates it on service start, not for a manual pre-start command. Install regular private JSON configs and credential source files with documented owners/modes. Run first journal initialization **as the service user**, stopped and holding the exact owner lock, with the credential-path caveat below. Never initialize over a lost/old journal.

Systemd creates `/run/credentials/<unit>/...` only for the running unit. The `init-agent` subcommand reads only identity/journal configuration, but manual coordinator/agent invocations need separately provisioned private credential paths; do not expect a stopped unit's credential directory to exist or put a bearer in argv. The service templates are not installers.

## Coordinator-specific blockers

- Obtain the actual server SSH/Coolify application identity, approved deployment revision and network topology. A host-systemd coordinator cannot assume Docker's `pocketbase` DNS works, and Compose does not publish PocketBase port 8090 onto host loopback. Choose and verify an approved reachable HTTPS PocketBase endpoint or separately authorized loopback/network arrangement.
- Install exactly one independently supervised coordinator and its private PocketBase credential, then an HTTPS reverse proxy to its loopback listener. Only POST `/v1/agent` is exposed; no body/Authorization logs, browser cookies or redirects. The agent's example `.invalid` URL is not a deployable endpoint.
- Private coordinator admission loading is implemented: `admissionCredentialFile` points to a private JSON object containing exactly `apiUrl`, `apiKey` and `accountId`, and the systemd template loads it through `LoadCredential=hievents`. Unknown coordinator keys and invalid explicit files fail closed before ownership; omitting the file retains the legacy server environment path for diagnostics and reports admission as disabled if absent. The CLI never loads `.env`, and webapp Compose variables do not propagate into its service. **Production credentials and the actual endpoint/account remain unprovisioned**; their approved installation and read-only validation are still required. Never embed them in unit files or copy them to Pis.
- The global feature remains `operationsEnabled: false` in the application contract. Starting agents or observing heartbeats does not enable public check-in or satisfy the unfinished recovery/retention/notification requirements.

## Executed local verification

Verification used an isolated `git archive HEAD` snapshot with only this preparation patch overlaid, independent dependencies installed offline from the frozen lockfile, and no `.env`, production data or unrelated agenda edits. It is not an integrated release branch or deployable Pi approval.

- Default suite: **829 tests across 63 files passed**, using the repository's PocketBase `0.30.4` test binary.
- `pnpm run typecheck`, `pnpm run check`, and `pnpm run build` passed. Check reported **0 errors and 87 warnings**; the test runner retains the known non-failing shutdown timeout warning.
- Official PocketBase **0.34.0** linux-amd64 archive downloaded and matched the release's SHA-256 checksums file (`dea29ca40669fb7f31bb47761a8c3494c3f06b42f99d60831bbbcf4bdef5f69d`). Only the disposable checkout's binary was replaced. Runtime/arrival suites: **51 tests passed**, including the legacy snapshot-upgrade regression and compiled coordinator/agent smoke.
- Full unmodified repository migration tree on disposable PocketBase 0.34.0: **74/74 migration filenames read back from `_migrations`**, and both snapshot columns present. An initial harness run omitted the `pb_hooks` directory needed for a historical relative logo-asset path and failed; recreating the expected directory layout allowed the unchanged migrations to complete. A historical `Users updated warning` remains in that migration output; this check establishes migration history/snapshot fields, not every legacy schema invariant.
- Separate production-only dependency staging loaded SQLite, Sharp, fontkit, NIIMBOT and the compiled CLI, then rendered a synthetic Cyrillic PNG **600×360** in memory. No serial device was opened. This is linux-x64/glibc evidence, not ARM or container-musl evidence.
- Temporary unit copies passed `systemd-analyze verify` with the observed Node/device paths substituted. This is syntax/executable discovery only, not actual sandbox, UNIX permissions, service start, heartbeat or hotplug verification.

Local verification artifacts: `/tmp/wts-deployment-verify-z486k87z/repo` and `/tmp/wts-deployment-verify-z486k87z/runtime-stage`. Logs: `/tmp/wts-deployment-full-test.log`, `/tmp/wts-deployment-snapshot-typecheck.log`, `/tmp/wts-deployment-snapshot-check.log`, `/tmp/wts-deployment-build.log`, `/tmp/wts-deployment-pb034.log`, `/tmp/wts-deployment-full-migrations.log`. These paths are temporary, not production install locations.

## Local inventory and exact next action

Observed on the workstation, not a Pi:

- Architecture `x86_64`, Node `22.23.2`, pnpm `11.24.0`; Node is `/home/darko/.hermes/node/bin/node`, while `/usr/bin/node` is absent.
- `/opt/wts`, `/etc/wts-checkin` and `/var/lib/wts-checkin-agent` are absent; neither systemd unit is installed.
- Attached by-id path: `/dev/serial/by-id/usb-NIIMBOT_B1_LABEL_PRINTER_B1-GC0612113-if00`, currently `/dev/ttyACM0`, USB VID:PID `3513:0002`, interface `00`, mode `0660`, owner/group `root:dialout`. This observed USB identifier is not a guessed full printer serial or a station assignment.

**Original inventory limitation:** target access was not specified in that handoff. The station-1 reference artifact and read-only follow-up below now establish its host/access path. Production station/profile/journal assignment, the coordinator host/HTTPS endpoint and approved production inspection access remain unresolved. Do not scan networks or use a different project's host.

**Precise next action:** owner supplies the station and coordinator SSH aliases (not credentials), the WTS Coolify application identity and approved read-only access path. Then run the inventory commands above via `ssh -o BatchMode=yes -o ConnectTimeout=10 <approved-station-alias>` and inspect the identified server's image digest/version, service count, network, migration history and volume/backup posture without exposing secrets. Replace each placeholder only from those observations. Installation, migration, provisioning, enablement and physical validation require separate explicit authorization.


## Station 1 read-only follow-up — 2026-09-11

The owner-accepted test profile identifies `wts-station-1.local`. It resolved to `192.168.1.136`; the existing preparation known-hosts file contained that exact address's ED25519 key (`SHA256:hK9KWaB4fcrEuiDae/rqKWtrsclLECz4F4OgIFUZio4`). Default hostname-based strict checking failed; the verified cached address alias allowed strict checking without accepting/replacing any host key:

```sh
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=/home/darko/.cache/wts-station-prep/known_hosts \
  -o HostKeyAlias=192.168.1.136 -o ConnectTimeout=10 wts-station-1.local
```

Configured SSH user `darko` authenticated successfully. Only inventory, file metadata, executable-version checks and permission tests ran. No printer device was opened; no configuration/credential content was read, copied or changed.

| Boundary | Observed state |
| --- | --- |
| Host/runtime | `wts-station-1`, `aarch64`, kernel `6.18.34+rpt-rpi-v8`; Node `v22.23.2` |
| Accessible Node | `/usr/local/bin/node` → `/opt/node-v22.23.2-linux-arm64/bin/node`; works as `wts-checkin-agent`; `/usr/bin/node` absent |
| Existing test staging | `/opt/wts/.output/checkin-runtime/runtime/checkin/cli.js` exists, root-owned and readable; this is not verification of the new local package |
| Agent service | `LoadState=not-found`, inactive; no installed unit |
| Production configuration | `/etc/wts-checkin/agent.json` and `/etc/wts-checkin/agent-token` absent |
| State directory | `/var/lib/wts-checkin-agent`, `0700`, service-owned; contents intentionally not inspected or initialized |
| Device | Exact profile by-id path resolves to a character device, `0660 root:wts-checkin-agent`; service-user read/write **permission tests** pass without opening it |
| pnpm | `11.24.0` through privileged Node invocation; ordinary invocation is blocked because `/usr/local/lib/node_modules` is `0750 root:root`. This does not block an installed agent's direct Node execution. |

`deployment/systemd/station-1-host-paths.conf.example` prepares the observed Node and device paths as a drop-in; it is **not installed** and does not authorize production. Do not broaden device permissions: the existing service-user DAC check passes. Systemd cgroup/sandbox behavior still needs an authorized real service start.

Before installation, obtain the approved production agent/profile/journal identities and decide how to preserve/retire the prior test journal. Never initialize over existing/lost state. Stage a reviewed release under the observed `/opt/wts` layout, install production dependencies for ARM64 using an explicitly authorized installer, verify readability as the service user, and install private configuration/credential files with their documented owners and `0600` modes. Root-only pnpm is usable for an authorized install via `/usr/local/bin/node /usr/local/lib/node_modules/pnpm/bin/pnpm.mjs`; do not silently chmod its global directory or treat this read-only check as installation permission.

Remaining blockers: authorization to commit/publish/deploy scoped check-in changes; actual central/coordinator host and WTS application identity/topology/backup access; production provisioning; remaining stations; and approved service/hotplug/recovery acceptance. The physical station-1 test profile is still explicitly `productionApproved: false`.
