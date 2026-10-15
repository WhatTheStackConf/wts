# Single-laptop, multi-printer check-in host

Status: runtime implemented and standalone package installed for macOS verification. Production migration and physical label acceptance remain pending. See [operator guide](checkin-print-host.md) and [verification evidence](checkin-print-host-verification.md).

## Decision

Keep a station as a logical registration lane, not a physical computer. Run one operator-facing Node print-host application on the laptop, supervising one isolated agent worker per station/printer. The hosted coordinator remains authoritative for scans, admission, print authorization and outcomes. Phones keep their existing station-pairing workflow.

```text
Phone paired to station 1 ─┐                        ┌─ station 1 worker → USB printer A
                          ├→ WTS site/coordinator ↔ laptop print host
Phone paired to station 2 ─┘                        └─ station 2 worker → USB printer B
```

All laptop/server traffic is outbound HTTPS. Phones need no direct laptop connection, local certificate, inbound firewall exception or shared Wi-Fi subnet. This does not make check-in offline-capable: fresh authorization still requires the coordinator.

## Existing seams to preserve

- `runtime/checkin/protocol.ts`: `AgentIdentity` already separates station, agent, printer, journal and profile identities. Hosting multiple logical agents on one machine does not inherently require a server schema change.
- `runtime/checkin/cli.ts`: one agent/config per invocation; shared process-level signal handling makes isolated worker processes a safer initial supervisor design than concurrently calling `main()` in one process.
- `runtime/checkin/printer.ts`: the serial adapter currently accepts only Linux `/dev/serial/by-id/` paths. Portability requires discovery and identity validation, not merely relaxing the path prefix.
- `runtime/checkin/journal.ts`: durable, identity-bound journals and uncertainty handling must remain per logical agent. A missing journal is not automatically initialized at startup.
- `deployment/systemd/wts-checkin-agent.service`: Linux `flock` and service-manager assumptions currently provide process ownership. The laptop launcher must provide equivalent ownership without depending on that systemd template.
- `runtime/checkin/agent.ts` and the CLI currently convert network failure into a controlled exit; exit 78 prevents automatic systemd restart. A laptop alone does not fix this reliability problem.

## Addressing and configuration

Use four distinct concepts:

| Concept | Meaning | Stability |
| --- | --- | --- |
| Station ID | Phone pairing, lane label and server routing | Retain existing station IDs |
| Printer identity | Physical printer assigned to the lane | Retain approved logical identity; validate against observed USB identity |
| Agent identity | Credential-bearing worker for this station on this host | New identity on controlled migration |
| Device address | OS path used to open the USB serial connection | Resolved at runtime; never used as the business identity |

The initial host configuration is versioned and contains a list of private per-station configuration paths. Each station retains its own credential file, approved profile and journal path. Hardware selectors extend the station configuration; they do not put USB paths into scan requests or browser pairing codes. A host label is local operational metadata initially, not a mandatory new server entity.

Device discovery must enumerate serial metadata without opening or printing to devices. Match an explicitly enrolled USB vendor/product/serial combination and interface where needed, then resolve its current native path. Use macOS callout paths (`/dev/cu.*`) and Linux serial devices through a platform adapter. Treat USB serial strings exactly as observed; the recorded NIIMBOT USB serial is not necessarily identical to the full printed case serial.

Enrolment requires explicit operator assignment and an authorized physical identification label. Replugging or reordering USB ports must not change station routing. Zero matches means disconnected; multiple matches or missing unique serial evidence means ambiguous and blocked pending explicit identification. Never assign printers by enumeration order, first match, or a bare changing `/dev/ttyACM0` path.

## Host behavior and ownership

- One foreground command launches the host and all configured workers. A small terminal status view reports each station, resolved device, coordinator connection, worker state and actionable failure. No desktop framework or local web server is necessary for the first delivery.
- One sequential print execution stream per printer; independent printers may print concurrently. A failed/disconnected printer pauses only its own lane.
- Reject duplicate station IDs, printer selectors, credentials/agent identities and journal paths before starting workers.
- Enforce host-wide exclusive ownership of each physical printer and state directory across application instances, not only within one process. Validate the cross-platform locking implementation on Linux and macOS; a PID file alone is insufficient. USB path aliases must not evade ownership.
- Use restrictive local file permissions, sanitized diagnostics and per-station credentials. No PocketBase superuser credentials on the laptop.
- Graceful shutdown stops taking new work and preserves durable outcomes. A worker crash, USB disconnect, laptop sleep or power loss must preserve the existing uncertain-output semantics.

## Connectivity recovery

Split transport availability from terminal authorization/configuration failures. Show reconnecting status and use capped exponential backoff with jitter for safe discovery/read requests. Re-enter existing journal recovery before new work after reconnection.

The supervisor must not simply restart every exit 78 forever. Revoked credentials, identity mismatch, corrupt/lost journals and lifecycle retirement remain terminal or require an explicit operator recovery action. Never blindly retry a physical print, an authorization/start mutation, or an ambiguous outcome. A reconnect can resume safe polling and reconciliation; it cannot turn uncertain output into a fresh print attempt. User-requested reprints continue through the existing explicit workflow.

## macOS distribution and hardware prerequisites

Ship a dedicated print-runtime package/archive with a small manifest and an operator runbook, not the entire SolidStart application checkout. Pin and test a supported Node LTS version that provides the runtime's `node:sqlite` API. The existing driver and renderer use native dependencies (serialport, Sharp, and dependency-tree Bluetooth bindings), so install for the Mac's architecture and verify imports there; copying Linux/ARM `node_modules` is not supported. Serial-only startup must not require a functioning BLE stack.

Initial support target: macOS and Linux. Do not claim Windows support from Node portability alone; serial naming, permissions, locking and native installs need separate evidence.

Use the laptop on mains power and a sufficiently powered USB hub when needed. The observed Pi undervoltage is a reason to change topology, not proof that a laptop removes USB power limits. Verify simultaneous printing with the actual hub/cables. Keep the laptop awake while hosting; close-lid/sleep must be part of the operating checklist. macOS `caffeinate` can be an optional documented wrapper rather than hidden behavior. One laptop also becomes the common failure point for all lanes.

## Migration gate

1. Record current station/printer/profile assignments and pending or uncertain attempts without exporting attendee data into ordinary logs.
2. Stop new work for affected lanes and stop the Pi agents. Preserve their journals and inspect unresolved work; do not copy an active journal and run two owners.
3. Reconcile outstanding attempts through supported recovery. If an old Pi/journal is unavailable, treat uncertainty explicitly instead of manufacturing an empty replacement history.
4. Retire/revoke old agent credentials through the supported station-generation flow. Provision new per-station laptop agents and journals only after that handoff is safe. Confirm which existing phone bindings remain valid; re-pair only when the actual generation rules require it.
5. Enrol each physical printer, confirm its existing profile or approve an appropriate replacement, and verify the laptop's local assignments. Do not silently change media/rendering profiles.
6. Enable lanes only after physical acceptance. Production credential rotation, deployments and print tests require explicit authorization; this design does not perform them.

## Implementation and acceptance order

1. **Portable discovery and assignment:** deterministic adapter tests for macOS/Linux inventory, port renaming, absent/duplicate serials, aliases, unplug/replug, swapped order and wrong-printer rejection. Completion: no ambiguous inventory can acquire a printer assignment.
2. **Multi-worker host:** tested private manifest validation, isolated journals, per-device/state ownership, worker status, shutdown and single-lane failure containment. Completion: two simulated stations route concurrently with no cross-delivery or second-owner access.
3. **Safe reconnection:** test network loss before authorization, around start, after possible output and during reporting; credential revocation and journal corruption remain fail-closed. Completion: reconnection resumes eligible work without replaying uncertain physical output.
4. **Packaging and migration runbook:** install the runtime under the pinned LTS version on the actual Mac, prove serial-only imports/discovery and private configuration. Completion: a clean machine can run the documented command without the application repository or Linux-only tools.
5. **Physical dress rehearsal:** route distinguishable scans from two paired phones to their assigned printers; simultaneous printing, deliberate rescan/reprint, unplug one printer while the other works, reorder USB ports, stop/start host, restart laptop and interrupt Internet. Completion: correct output routing, healthy power, visible recovery states and no automatic duplicate labels, with owner confirmation.

The runtime and Mac software path are implemented and exercised; current evidence and remaining migration/physical-acceptance gates are recorded in [verification evidence](checkin-print-host-verification.md). Portable enrolment additionally requires the protocol serial read from the opened printer, guarding against OS-path reuse between discovery and connection.
