# Monitoring UI recovery handoff

## Changed
- `src/components/checkin/checkin-monitoring.tsx`: editor owns a snapshot independent of dashboard error/render lifetime; exact operation UUID and payload remain frozen through ambiguous responses, unknown exceptions, acknowledgement refresh failures and later rejections. Explicit discard/reload or cancel only when no unresolved command; an initial definite 400/409 blocks new saves until reload. Manual observation refresh remains available during editing. Acknowledgement busy ends independently of dashboard read. Optional typed client seam; production uses validated real HTTP client.
- `src/lib/checkin-monitoring-client.ts`: typed HTTP status on sanitized request errors enables definite conflict discrimination.
- `src/lib/checkin-monitoring-client.test.ts`: HTTP conflict/failure classification checks.
- `src/components/checkin/AdminCheckinPage.tsx`: mounts admin monitoring under existing guard, keyed to current user ID/role. Uses existing `agentAdminList` + `createAgentReadinessResource`; hides stale readiness on errors/loading. This resource is remounted with panel, so previous users' recipient snapshots do not survive an identity change.
- `tests/checkin-monitoring-recovery.spec.ts`: real Chromium on actual AdminCheckinPage, real login/HttpOnly PB session, real concurrent configure 409 and durable configure replay. Only fault injection uses Playwright route: committed response lost after real route.fetch(), subsequent dashboard 503. Real worker.observe creates incidents; no email delivery invoked.

## Checkpoint verification
- Real browser: 2/2 passed; `/tmp/monitoring-ui-playwright.log`.
- `pnpm typecheck`, browser tsconfig compile: passed after correcting Solid 2 keyed Show callback signature.
- `pnpm check`: 0 errors / 89 warnings, no monitoring-specific warning. Removed monitoring unbound refetch warning; inherited runtime supervision contributes warnings, not changed here.
- Focused component/client suites: final 4/4 passed; `/tmp/monitoring-ui-final-tests.log`. Existing Vite close-timeout warning remains.
- Final production build + disposable real-browser rerun passed: 2/2 in 4.5s; `/tmp/monitoring-ui-final-browser.log`. Both disposable runners stopped; no services left intentionally running.
- Screenshots in `test-results/checkin/*/monitoring-conflict.png` and `monitoring-frozen-after-ack-503.png` show actual panel, not default page.

## Integration command
`node scripts/run-checkin-browser.mjs tests/checkin-monitoring-recovery.spec.ts --reporter=list`
Runner already copies named checkin hooks/migrations, so no shared runner changes needed. New spec matches existing `checkin*.spec.ts` selection. Do not conflate these focused fault-recovery cases with full worker lifecycle/end-to-end parent acceptance.

No backend hook/worker/migration, shared runner, unrelated feature code, commits, production, email, or hardware changes.
