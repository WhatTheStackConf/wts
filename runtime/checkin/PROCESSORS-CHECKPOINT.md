# Coordinator producers / safe-read checkpoint

Uncommitted work only; no production network, credentials, or physical devices.

Implemented:
- `loadCoordinatorProcessors` reads the private admission file once and creates admission plus the existing callback-aware recovery adapter from that snapshot. Legacy `loadCoordinatorAdmission` remains.
- CLI supplies reset to an independently supervised one-item reset loop; heartbeat remains independent. Reporting-only lifecycle never starts producers; stopped system still permits resets.
- Fixed NodeNext runtime imports and moved the event source interface into its contract (service re-exports it), avoiding importing the whole server implementation into the compiled runtime graph.
- Admission GET uses the process-local shared reader, retaining HTTP status and bounded delay metadata. POST remains single-shot.
- Durable pre-send release retains Retry-After with additive jitter, anchors conservatively against PB time, and prevents future coordinator clock from bypassing the stored deadline. Delays over 24 hours (including numeric overflow) exhaust automatic retry rather than truncating to early retry. Existing three-failure budget remains.

Final targeted verification: 6 files / 47 tests passed (admission read budget, runtime configuration, compiled reset fence, shared reader, supervision, runtime packaging); `git diff --check` clean. Runtime compilation succeeded. The adjusted arrival retry test separately passed. Full suite not rerun.

Verified already:
- Runtime tsc and actual Node import of compiled CLI succeeded.
- Actual compiled child CLI + disposable PB + production recovery adapter + test-only loopback transport: system stopped/open deletes the synthetic check-in once after the PB one-time fence, while independent heartbeat advances during held inspection; closed and restore-required modes leave reset queued with zero DELETE. These tests passed in `checkin-reset-fence.integration.test.ts` (alongside existing paused-fence/failure tests).
- First targeted configuration/read/fence/supervision run: 37 passed.
- Compiled fence + coordinator suite: 30 passed.

Last wider run found two test adaptations, corrected and rerun successfully (5 selected tests passed; runtime tsc clean): fixed 1100ms retry sleep ignored new jitter (now waits actual stored deadline); disposable PB restart correctly invoked restore fencing (retry-isolation fixture now clears boot_seen before restart; no production guard changes).

Environment: `pnpm` tries to repair shared symlinked node_modules and refuses UNSAFE_MODULES_DIR; use `node_modules/.bin/tsc` / `node_modules/.bin/vp` directly. Vite emits existing missing Nitro dev-entry and shutdown-handle warnings despite passing targeted suites. Full suite not completed under delegated time budget.
