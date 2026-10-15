# Recovery UI completion checkpoint

## Changed files (this worker only)
- src/components/checkin/CheckinRecovery.tsx
- src/components/checkin/AdminCheckinPage.tsx (recovery import/mount only; preserve other workers' changes)
- src/components/checkin/CheckinStationPage.tsx (recovery import/mount only)
- src/lib/checkin-recovery-client.ts
- src/lib/checkin-recovery-http-client.test.ts
- NEW src/routes/api/checkin-recovery.ts
- NEW tests/checkin-recovery.spec.ts

## Behavior
401/403 from commands, reads, reconciliation, or preview synchronously invalidates read/preview/authority generations and clears private recovery signals. Late successful reads/PNGs cannot republish. Ambiguous commands, including a first denied response that could mask a commit, keep their frozen UUID/payload in the memory-only slot. Retry stays disabled until an explicit fresh server-authenticated, binding-checked read succeeds; verification does not redisplay its response or modify the saved slot. A later 403 cannot erase earlier unknown outcome. The route uses existing server session authentication and real source factory. Admin mounts from the actual admin route guard; station mounts from authenticated user/role and bound binding ID/version.

Handwriting now includes explicit human-attestation checkbox and pending-state confirmation copy; no worker/agent acknowledgement calls UI submit. Backend handwrite_pending-to-handwritten correctness remains the backend worker's responsibility (this tree's old backend still rejects repeat handwrite_pending via permitted()). Do not claim that backend transition proven by this worker's browser test.

## Verified real execution
- `node_modules/.bin/tsc --noEmit`: passed.
- `node_modules/.bin/vp test run src/lib/checkin-recovery-http-client.test.ts src/components/checkin/CheckinRecovery.test.tsx src/lib/checkin-recovery-http.integration.test.ts`: 30 tests passed across 3 files. Existing Nitro dev-entry warning and shutdown timeout, exit 0.
- Actual production-built application, disposable PocketBase and loopback HTTPS Hi.Events fixture: `tests/checkin-recovery.spec.ts` passed (1 test, 6.4s latest run). Not SSR-only or component mock evidence.
- Browser covers real session cookies; real UI reservation; mounted station/admin recovery; Cyrillic PNG decode, 200-character Cyrillic shortening and unsafe preview rejection; 320px layout; real correction commit with dropped response, later 403, frozen retry after failed/successful re-verification; delayed real history and PNG responses cannot reveal after denial; real park commit masked by first 403, byte-equivalent retry and DB version/row assertions; admin initial 401 redacts private truth/action controls; explicit human checkbox gating.
- `git diff --check`: passed.

## Reproduce without touching shared runner/modules
This worktree has symlinked node_modules. pnpm 11's automatic dependency verification initially refused unsafe removal; do not install through that symlink. Direct .bin tools work. For the shared browser runner, a temporary PATH pnpm wrapper adds `--config.verify-deps-before-run=false`; no shared runner or package changes were made:
`PATH=/tmp/wts-recovery-tools:$PATH node scripts/run-checkin-browser.mjs tests/checkin-recovery.spec.ts`
Latest browser log: `/tmp/wts-recovery-browser-4.log`. Screenshot: `test-results/checkin/checkin-recovery-mounted-r-ea29a-ies-and-replays-frozen-UUID/recovery-cyrillic-reverified-320.png`.
No real printer, admission POST, reset DELETE, production state, commits, or secrets were used. The fixture's allowed loopback reads/DB writes and recovery commands are real.
