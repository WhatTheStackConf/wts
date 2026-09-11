# Central maintenance and reporting-only gateway

No production deployment or physical printer validation has been performed.

Run `pnpm build:checkin-runtime`, then `pnpm checkin:maintenance /etc/wts-checkin/maintenance.json` on the central host only. Install the separately supervised `deployment/systemd/wts-checkin-maintenance.service`; do not attach its lifetime to the coordinator service. It neither starts the coordinator nor acquires/pulses its producer lease, and can observe coordinator unavailability while that process is absent.

Private mode-0600 maintenance JSON:

```json
{
  "pocketbaseUrl": "http://127.0.0.1:8090",
  "superuserCredentialFile": "/run/credentials/wts-checkin-maintenance.service/pocketbase",
  "pollIntervalMs": 5000,
  "deliveryLimit": 10,
  "once": false
}
```

The credential file is a private JSON object with exactly `email` and `password`. Unknown maintenance configuration keys, non-private files, invalid bounds and incompatible schema fail closed. No PB credential belongs on a station. `once: true` performs one serial pass and exits; use this only against an explicitly disposable PB in tests. CLI accepts no clock override or arbitrary operation. Production readiness uses the backend clock and existing authoritative three-station DTO, not impersonated human admin reads.

Each pass invokes the existing privileged lifecycle `tick`, invokes `compact` only after central deletion and before recorded compaction, and otherwise observes/delivers through the existing monitoring worker. The fixed closure deadline is not recomputed. After central deletion it does not repopulate monitoring records. No recipients means no delivery claims or SMTP sends (incidents and pending envelopes remain visible for configuration). Provider diagnostics never enter runtime logs; mail ambiguity remains nonreplayable. A controlled failure exits 78 and systemd must not allocate another automatic retry budget; inspect/fix and explicitly restart. Unexpected process crashes retain bounded systemd restart policy.

Coordinator startup reads `machine_coordinator_status` before lease acquisition. Closed or restore-required editions bind their HTTP gateway in reporting-only mode without claiming ownership. Closure during production aborts producer loops through the existing supervisor; the gateway remains available only after a trusted backend lifecycle read confirms closed/restore-required state. Ordinary owner loss while open is a controlled failure, never takeover authority. Heartbeats remain independent of slow admission processing. Reporting-only never automatically resumes production after restore approval; operator reconciliation and explicit restart are required.

## Verification

`src/lib/checkin-central-maintenance.integration.test.ts` builds and executes the actual compiled CLI using disposable PB: absent coordinator incidents, owner/generation immutability, superuser-only readiness, recipients-unset no sends, live closure transition, HTTP status allowed/work denied, reporting-only cold startup, and immutable-deadline deletion via the privileged lifecycle hook followed by CLI compaction. Existing monitoring integration includes a real loopback SMTP sink. There is no physical device or live upstream in these tests.

## Integration boundaries

New helpers: `runtime/checkin/central-maintenance.ts` and `central-coordinator.ts`. CLI edits are imports/mode dispatch and the coordinator branch only; preserve the sibling's agent branch. `Coordinator` adds `lifecycleMode`, `enterReportingOnly`, `listenReportingOnly` and private gateway binding extraction. The sibling owns lifecycle/purge operation forwarding in `machine`; preserve its operation types/validation while retaining reporting-only status/outcome/cancellations/neutralized. This branch adds a minimal status bypass before the PB owner gate and local inactive gate so its reporting integration runs independently; merge that with the sibling's richer lifecycle policy rather than overwriting it. The acquire hook now rejects closed/restore-required lifecycle. Schema metadata gate checks 15 real fields including migration 15's three reset-send evidence fields. Type-only monitoring contract aliases are relative `.js` imports for standalone NodeNext compilation.

Parent follow-up: include this service/doc in the runtime packaging allowlist and test it with the combined lifecycle-forwarding branch; reset-adapter wiring stays parent-owned. Review full combined regression suite because older tests that reacquire after PB restart must now use reporting-only mode (the coordinator outcome replay regression is updated here).
