# Print-host verification

## Software evidence

Verified against the implemented standalone print host, not live admission or physical labels:

- Runtime compilation and repository TypeScript check pass.
- Full configured application suite passes with `pnpm test --exclude '**/.hermes/**'`: 1,446 tests passed, one skipped. The explicit exclusion avoids discovering a separate nested Hermes worktree as duplicate test suites. Vitest reports an existing shutdown/active-handle warning after successful tests; exit status is zero.
- Host suite: 31 tests passed on Node 22.23.2, covering private configuration/duplicate assignments, serial discovery and replug routing, Darwin dial-in/callout mapping, open-stream identity rejection, process-lifetime ownership, legacy CLI contention, isolated worker exits, loss of a start response and package construction. Scoped lint/type checks report no warnings/errors.
- Standalone clean `npm ci` and `npm run smoke` pass on Linux x64 / Node 22.23.2 and 24.13.1. Packaging now uses `isBuiltin` to recognize prefix-only `node:sqlite` on Node 22; both a regression fixture and the real compiled graph were verified on that baseline.
- The same standalone archive installs with `npm ci --omit=dev --no-audit --no-fund` on macOS 15.7.7 / Apple Silicon / Node 24.21.0. SHA-256 verification on the Mac passed before extraction. Node is provided by nvm; noninteractive SSH needs its explicit PATH.
- Mac `npm run smoke` passes native imports, embedded Latin/Cyrillic font rendering, NIIMBOT bitmap encoding, serial-client construction without connection, explicit disposable journal creation/refusal-to-recreate, and offline two-station configuration validation.
- All 24 runtime host tests pass on that Mac using the distributed modules. Tests use a disposable loopback coordinator and simulated/injected printers. They verify actual Node child processes and local ownership behavior without production requests or device writes.

The USB-only distribution carries an explicitly modified client facade for pinned upstream niimbluelib; its serial protocol/print implementation is unchanged. The clean-install smoke gates package publication. No global package install, service/autostart enablement, production credential provisioning, live journal migration or physical printing was performed.

## Still required before event use

The latest macOS and host inventories show all three intended NIIMBOT B1 USB devices. Real serialport inventory returned `/dev/tty.*` names; the platform adapter now maps those to their matching `/dev/cu.*` callout endpoints before filtering. All three printers passed real negotiation and protocol-serial queries through the packaged host, returning distinct identities. No print/feed task was sent. Physically confirm all intended USB-selector/protocol-serial mappings before assigning station configurations. Verify actual USB power/hub/cables under simultaneous printing.

Complete the documented controlled Pi-to-laptop handoff: reconcile outstanding/uncertain work, stop old agents, revoke/rotate credentials through the existing workflow, provision new laptop journals, confirm profile readiness and phone bindings. Do not copy an active journal or create an empty replacement for unresolved state.

Run authorized physical labels from both paired phones, simultaneous output, explicit reprint, unplug/replug/reordered ports, Internet interruption and host stop/start. Simulated routing and packet encoding are not physical acceptance.

See [operator guide](checkin-print-host.md) for setup and migration commands. The original [design](checkin-multi-printer-host-design.md) records the intended architecture; this file records the verified software boundary.
