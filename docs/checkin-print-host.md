# Check-in print host: standalone laptop operation

One foreground Node process supervises a separate worker, credential and durable journal for each Check-in Station. USB printers attach to this laptop; the existing **hosted coordinator remains authoritative**. Signed-in operators choose a printer from the **Printer** dropdown on `/checkin` (also available under **Tools → Phone**); no station pairing QR is required. Phones contact the hosted site, not the laptop. This is not offline check-in and does not run a local PocketBase server.

The dropdown remembers the selection in that browser and switches immediately after server verification. It lists configured printers, with stopped choices marked unavailable. Selection is not proof of hardware readiness; the existing agent, profile and journal checks still gate printing. A current event selection carries across a printer switch, but existing work stays at its original printer and an unresolved scan must be recovered before switching. Station QR pairing is retired. The server does not issue provisioning codes or QR images, and it rejects the old preview and bind commands. **Reset label approval** on `/admin/checkin` resets label profile approval for that station and starts a new station generation. Printing then waits for a new approved label profile, and the server rejects event contexts issued before the reset. Station Client Bindings, event selections and agents stay. The action also clears any provisioning code hash that an older release stored.

## Distribution and installation

Use Node **22.23.2 or later supported LTS** and its npm, on the laptop's native architecture. Node 22.23.2 is the Linux verification baseline; newer majors need their own acceptance run. `node:sqlite` may emit an experimental warning on Node 22. That warning alone is not a journal failure. macOS is a support target, **not verified merely by passing the Linux smoke test**. Windows is not supported by this runbook.

A maintainer with the repository and its normal development dependencies builds:

```sh
pnpm build:checkin-runtime
node --test tests/checkin-host-package.test.mjs
node scripts/package-checkin-host.mjs
```

The packager refuses absent/stale compiled modules, follows runtime imports and child-worker URLs, and copies the resulting JavaScript graph, this guide, the font license and the pinned USB-only vendor package described below. It writes:

- `.output/checkin-host/` — unpacked distribution, no `node_modules`;
- `.output/checkin-host.tar.gz` — transfer this archive;
- `.output/checkin-host.tar.gz.sha256` — archive checksum.

It derives exact direct dependency versions from the installed build dependencies (serialport is explicitly pinned to **13.0.0**) and generates a standalone `package-lock.json`. The lock fixes the dependency tree **for that artifact**; future builds can resolve newer transitives before producing a new lock. Retain the archive, checksum and lock together for repeatable installs. Tar timestamps are not normalized, so independently built archives need not have identical hashes.

The build also unpacks the actual archive into a clean temporary directory outside the checkout, runs `npm ci --omit=dev`, imports the native/runtime dependencies, renders a synthetic Latin/Cyrillic PNG using the bundled fonts, provisions two disposable journals explicitly, rejects re-provisioning, and checks an explicit simulated two-station configuration offline. It fails rather than publishes a package if any step fails. The smoke does **not** enumerate/open printers, start real agents, contact a coordinator, or print. Native install scripts may access the package registry/download hosts.

No repository checkout, pnpm, TypeScript, PocketBase binary, production config, credentials, journals or existing `node_modules` are needed on the laptop. The PocketBase **JavaScript client** remains a dependency because the supported `cli.js init-agent` entrypoint imports coordinator modules statically. That does not grant database credentials or start the coordinator. Noto Sans font bytes are embedded in `src/lib/checkin-label-render-font-data.js`; the font license is included under `licenses/`. Do not substitute system fonts.

The distribution includes `vendor/niimbluelib`, based on installed version `0.0.1-alpha.43-node`. The upstream CommonJS client barrel eagerly loads native Bluetooth modules even for USB printing. `scripts/checkin-serial-vendor.mjs` replaces only that barrel with a Node-serial-only facade and removes unused Bluetooth transport dependencies from its manifest. Serial transport, packet handling, rendering and print-task implementations remain upstream code. The package carries the original MIT license and a `WTS-SERIAL-ONLY.json` modification/provenance record. npm overrides make all consumers use this local package; the build rejects any lockfile still containing noble or Capacitor BLE plugins. The pure-JavaScript `@capacitor/core` dependency remains because upstream shared utilities import it. This is an explicit USB-only distribution, not a claim that the upstream package supports a no-Bluetooth install unchanged.

On the target laptop, place the archive and checksum in a working directory. Verify the checksum against the value supplied by the maintainer over a trusted channel, then:

```sh
# macOS; on Linux use: sha256sum -c checkin-host.tar.gz.sha256
shasum -a 256 -c checkin-host.tar.gz.sha256
tar -xzf checkin-host.tar.gz
cd checkin-host
node --version
npm ci --omit=dev --no-audit --no-fund
npm run smoke
```

`npm install --omit=dev` also works with the supplied manifest/lock, but `npm ci` is preferred because it fails on lock drift. Never copy Linux/Intel/ARM `node_modules` to another architecture, omit optional native packages, disable all native install scripts, or run npm/Node as root. If install/import fails, keep lanes stopped and resolve the native dependency error; do not proceed to live printing. Serialport and Sharp still include platform-specific binaries. A missing prebuilt binary can require the platform's native build toolchain (macOS Command Line Tools or Linux C/C++/Python tooling). A clean Mac install and USB-only startup without a working BLE stack are acceptance gates, not assumed successes.

`npm run smoke` prints an aggregate JSON result including platform, architecture and Node version. It uses only disposable test identities/credentials and deletes its temporary state. Do not adapt those values for live registration. Registry access is required at install time; the smoke itself is offline.

## Private state and two-station configuration

Keep mutable state **outside the unpacked application** so upgrades never replace a journal. Use a private local disk directory, not a shared/network/cloud-synced folder. Run under one dedicated local user. Every station needs its **own state directory**, journal, credential and identity; do not put two journals in one shared station directory.

Example setup (these commands only create directories):

```sh
umask 077
STATE="$HOME/.local/share/wts-checkin"
mkdir -p "$STATE/station-a" "$STATE/station-b"
chmod 700 "$STATE" "$STATE/station-a" "$STATE/station-b"
```

Have the authorized administrator issue the per-station laptop credentials through the existing check-in provisioning workflow. Store each raw credential in its station's `agent.credential` file with mode `0600`; never include it in shell arguments, shell history, a screenshot or ordinary logs. No PocketBase superuser credential belongs on the laptop.

The following examples are **templates, not real assignments**. Replace all identity placeholders with administrator-issued values, replace `/Users/OPERATOR` with the actual absolute home path (Linux commonly `/home/OPERATOR`), use the actual hosted coordinator URL, and replace the example USB metadata with discovery evidence. `$HOME` and `~` are not expanded inside JSON. Example VID/PID values are arbitrary placeholders, not Niimbot hardware claims.

`/Users/OPERATOR/.local/share/wts-checkin/host.json`:

```json
{
  "version": 1,
  "stations": [
    { "configFile": "/Users/OPERATOR/.local/share/wts-checkin/station-a/agent.json" },
    { "configFile": "/Users/OPERATOR/.local/share/wts-checkin/station-b/agent.json" }
  ]
}
```

`station-a/agent.json`:

```json
{
  "identity": {
    "stationId": "REPLACE-STATION-A",
    "agentIdentity": "REPLACE-LAPTOP-AGENT-A",
    "printerIdentity": "REPLACE-PRINTER-A",
    "journalIdentity": "REPLACE-NEW-JOURNAL-A",
    "profileId": "REPLACE-APPROVED-PROFILE-A"
  },
  "journalPath": "/Users/OPERATOR/.local/share/wts-checkin/station-a/journal.sqlite",
  "coordinatorUrl": "https://coordinator.example.invalid",
  "agentCredentialFile": "/Users/OPERATOR/.local/share/wts-checkin/station-a/agent.credential",
  "printerMode": "serial",
  "printerSerial": "REPLACE-EXACT-PROTOCOL-SERIAL-A",
  "printerDevice": {
    "vendorId": "0001",
    "productId": "0002",
    "serialNumber": "REPLACE-EXACT-USB-SERIAL-A"
  },
  "pollIntervalMs": 5000,
  "printerDebug": false
}
```

`station-b/agent.json`:

```json
{
  "identity": {
    "stationId": "REPLACE-STATION-B",
    "agentIdentity": "REPLACE-LAPTOP-AGENT-B",
    "printerIdentity": "REPLACE-PRINTER-B",
    "journalIdentity": "REPLACE-NEW-JOURNAL-B",
    "profileId": "REPLACE-APPROVED-PROFILE-B"
  },
  "journalPath": "/Users/OPERATOR/.local/share/wts-checkin/station-b/journal.sqlite",
  "coordinatorUrl": "https://coordinator.example.invalid",
  "agentCredentialFile": "/Users/OPERATOR/.local/share/wts-checkin/station-b/agent.credential",
  "printerMode": "serial",
  "printerSerial": "REPLACE-EXACT-PROTOCOL-SERIAL-B",
  "printerDevice": {
    "vendorId": "0001",
    "productId": "0002",
    "serialNumber": "REPLACE-EXACT-USB-SERIAL-B"
  },
  "pollIntervalMs": 5000,
  "printerDebug": false
}
```

`printerDevice.interface` is an optional exact string **only when discovery supplies it and explicit interface selection is needed**. Keep serial strings exactly as observed, including case. A case label's serial may differ from its USB-reported serial. Do not add `printerAddress` to a host-managed config, choose by enumeration order, or store a changing `/dev/ttyACM0` or `/dev/cu.*` path as the assignment. Paths are resolved from the enrolled selector. A missing/ambiguous USB serial blocks the lane; do not weaken identity checks to get a label out.

`printerSerial` is a second identity: the exact serial returned by the NIIMBOT protocol over an open connection, not a derived/truncated USB serial. It is required for portable device assignments. Every physical print verifies it on the actual opened stream before sending any print task. Thus a USB path reused by another B1 between discovery and opening still cannot receive the job. A missing serial response fails closed.

After writing the real files privately:

```sh
chmod 600 "$STATE/host.json" \
  "$STATE/station-a/agent.json" "$STATE/station-a/agent.credential" \
  "$STATE/station-b/agent.json" "$STATE/station-b/agent.credential"
```

Use regular, owner-controlled files, not symlinks or hard links. Do not relax private permissions to work around a validation failure. On Linux, give the operating user only the appropriate serial-device group/udev access for the observed devices; group names vary by distribution. Do not use `chmod 666 /dev/...` or start the host with sudo. On macOS, confirm the expected `/dev/cu.*` callout devices and approve any required system USB accessory access normally.

## Discovery, first provisioning, check and start

From the unpacked `checkin-host` directory:

```sh
# Read-only JSON serial metadata; does not open devices or print.
node runtime/checkin/print-host.js devices
```

Have the authorized operator physically identify each printer and assign its exact metadata to its station. Identification/calibration labels must use the **existing authorized Name Label/profile workflow**; there is no host "test-print" CLI and discovery does not print. Confirm the approved profile still matches printer and stock.

To read the protocol serial for enrolment, save the selected `printerDevice` object **by itself** in a regular mode-`0600` file such as `$STATE/station-a/usb.json`, then run:

```sh
node runtime/checkin/print-host.js inspect "$STATE/station-a/usb.json"
```

Unlike `devices`/`check`, this explicit command opens that printer and sends negotiation/identity queries, but never a print/feed task. It takes the same physical-device ownership lease as workers and refuses an already owned device. Keep the selected printer connected throughout identification and confirm the observed mapping physically; record its returned `printerSerial` in the station configuration. Repeat for the other printers. Do not invent a protocol serial when a firmware query fails.

Only for a newly authorized laptop agent with **no prior journal**, after completing any Pi handoff below, explicitly provision its journal once:

```sh
node runtime/checkin/cli.js init-agent "$STATE/station-a/agent.json"
node runtime/checkin/cli.js init-agent "$STATE/station-b/agent.json"
```

These commands create local journals, not server identities, credentials, profiles or authorization. An existing journal is an error, not permission to delete/recreate it. Never run `init-agent` to "fix" a lost, corrupt or restored production journal. `check` and `run` do not auto-initialize missing journals.

Then validate the private manifest, station identities and device assignments without network requests, port opens or printing:

```sh
node runtime/checkin/print-host.js check "$STATE/host.json"
```

Keep the registration system/affected lanes stopped in the hosted admin interface until validation, profile readiness and the authorized physical acceptance below succeed. The check is not proof of server authorization, approved physical output or pending-work reconciliation. Start in the foreground:

```sh
# Linux, or macOS without the optional awake wrapper:
node runtime/checkin/print-host.js run "$STATE/host.json"

# On macOS, use this instead of the preceding command:
caffeinate -dimsu node runtime/checkin/print-host.js run "$STATE/host.json"
```

Use only one of those start commands. npm equivalents are `npm run devices`, `npm run check -- "$STATE/host.json"`, and `npm start -- "$STATE/host.json"`. Keep the terminal open. Use mains power, a powered hub when needed, and tested cables; keep the Mac lid open. `caffeinate` lasts only while the command runs and is not a guarantee against closed-lid sleep or power loss. All lanes depend on this one laptop.

Observe per-station status and hosted readiness before enabling lanes. Recovery precedes new work on safe reconnection; uncertainty is never permission to replay a physical label. A device failure should contain itself to its own lane. Duplicate resource ownership, revoked credentials, invalid assignments, lost/corrupt/restored journals and ambiguous devices need operator action, not a shell restart loop. Ownership is local to the machine: it does not fence an old Pi on another computer. No public inbound laptop service/firewall opening is required; local ownership guards may bind loopback sockets.

For planned shutdown: stop new work for affected lanes through the existing hosted controls, allow reporting/recovery to settle, then press **Ctrl-C once** and wait for all workers to exit. Preserve journals and state directories. Do not unplug printers, force-kill workers, replace application files, or rotate Node/dependencies mid-attempt. After a crash/sleep/network outage, inspect recovery/uncertain outcomes through supported controls before requesting any replacement label. If uncertainty cannot be resolved, use the established manual Name Label fallback rather than automatic retries.

## Safe migration from Raspberry Pi agents

1. Record each existing station, physical printer and approved profile assignment, plus pending/uncertain attempts, privately. Do not export attendee payloads into ordinary logs.
2. Stop new work for the affected lanes using the hosted system/station controls. Drain producers and settle reporting through the existing recovery workflow. Stop the dedicated old Pi agents and verify they are no longer running before granting a new owner access to those printers.
3. Preserve the old journals and lifecycle metadata, following the existing retention/purge policy. Do not copy an active journal, truncate history, or run old and new owners concurrently. Pending, possibly-starting, started, possibly-printing or uncertain work must be reconciled through supported recovery. If the Pi or journal is unavailable, escalate the uncertainty; an empty laptop journal cannot prove that an old label was never printed.
4. Once the handoff is safe, use the existing authorized station-generation/agent-management flow to retire/revoke the old credentials and provision **new per-station laptop agents, credentials and journals**. Do not silently reuse the old Pi credential. Preserve the intended station/printer/profile assignments; confirm whether the actual generation transition requires phones to choose their printer again.
5. Enrol the exact USB selectors, write private configs and explicitly run `init-agent` only for those new identities. Run `check`, then start the host with lanes still stopped. Confirm ordinary per-station heartbeat/readiness and complete any supported profile-adoption/approval steps; never edit the journal or bypass identity/profile checks.
6. Complete authorized physical acceptance, then deliberately enable the affected lanes. Old Pi credentials stay revoked and old agents stay stopped. Rollback also requires an explicit identity/credential handoff and uncertainty reconciliation; do not simply restart the Pi with old state while the laptop owns the lane.

Credential rotation, production migration and physical label tests require owner authorization; installing this package performs none of them.

## Acceptance on the actual laptop

The automated clean-install smoke is **Linux/software evidence only**, not physical or macOS certification. Before event use, record actual OS/architecture/Node/npm versions and verify:

- clean target-architecture `npm ci` and `npm run smoke`, including embedded-font rendering and native imports;
- read-only serial discovery and private-config checking on the actual Mac/Linux laptop without a functioning BLE stack;
- two authorized phones route distinguishable Name Labels to their assigned printers, including simultaneous operation through the actual hub and cables;
- unplugging one printer does not stop the other lane; replugging/reordering USB ports does not change routing;
- a second host/agent cannot own the same resources, and duplicate/missing/ambiguous assignments fail closed;
- stop/start, laptop restart, Internet interruption and controlled sleep/disconnect around a test attempt preserve journals and visible uncertainty, with no automatic duplicate output;
- explicit rescan/replacement and profile checks still use the existing authorized workflow, followed by ordinary heartbeat/readiness before enabling.

Do not manufacture live scans or bypass authorization from the terminal to satisfy this checklist. Retain the package checksum and aggregate test results, not credentials or attendee data.
