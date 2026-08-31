# Raspberry Pi / NIIMBOT label runtime contract

**Issue:** [Verify the Raspberry Pi, NIIMBOT, and label-media runtime contract](https://github.com/WhatTheStackConf/wts/issues/22)

**Evidence cut:** 2026-08-14

**Status:** partially resolved; one Fedora laptop and one attached NIIMBOT B1 are identified, but all three target checkpoints remain hands-on gates.

## Decision summary

Use one outbound-only Node print agent per checkpoint, supervised by systemd. Give each agent a local, file-backed SQLite job journal and one NIIMBOT B1 over USB serial. Address the printer by its udev `/dev/serial/by-id/...` symlink, serialize all printer traffic through one in-process mutex, and pin the driver/runtime/native-module versions only after they build and pass restart and print probes on that checkpoint's exact Pi and OS.

This research does **not** establish the three Raspberry Pi models, their OS releases or architectures, or the three production printer serials. It establishes one currently attached B1 on Darko's Fedora laptop and records an earlier, hardware-tested `40 × 20 mm` / `384 × 120` profile as historical evidence that still needs per-station reproduction.

## Proven / not proven matrix

| Subject | Proven now | Still required on each target Pi |
|---|---|---|
| Raspberry Pi | Raspberry Pi OS is offered in 32-bit and 64-bit variants; the current official release is Trixie and Bookworm is the legacy line.[R1][R2] | Exact board model, RAM, OS edition/release, kernel, `armhf`/`arm64`, Node executable and version for checkpoint 1, 2, and 3. |
| NIIMBOT identity | One Fedora-attached device enumerates as USB `3513:0002`, model `B1 LABEL PRINTER`, serial `B1-GC0612113`, kernel driver `cdc_acm`.[L1] | Enumerate the printer physically assigned to every checkpoint. Do not extrapolate the laptop unit's serial to the other two units. |
| Stable path | Fedora created `/dev/serial/by-id/usb-NIIMBOT_B1_LABEL_PRINTER_B1-GC0612113-if00`, resolving to `/dev/ttyACM0` during the observation.[L1] | Verify the by-id link after cold boot and unplug/replug on every Pi; record printer-to-checkpoint assignment. `/dev/ttyACM0` is not a production identity. |
| Protocol/driver | MultiMote has explicit B1 metadata (`203 dpi`, `top`, `384` printhead pixels), a B1 print task, serial and BLE CLI transports, raster encoding, page framing, and print-status polling.[N1][N2][N3][N4] A local non-printing CLI probe opened the stable serial path and sent the NIIMBOT Connect frame.[L2] | Build the pinned packages and complete info, one-label, disconnect, recovery, and calibration probes on each exact target. The laptop info probe did not complete printer-info negotiation, so it is not a successful firmware/model compatibility proof. |
| Label media/profile | A recovered implementation plan records a previously working `40 × 20 mm` direct-thermal gap roll and a measured `384 × 120` raster profile for `B1-GC0612113`.[H1] | Confirm stock dimensions/type and approve a separately versioned profile for every printer/roll combination. Do not assume all three rolls or offsets match. |
| Durable journal | A local two-process `node:sqlite` probe retained a job row across process restart with `journal_mode=wal` and `synchronous=2` (`FULL`), changing `printing` to `printed`.[L3] | Repeat on each Pi's real filesystem and runtime; add abrupt termination and controlled power-loss recovery. Laptop process restart is not SD-card or power-loss proof. |
| Service supervision | systemd service units supervise a process; `Restart=`/`RestartSec=` define restart behavior and `StateDirectory=` provides a managed persistent state location.[S1][S2] | Install, boot-enable, crash-test, reboot-test, unplug-test, and inspect ownership/logging on each Pi. |

## 1. Exact local hardware evidence: Fedora laptop only

The bounded local observation produced:

```text
lsusb:  Bus 003 Device 002: ID 3513:0002 NIIMBOT B1 LABEL PRINTER
DEVNAME=/dev/ttyACM0
ID_VENDOR_ID=3513
ID_MODEL_ID=0002
ID_MODEL=B1_LABEL_PRINTER
ID_SERIAL=NIIMBOT_B1_LABEL_PRINTER_B1-GC0612113
ID_SERIAL_SHORT=B1-GC0612113
ID_USB_DRIVER=cdc_acm
DEVLINKS=... /dev/serial/by-id/usb-NIIMBOT_B1_LABEL_PRINTER_B1-GC0612113-if00 ...
```

The by-id link resolved to `/dev/ttyACM0` at that moment. The character device was `root:dialout` and mode `0660`; Darko's laptop user was in `dialout`.[L1][L2] This proves Linux USB enumeration and a stable serial-derived symlink for **this current B1 on this Fedora laptop**. The PCI/USB topology paths in the udev output are laptop-specific and must not be copied to a Pi.

The non-printing probe used the by-id path and emitted:

```text
03 55 55 c1 01 01 c1 aa aa  (Connect)
```

It then reported that printer information could not be fetched.[L2] Therefore the evidence proves that the CLI reached and wrote the serial endpoint; it does not prove successful model detection, firmware compatibility, paper sensing, status semantics, or printing. No label was printed during this recovery pass.

## 2. NIIMBOT driver and protocol contract

### Upstream evidence and confidence

`@mmote/niimbluelib` and `@mmote/niimblue-node` are third-party, reverse-engineered projects, not NIIMBOT-endorsed software; the upstream README states that limitation.[N5] Treat the current support as an engineering dependency, not a vendor guarantee.

At the inspected commits:

- The model library describes B1 as model id `4096`, `203 dpi`, `printDirection: "top"`, `printheadPixels: 384`, with gap/black/transparent paper types and density range 1–5.[N1]
- The B1 print task sends density, label type, and print start; for each page it sends page start, `(rows, cols, quantity)`, image packets, page end, then polls status until finished.[N2]
- Serial connection code opens at `115200`, negotiates, and fetches printer info; packet writes are mutex-protected.[N3]
- The Node CLI accepts serial paths, explicit `B1` print task, `top` direction, pixel width/height, density, threshold, quantity, and label type. It flattens onto white, thresholds the image, optionally resizes with Sharp using nearest-neighbour, and then raster-encodes it.[N4]
- `@mmote/niimblue-node` 1.1.0 depends on an alpha Node build of `@mmote/niimbluelib` plus Sharp. The inspected npm metadata also exposed serialport/USB/BLE native dependencies in the Node distribution.[L4]

### Required production constraints

1. **Pin everything.** Pin the exact Node major/minor, `@mmote/niimblue-node`, Node-flavoured `@mmote/niimbluelib`, Sharp/libvips, serialport bindings, lockfile, and raster font/hash. Alpha driver drift is too risky for event-day installs.
2. **Serial first.** Use USB serial, not BLE, for the checkpoint contract. Pass the exact `/dev/serial/by-id/...` path. Ensure the service account can open the `dialout` device via a narrowly scoped udev rule or service group membership.
3. **Explicit profile.** Until model-info negotiation is proven on the target, configure model/task `B1`, direction `top`, label type `1`, density `3`, and threshold `128` from a versioned profile rather than relying on auto-detection.
4. **One owner, one mutex.** Only the print agent may hold the port. Serialize complete print tasks, not merely individual packet writes. Never run parallel print processes for one printer.
5. **Classify the command boundary.** Failure before `printStart` is safe to retry. Failure after print initiation is physically ambiguous: a label may have emerged even if software missed status. Mark it for operator reconciliation instead of blindly auto-reprinting.
6. **Protocol success is not physical success.** Status polling is useful evidence, but paper-out, media skew, cutter/feed behavior, and an actually legible label require a human-observed print gate.

## 3. Label stock and two-row raster implications

### Historical hardware evidence, not a three-station fact

The recovered plan records this profile as previously approved on the then-current roll and test B1:[H1]

```json
{
  "model": "B1",
  "printTask": "B1",
  "printDirection": "top",
  "labelType": 1,
  "canvasWidthDots": 384,
  "canvasHeightDots": 120,
  "density": 3,
  "threshold": 128,
  "offsetXDots": 28,
  "offsetYDots": 18
}
```

It also records `40 × 20 mm` direct-thermal gap media and explicitly says calibration is media/printer-specific.[H1] This is credible historical hardware evidence for `B1-GC0612113`; it is not newly reproduced evidence and it does not prove the production stock at all three checkpoints.

### Raster contract

For `printDirection: "top"`, a `384 × 120` source becomes `cols=384`, `rows=120`. The encoder requires `cols` to be divisible by eight and packs each raster row into `384 / 8 = 48` bytes before the B1 task supplies page size and image packets.[N1][N2][N6]

The `384` width deliberately consumes the B1's recorded 384-pixel printhead. The `120` height is a measured feed-axis canvas, not a fresh millimetre-to-DPI derivation. At nominal 203 dpi, 40 mm and 20 mm are about 320 and 160 dots respectively; that mismatch is a warning that orientation, printable area, feed calibration, and the recorded `+28/+18` compensation are part of the profile. Preserve the measured raster until a physical calibration run replaces it; do not “correct” it from nominal DPI alone.[H1]

The fixed two-row Name Label means the attendee name occupies row one and affiliation occupies row two inside one `384 × 120` label raster; it does not permit a long name to wrap into the affiliation row, and it does not mean two physical labels across the roll. Both rows share only 120 feed-axis dots, including top/bottom safety margins and offset compensation. The renderer therefore must:

- use a pinned font and deterministic text measurement;
- reserve independently measured, fixed regions for the name row and affiliation row;
- fit each row independently, shrink only to its row-specific minimum, then apply deterministic visible ellipsis without wrapping to a third row;
- leave the affiliation row blank when the authoritative value is missing, while preserving the fixed two-row geometry;
- center each row using actual ink bounds inside its calibrated region;
- flatten to white, threshold deterministically, and avoid antialiasing-dependent resizes after thresholding;
- emit exactly `384 × 120`, with a 384-column width divisible by eight;
- freeze golden PNG/raster hashes, but require one human-approved physical fixture per station.

Long names, long affiliations, missing affiliation, Macedonian Cyrillic, mixed scripts, punctuation, and descenders are mandatory fixtures. A software hash proves repeatability, not placement on stock.

## 4. Node and native-module constraints

The target architecture controls the viable runtime:

- The inspected official Node distributions provided Node 22 archives for both `linux-arm64` and `linux-armv7l`, while the inspected Node 24 archive provided `linux-arm64` but no `linux-armv7l` artifact.[L5] This is distribution evidence, not proof of what any target Pi runs.
- `node:sqlite` was added in Node 22.5, stopped requiring `--experimental-sqlite` in Node 22.13, and is documented as release-candidate stability from Node 24.15.[D1] The local runtime still emitted an experimental warning during the restart probe, so production must pin and record the exact behavior of its chosen Node version.[L3]
- `better-sqlite3` 13.0.3 declares Node `>=22`. Its inspected package contains a glibc Linux ARM64 prebuild and a musl ARM64 prebuild, but no Linux ARMv7 prebuild.[B1][B2] A 32-bit Pi would therefore require a verified source build or a different journal binding; do not assume `npm install` will work.
- `@mmote/niimblue-node` includes Sharp and serial/USB/BLE native dependencies. Even when only serial transport is used, installation scripts and architecture-specific artifacts can fail. Build tools, libc, Node ABI, and package scripts must be tested from a clean install on each exact image.[N7]

### Runtime selection gate

Prefer 64-bit Raspberry Pi OS Lite on a 64-bit-capable target **only after inventory confirms the actual board and migration is acceptable**. It has the clearest official Node and native-prebuild path. Do not reimage an existing checkpoint merely to satisfy this document.

For each Pi, choose one and record it:

1. **Pinned `better-sqlite3`** — matches the recovered implementation plan and offers a mature synchronous API; acceptable only if clean install and restart/power tests pass.
2. **Pinned built-in `node:sqlite`** — removes one external native addon; acceptable only if the pinned Node release exists for that architecture and its stability/API are accepted.

No in-memory journal is acceptable. A JSON file without transactional recovery is not an equivalent fallback.

## 5. Durable journal contract

Use a database under a systemd-managed persistent directory such as `/var/lib/wts-checkin-print-agent`, not `/tmp`, the application checkout, or a removable working directory. Keep the database, `-wal`, and `-shm` files together and include all of them in backup/diagnostic procedures.

### Journal-mode options

- **WAL + `synchronous=FULL`** is the currently exercised option. SQLite documents WAL's separate write-ahead log/checkpoint model, and `FULL` as stronger synchronization than `NORMAL`.[Q1][Q2] `PRAGMA synchronous` returning `2` in the local probe corresponds to `FULL`.[L3]
- **Rollback journal (`DELETE`) + `synchronous=FULL`** is a valid conservative alternative for a single-writer agent if target SD-card/filesystem testing shows it is operationally safer or simpler. It must pass the same crash and power gates; it is not approved merely by documentation.

The local probe opened a file-backed database, set WAL and FULL, upserted `probe-job=printing`, closed, reopened in another Node process, and observed/updated the row to `printed` while retaining `journalMode: "wal"` and `synchronous: 2`.[L3] This proves ordinary process restart persistence on the laptop. It does not prove fsync behavior under power loss, SD-card controller behavior, filesystem health, WAL checkpoint recovery, or Pi compatibility.

### State machine and recovery rule

Persist state transitions transactionally:

```text
queued -> dispatching -> printing -> printed
                    \-> failed-before-command (retryable)
printing + lost outcome -> ambiguous (operator reconciliation)
```

Write `printing` durably **before** sending the first print command; write `printed` only after the driver's finished status and retain audit metadata. On restart, replay `queued` and safely retryable failures. Never automatically replay `printing`/`ambiguous`, because the printer may have physically completed the label before the process died. This is at-least-once intent with duplicate suppression and explicit physical ambiguity, not a false exactly-once claim.

## 6. systemd supervision implications

Use a long-running system service (`Type=simple` is sufficient unless the agent implements `sd_notify`) with:

- `StateDirectory=wts-checkin-print-agent` for persistent journal ownership;
- a dedicated unprivileged user and only the serial-device group/access it needs;
- `Restart=on-failure` and a nonzero `RestartSec=` to recover crashes without a hot loop;
- startup ordering for network availability, while the agent itself tolerates offline operation and reconnects with bounded backoff;
- stdout/stderr to journald, excluding attendee payloads, tokens, and raw label rasters;
- a startup preflight that checks the configured by-id link, database integrity/migrations, and single-process lock before polling work.

systemd can restart the process, but it cannot decide whether a physical label printed. Recovery semantics belong in the durable state machine. USB unplug should normally put the agent into degraded/reconnect mode; repeated reconnect failure may exit nonzero for systemd to restart, but restart must not erase or blindly replay ambiguous work.

## 7. Explicit hands-on gate checklist

Complete the following for **checkpoint 1, checkpoint 2, and checkpoint 3**. Store outputs in the deployment record and fill a three-row inventory table; no row may inherit values from another station.

### A. Inventory without printing

- [ ] Record checkpoint name and physical location.
- [ ] Record `cat /proc/device-tree/model`, RAM, `uname -a`, `uname -m`, `dpkg --print-architecture`, `/etc/os-release`, and Raspberry Pi OS edition.
- [ ] Record Node source, exact `node --version`, `process.platform`, `process.arch`, libc, and package-manager version.
- [ ] Capture `lsusb -nn`, `udevadm info --query=property --name=<tty>`, the NIIMBOT VID:PID, model string, and serial.
- [ ] Verify `/dev/serial/by-id/usb-NIIMBOT_B1_LABEL_PRINTER_<serial>-if00` exists after boot and after unplug/replug; record its target.
- [ ] Verify the service user, device ownership/mode, and effective serial access without broadening the device to world-writable.
- [ ] Run a non-printing info probe. Record firmware/hardware/model metadata and detected print task, or record the exact failure. Do not treat a successful open as successful negotiation.

### B. Clean runtime/native build

- [ ] On the exact image, perform a clean install of the pinned Node/lockfile and record whether artifacts were downloaded or compiled.
- [ ] Verify Sharp/libvips, serialport bindings, NIIMBOT library, and chosen SQLite binding load in the service account's environment.
- [ ] If using `better-sqlite3`, prove the exact pinned version on the target architecture. If it compiles, record compiler/toolchain and preserve a reproducible build path.
- [ ] If using `node:sqlite`, record its stability warning/flag behavior on the pinned Node release.
- [ ] Run raster-only fixtures and assert exact `384 × 120` dimensions/hash without opening the printer.

### C. Journal and supervision

- [ ] Place the database under `StateDirectory`; verify ownership and persistence across service restart and reboot.
- [ ] Prove `queued`, `printing`, `printed`, and `ambiguous` recovery across deliberate process termination.
- [ ] Prove WAL checkpoint/recovery (or selected rollback mode) and database integrity after abrupt process kill.
- [ ] Perform a controlled power-loss test on disposable/test data; verify the database and document the result.
- [ ] Crash the agent and verify systemd restart/backoff, health reporting, and journald output.
- [ ] Unplug/replug USB while idle and while a test job is at a controlled pre-command boundary; verify reconnect and no duplicate dispatch.

### D. Media and one-label physical approval

- [ ] Record roll manufacturer/SKU, measured label width/height, gap/mark type, orientation, and lot.
- [ ] With explicit operator approval, print exactly one non-attendee “Darko” fixture using the versioned profile.
- [ ] Check feed alignment, clipping, density, legibility, and status-vs-physical outcome.
- [ ] Print approved one-line, two-line, long-name, punctuation, Latin, and Macedonian Cyrillic fixtures as a bounded calibration set.
- [ ] Measure and version per-station offsets; never silently reuse `+28/+18`.
- [ ] Cold boot and print one final fixture. Record printer serial + Pi identity + stock lot + profile id/hash as the approved station contract.

## 8. Open blockers

1. Exact Pi model, RAM, Raspberry Pi OS edition/release, kernel, and architecture for each of the three checkpoints are unknown.
2. Two production NIIMBOT identities are entirely unknown; even `B1-GC0612113` is proven only as the current Fedora-attached unit, not assigned to a named production checkpoint here.
3. The local info probe sent Connect but did not fetch printer info; target firmware/model negotiation remains unproven.
4. The pinned Node, NIIMBOT Node package, Sharp/serialport native artifacts, and SQLite binding have not been clean-built on any target Pi.
5. WAL/FULL survived an ordinary laptop process restart only; abrupt-kill, reboot, power-loss, and SD-card recovery remain open.
6. `40 × 20 mm`, `384 × 120`, threshold/density, and `+28/+18` are historical for one printer/roll. Stock equality and calibration across all three stations remain open.
7. systemd unit install, boot enablement, access control, unplug recovery, health checks, and ambiguous-print reconciliation remain unproven on the targets.

## Sources and evidence ledger

### First-party / upstream sources

- **[R1]** Raspberry Pi documentation, “Raspberry Pi OS”, inspected at commit [`c8503da`](https://github.com/raspberrypi/documentation/blob/c8503da10cf60b4c607b773d41d54e3c75474d55/documentation/asciidoc/computers/os/rpi-os-introduction.adoc): official OS, Debian basis, Trixie/Bookworm, Lite, and 32-/64-bit guidance.
- **[R2]** Raspberry Pi Imager OS feed, [`os_list_imagingutility_v4.json`](https://downloads.raspberrypi.com/os_list_imagingutility_v4.json): current arm64/armhf Trixie images and legacy Bookworm images observed on 2026-08-14.
- **[N1]** MultiMote `niimbluelib`, B1 model metadata at [`b286f779`](https://github.com/MultiMote/niimbluelib/blob/b286f77926c1fe3d6f2c2dbc1abdac551dbae530/src/printer_models.ts#L173-L182).
- **[N2]** MultiMote `niimbluelib`, [`B1PrintTask.ts`](https://github.com/MultiMote/niimbluelib/blob/b286f77926c1fe3d6f2c2dbc1abdac551dbae530/src/print_tasks/B1PrintTask.ts): print initialization, page framing, image packets, status polling.
- **[N3]** MultiMote `niimbluelib`, [`serial_impl.ts`](https://github.com/MultiMote/niimbluelib/blob/b286f77926c1fe3d6f2c2dbc1abdac551dbae530/src/client/serial_impl.ts#L16-L61): serial open/negotiation; [packet write mutex](https://github.com/MultiMote/niimbluelib/blob/b286f77926c1fe3d6f2c2dbc1abdac551dbae530/src/client/serial_impl.ts#L109-L123).
- **[N4]** MultiMote `niimblue-node`, [`README.md`](https://github.com/MultiMote/niimblue-node/blob/a98d6800703f9d28c8689019db31a480f32970b3/README.md) and [`src/cli/worker.ts`](https://github.com/MultiMote/niimblue-node/blob/a98d6800703f9d28c8689019db31a480f32970b3/src/cli/worker.ts#L67-L96): serial examples, explicit profile options, Sharp threshold/resize, task/direction selection.
- **[N5]** MultiMote `niimbluelib`, [README disclaimer](https://github.com/MultiMote/niimbluelib/blob/b286f77926c1fe3d6f2c2dbc1abdac551dbae530/README.md).
- **[N6]** MultiMote raster encoders: browser/library [`src/image_encoder.ts`](https://github.com/MultiMote/niimbluelib/blob/b286f77926c1fe3d6f2c2dbc1abdac551dbae530/src/image_encoder.ts#L26-L101) and Node [`src/image_encoder.ts`](https://github.com/MultiMote/niimblue-node/blob/a98d6800703f9d28c8689019db31a480f32970b3/src/image_encoder.ts#L4-L71).
- **[N7]** MultiMote `niimblue-node` [`package.json`](https://github.com/MultiMote/niimblue-node/blob/a98d6800703f9d28c8689019db31a480f32970b3/package.json) and npm package [`@mmote/niimblue-node`](https://www.npmjs.com/package/@mmote/niimblue-node).
- **[D1]** Node.js, [`node:sqlite` API history and stability](https://nodejs.org/api/sqlite.html#sqlite).
- **[B1]** `better-sqlite3` [v13.0.3 release](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.3) and [`package.json`](https://github.com/WiseLibs/better-sqlite3/blob/v13.0.3/package.json).
- **[B2]** npm package [`better-sqlite3@13.0.3`](https://www.npmjs.com/package/better-sqlite3/v/13.0.3), whose inspected tarball listed Linux ARM64 and Linux-musl ARM64 prebuilds but no ARMv7 prebuild.
- **[Q1]** SQLite, [Write-Ahead Logging](https://www.sqlite.org/wal.html).
- **[Q2]** SQLite, [`PRAGMA synchronous`](https://www.sqlite.org/pragma.html#pragma_synchronous).
- **[S1]** systemd, [`systemd.service`](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html), especially `Restart=` and `RestartSec=`.
- **[S2]** systemd, [`systemd.exec`](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html), especially `StateDirectory=`.

### Transcript-backed local and historical evidence

- **[L1]** Prior-run live transcript, `/home/darko/.hermes/cache/delegation/live/deleg_a7de5fed/task-2.log`, lines 37–48: `lsusb`, full udev property query, by-id/by-path links; reconfirmed non-mutating during synthesis. Current output included `3513:0002`, `B1-GC0612113`, `cdc_acm`, by-id link, and `root:dialout` `0660` tty.
- **[L2]** Same transcript, lines 63–64: user/group context and `niimblue-cli info --transport serial --address /dev/serial/by-id/usb-NIIMBOT_B1_LABEL_PRINTER_B1-GC0612113-if00 --debug`; Connect frame sent, printer info not fetched.
- **[L3]** Same transcript, lines 107–110, plus `/tmp/pi-contract-journal-probe.mjs`: separate-process file-backed `node:sqlite` WAL/FULL persistence probe; outputs showed `journalMode:"wal"`, `synchronous:2`, and the retained state transition `printing` to `printed`.
- **[L4]** Same transcript, lines 51–62 and 71–72: npm metadata and source inspection for `@mmote/niimbluelib` Node build and `@mmote/niimblue-node` 1.1.0.
- **[L5]** Same transcript, lines 69–70: official Node SHASUM inventory; Node 22 contained `linux-arm64` and `linux-armv7l`, Node 24 contained `linux-arm64`.
- **[H1]** Recovered implementation plan, `/home/darko/Work/wts.sh/.hermes/plans/2026-08-13_142552-wts-mobile-checkin-label-printing.md`, lines 58–83 and 869–899: previous B1/40 × 20 hardware result, measured profile, per-station calibration warning, deterministic one/two-line renderer, and target hardware gates.
