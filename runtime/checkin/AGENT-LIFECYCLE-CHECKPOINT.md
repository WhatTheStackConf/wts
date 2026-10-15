# Agent lifecycle checkpoint — entrypoint proof obtained

Owned files changed: runtime/checkin/agent-lifecycle.ts (new), runtime/checkin/cli.ts (agent branch only), runtime/checkin/protocol.ts (two operation names), runtime/checkin/coordinator.ts (Replies/fields/machine forwarding only), pocketbase/pb_hooks/checkin-lifecycle-proxy.pb.js (new), src/lib/checkin-agent-cli-lifecycle.integration.test.ts (new), docs/checkin-lifecycle-retention.md (CLI section).

Wire: public `policy` {stationId,journalIdentity} and `purge_complete` {stationId,journalIdentity,purgeToken,method:"retired_and_compacted"}; coordinator hashes original Bearer SHA256(wts2026:agent:<credential>) and calls privileged /api/wts/checkin-lifecycle-proxy machine_policy/machine_purge_complete. New route maps exact hash + station + journal BEFORE lifecycle access, using PB's own clock. Legacy existing worker operation names are device_policy/device_complete, not machine_policy. No agentId input / PB credential exposure.

CENTRAL CHILD REQUIRED: preserve HTTP listener while closed/restored/active=false; my lifecycle machine branches precede active gate. Preserve original reporting endpoints while closed before deadline. I did not change listen, pulse, coordinator CLI or worker hooks.

Verified: runtime compile and whole-project tsc --noEmit pass. Latest targeted suite: 4 files / 23 tests pass, including parent four CLI recovery tests and compiled lifecycle child-process proof. The new actual compiled CLI proof creates pending synthetic print work then closes edition, revokes/expires original credential, confirms no authorization and received journal work unchanged; caches closure; stops proxy; crosses deadline; retires exact journal/spool offline; verifies central receipt outstanding; restarts proxy; verifies missing/corrupt/foreign/hardlink journals and symlink spool reject with exit78 and NO receipt; repairs only test material, reconnects and reads back completed receipt. No real printer/production data.

Broader 5-file run: 34 passed / one blocked before assertions by pnpm ERR_PNPM_UNSAFE_MODULES_DIR, because node_modules is symlinked into integration worktree. Ran local .bin/tsc and .bin/vp directly instead. Vite/Nitro emits existing missing dev-entry warning and 10s close warning even on passing runs. No dependency deletion/install workaround.

Outer flock and service writable paths unchanged; policy fence stays in existing owned root, 0600 atomic/fsynced via existing proven retirement helper. Missing active journal still goes through existing failure/quarantine path AFTER authenticated policy. No journal recreation. Printer construction is lazy after policy/work readiness, quiesce drops journal/agent/printer references.

No commits. Parent must merge selective coordinator/CLI hunks with central lane and rerun assembled coordinator entrypoint tests before claiming all #57 complete.
