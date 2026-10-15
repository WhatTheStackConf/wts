# Reset send fence — verified handoff

## Outcome

Additive `checkin-reset-fence.pb.js` and migration `1790000015_add_checkin_reset_send_fence.js` implement the immediate one-time pre-DELETE gate. Evidence is stored on the existing reset row and is therefore covered by its existing lifecycle purge. No changes to `checkin-recovery.pb.js`, `checkin-recovery.js`, `checkin-agents.pb.js`, or CLI.

Mandatory transport contract: `reset(job, beforeDelete: () => Promise<void>)`. The production recovery adapter invokes the callback only after successful fresh exact identity/fingerprint inspection and directly before DELETE. Missing/failed callback means no DELETE. Coordinator rejects legacy single-argument transports, allows one callback attempt only, validates the grant response, and does not accept unfenced `deleted` or post-grant `identity_changed` as safe outcomes. Changed identity can return `identity_changed` without requesting a grant only because no effect occurs.

Route: `POST /api/wts/checkin-reset-fence`, superuser only, body `{operation:'machine_reset_fence', owner, nowMs, job}`; reply `{resetId, authorized:true}`. Claim hook records system generation and frozen exact job atomically on queued->possibly_sent. Fence verifies live backend-clock owner lease, same coordinator/system generations, stopped system, open/nonrestore/nonpurged lifecycle, exact target and current reset_pending projection; transactionally sets `delete_fence_at`. Repeated/concurrent grants have only one winner. Existing pre-migration possibly_sent rows have no snapshot and cannot get a grant. Lost claim/fence/DELETE/result never requeues the original reset.

## Verification

PocketBase binary: **0.30.4**. Fresh disposable PB, byte-for-byte feature hooks/migrations, production adapter backed only by a loopback synthetic HTTP server. No production query, real upstream DELETE, printer I/O, deployment or commit.

```
./node_modules/.bin/vp test run --config reset-fence.vite.config.ts src/lib/checkin-reset-fence.test.ts src/lib/checkin-reset-fence.integration.test.ts src/lib/checkin-recovery-upstream.test.ts runtime/checkin/recovery.test.ts src/lib/checkin-recovery-runtime.integration.test.ts
```

**5 files, 31 tests passed**. Tests cover paused inspection + re-enable, enable then stop (changed system generation), backend lease expiry/takeover while original coordinator remains locally active, fingerprint mismatch, valid target exactly once, every target field, protected route, lifecycle/restore/purge, changed pending projection, concurrent/duplicate grants, lost committed fence/claim/result and lost DELETE response. All replay attempts have zero additional effects.

Both `./node_modules/.bin/tsc --noEmit --pretty false` and `./node_modules/.bin/tsc --project tsconfig.checkin-runtime.json --noEmit` passed.

`pnpm exec` tried an unsafe reinstall because node_modules is shared by symlink; direct `.bin/vp` works. `reset-fence.vite.config.ts` is a small standalone test config to avoid unrelated Nitro development startup/hanging handles. A first PB run exposed nonexistent JSVM `ConflictError`; replaced with verified `ApiError(409, ...)`.

## Files

New: hook, migration 15, `src/lib/checkin-reset-fence.test.ts`, `src/lib/checkin-reset-fence.integration.test.ts`, standalone test config, this checkpoint.
Modified reset sections only: `runtime/checkin/coordinator.ts`, `runtime/checkin/protocol.ts`, `src/lib/checkin-recovery-upstream.ts` and its test, and meaningful callback-aware mocks in `runtime/checkin/recovery.test.ts` / `src/lib/checkin-recovery-runtime.integration.test.ts`.

Parent can now wire the CLI reset processor directly to the safe production source (or a two-argument wrapper that forwards/awaits the callback). Keep migration 15 and the new hook in deployment/schema readiness checks. There is necessarily no atomic transaction spanning PB authorization and external upstream DELETE: the grant is the send authorization boundary, and no asynchronous inspection occurs between it and DELETE.
