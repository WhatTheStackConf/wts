# Lookup backend handoff

## Verified
- Three selected-ID fingerprint regressions first failed against real PocketBase (changed IDs replayed dependency_unavailable, rejected and needs_affiliation_choice), then passed after the durable binding fix. Existing reserved-result conflict remains covered.
- Final command: `./node_modules/.bin/vp test run src/lib/checkin-lookup.integration.test.ts src/lib/checkin-lookup-recovery.integration.test.ts src/lib/checkin-lookup-client.test.ts src/lib/checkin-lookup-hievents.test.ts src/lib/checkin-lookup-http.test.ts src/lib/checkin-arrival-resume.integration.test.ts src/lib/checkin-lifecycle-persistence.integration.test.ts` — **75 passed, 7 files**, exit 0.
- `./node_modules/.bin/tsc --noEmit --pretty false` and `git diff --check` passed.
- Recovery tests exercise mapping-only and base-ledger pending SAME-UUID reacquisition, final replay without identity GET, exact linked blank replay, forbidden fresh continuation after reservation, QR mismatch, post-identity-read role/selection changes, authorized login handoff, restart/context-changed read-only state, private-data absence, lifecycle purge and no re-creation.

## Parent wiring
`CheckinLookupService` now exports:
- `getRecovery(token: string | undefined, operationId: string): Promise<CheckinLookupRecovery>`
- `recover(token: string | undefined, input: CheckinLookupRecoverInput): Promise<CheckinArrivalResult>`

Types and strict recovery request schemas live in `src/lib/checkin-lookup-recovery-contract.ts`.
`CheckinLookupRecoverInput` is `{operationId,action:'replay'}` or `{operationId,action:'retry'|'blank',nextOperationId}`.
DTO fields: operationId, context, attendeeId, state, recovery ('available'|'context_changed'|'read_only'), actions, optional authoritative result.
No browser raw QR or search fields required. Context changes yield no actions, never rebased commands. Exact `confirm` cached replay still works during stop under valid live human/binding authority.

## Files
- New migration `pocketbase/pb_migrations/1790000014_create_checkin_lookup_commands.js`
- New protected hook `pocketbase/pb_hooks/checkin-lookup.pb.js`
- Modified `src/lib/checkin-lookup-service.ts`, `src/lib/checkin-lookup.integration.test.ts`, `src/lib/pocketbase-types.ts`
- New `src/lib/checkin-lookup-recovery-contract.ts`, `src/lib/checkin-lookup-recovery.integration.test.ts`
- Modified `pocketbase/pb_hooks/checkin-lifecycle.js` and `checkin-lifecycle.pb.js` for purge and creation fencing.
- This handoff.

Base arrival input/fingerprint, UI, browser clients and HTTP/routes untouched. No production access, commits, admission submissions or printing.

## Environment caveat
Use the direct node_modules binary in this symlinked worktree: `pnpm exec` attempted an unsafe cross-worktree install and was refused. Vite emits an existing Nitro dev-entry warning and a 10-second close timeout, but the real tests execute and exit 0. Do not repair shared dependencies from this child worktree.

## Remaining integration
Parent wires recovery HTTP/client/UI and includes the new recovery test file in its normal test command. Runtime behavior is verified at the server/real-PocketBase seams, not through new browser recovery controls.
