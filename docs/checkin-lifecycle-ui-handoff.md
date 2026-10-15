# Lifecycle admin UI integration checkpoint

New files only (plus automatically regenerated file-routes.d.ts). No edits to baseline service/contract/hooks/migrations/runtime or AdminCheckinPage/runner.

## Parent integration

- Import `CheckinLifecycleAdmin` from `~/components/checkin/CheckinLifecycleAdmin` and mount `<CheckinLifecycleAdmin />` inside the existing authorized admin subtree. Optional `client` prop is the public HTTP client seam; not needed in production.
- New POST `/api/checkin-lifecycle` uses existing server-managed HttpOnly auth through `requireCheckinOperatorSession`; HTTP wrapper separately checks nonempty actor identity/admin role before constructing privileged service. Station binding cookies never confer lifecycle authority.
- Add `src/lib/checkin-lifecycle-http.test.ts` and `src/lib/checkin-lifecycle-client.test.ts` to explicit package test list (runner intentionally not edited).
- Browser helper `tests/checkin-edition-lifecycle-browser-helper.ts` exports `verifyLifecycleClosureInIsolatedFixture(page)` and `verifyOperatorCannotReadLifecycle(page)`. Call after login/navigation and UI wiring, only in a fresh disposable fixture. It forwards the real close mutation then corrupts only the returned edition, fails a read, verifies the identical UUID retry, reads real final HTTP status, and checks focus/mobile overflow. NOT executed in this unintegrated worktree; no browser acceptance claim.
- API route should be picked up by file routing; tests regenerated its declaration in file-routes.d.ts.

## Contract constraints

Responses validate exact edition, strict field allowlist, dates, fixed thirty-day deadline, central deletion vs compaction, device completion/method pairs and restore generation/approval state. Service contract contains no operationId echo, so client cannot claim command-specific audit acknowledgement. Close UUID is kept in memory across all failures/read retries; no browser storage or attendee data is introduced. Restore approval never enables system/stations and closed editions have no reopen action.

## Verification

- Focused public HTTP/client tests: 11 passing (auth, same-origin/CSRF, strict requests/body bounds, privacy/sanitized failures, invalid HTTP-200 identities, exact frozen retry, concurrent double taps, restore generation).
- `pnpm exec tsc --project tsconfig.checkin-browser.json --noEmit`: passed.
- Whole project typecheck has baseline errors in `checkin-lifecycle-files.test.ts` lines 16/31: AgentIdentity missing profileId. No remaining new-file errors after correcting test header typing.
- Existing `pnpm test`: 826 pass / 3 fail. Failures: runtime migration-last assertion expects 1790000009 despite supplied lifecycle migration 1790000012; event fixture expects selection unchanged after restart despite lifecycle quarantine; coordinator label approval/save fence conflict. These baseline/backend integration issues are outside UI ownership.
- Vite test process reports existing ten-second shutdown timeout warning even for passing focused tests.

No commits, pushes, live state changes, printer operations, or destructive purges performed. Full suite used only its isolated synthetic fixtures.
