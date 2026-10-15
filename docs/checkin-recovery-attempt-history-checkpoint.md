# Recovery attempt-history integration checkpoint

Implemented in this worktree: latest-25 ascending DTO window with explicit attemptsTruncated; separately bounded attempt_history through service, strict HTTP/client contracts and mounted paginated component. Business prints(w), cancel/currentPrint, canonical receipts, R.projectReset unchanged. No replacement cap.

Verified:
- Targeted recovery integration + HTTP + client + component tests: 42 passed (4 files), including actual disposable PB 1002-attempt traversal, latest pointer, 1003rd replacement/replay and <1KiB receipt.
- Additional strict attempt-page/client tests: 2 passed; reject oversized/duplicate/private-extra pages, wrong workflow/cursor, unsafe offsets; read failures/401/403 preserve frozen mutation.
- Reviewed exact backend diff against integration copy: only DTO and attempt_history changed; git diff --check clean.
- TypeScript --noEmit: exit 0.
- `node scripts/run-checkin-recovery-history-ui.mjs`: four mounted browser scenarios passed (pages, 401, 403, rebind/late page); mock loopback transport, not production/printing proof.

Known runner noise: vp test prints Nitro missing dev-entry and 10s shutdown timeout despite all tests passing and exit 0. No dependency/runtime modifications attempted.

Files: recovery.pb.js DTO/attempt_history only; recovery contract/service/client-contract/client/http; CheckinRecovery.tsx; new CheckinRecoveryAttemptHistory.tsx; recovery.integration.test.ts; new scripts/run-checkin-recovery-history-ui.mjs and tests/checkin-recovery-history-ui-fixture.tsx.
