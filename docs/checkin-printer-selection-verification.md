# Operator printer dropdown — 2026-09-18

## Clean release candidate

The release is isolated on top of `09d7d71af05068d38d1de66151d69486eaaa1396` (`origin/master`), not built from the dirty implementation checkout. Only the dropdown, its tests, and its test-script entries were transferred. In particular, uncommitted print-host/runtime clock work is excluded.

On this exact clean candidate, `pnpm install --frozen-lockfile`, `pnpm check`, and `pnpm typecheck` pass. The canonical `pnpm test` passes **1,462 tests with one skipped**. The dirty-tree clock failure described below is absent on the release candidate. Counts differ because the release includes newer upstream changes and excludes unrelated local edits. The following sections preserve the original implementation-stage evidence; deployment/CI identity is recorded in the release PR.

## Behavior

Signed-in admins and check-in operators choose the printer directly on `/checkin`, or in **Tools → Phone**. The accessible native **Printer** dropdown replaces the QR scan/review/confirmation workflow. No printer is selected automatically. The browser retains its selection across reload and login handoff; revoked browser identities remain revoked.

Configured stations remain the internal queue/journal/agent routing identities. Stopped choices are unavailable. Selection alone is not physical readiness or permission to print; normal event, profile, agent, lifecycle and authorization checks are unchanged. Old QR endpoints remain compatible for existing clients/admin workflows, but are not presented in the operator UI.

A printer change:

- revalidates the authenticated actor, station/system generations and browser binding version transactionally;
- preserves only a still-current event selection, then issues a fresh binding/selection context;
- rejects stale concurrent-tab selection and old intake contexts;
- never moves existing jobs or starts an admission/print;
- is blocked while the browser holds an unresolved camera/manual workflow;
- reconciles an unknown response through status reads, not an automatic mutation retry;
- cancels a choice queued behind Web Locks on actor change/unmount, and sends an expected-actor rejection fence to prevent using a newer shared login cookie.

The catalogue establishes the persistent HttpOnly identity under the same Web Lock used by legacy preview calls. Status may temporarily describe that valid cookie without a binding row as `invalid`; this does not block first selection. Revocation does.

## Verification

All network/database tests below use disposable loopback services and synthetic actors/tickets. No physical printer or production write is implied.

- `pnpm typecheck`: passed.
- `pnpm exec tsc --project tsconfig.checkin-browser.json`: passed.
- Focused Vitest: **42 passed** across checkin-http, checkin-pocketbase.integration, checkin-events.integration, checkin-event-safety.integration, checkin-scanner-privacy and checkin-camera.
- `pnpm test:checkin-components`: passed, including **26 printer-selector browser scenarios**, polling stability, held-work recovery, and existing lifecycle/lookup/recovery component harnesses.
- Built-app E2E group 1: **17 passed** across printer-selection, lifecycle, access, roles, scanner UX, scanner-recovery UX and tools-dashboard.
- Built-app E2E group 2: **17 passed** across agents, arrivals, events and camera.
- Final standalone printer-selection E2E: **1 passed**, including idle first selection, disabled choices, selection persistence, lost response reconciliation and no admission/print side effects.
- The E2E runner runs the full production `pnpm build` (including check-in runtime compilation) in an isolated copy with no production environment. Builds passed.
- Mobile scanner assertions include 320×568 and 390×844 layouts. The compact dropdown leaves the next-scan action inside the short viewport.
- `git diff --check`: passed.

## Existing full-suite failure

`pnpm test --exclude '**/.hermes/**'`: **1,455 passed, 1 failed, 1 skipped**. The failure is `src/lib/checkin-agent-protocol.integration.test.ts`, `AgentError: authorization_expired` at its second authorization after advancing the injected clock. It also fails alone. A disposable reproduction using the **pre-dropdown HEAD version of checkin.pb.js** fails identically, establishing that the printer-selector hook did not introduce it. Runtime clock code and this unrelated fixture were left unchanged. The established Vite shutdown/active-handle warning also remains.

Local evidence:

- `/tmp/wts-printer-dropdown-full-final.log`
- `/tmp/wts-printer-dropdown-targeted-final.log`
- `/tmp/wts-printer-dropdown-components-final.log`
- `/tmp/wts-printer-dropdown-regression-e2e-fixed.log`
- `/tmp/wts-printer-dropdown-routing-e2e.log`
- `/tmp/wts-printer-dropdown-final-e2e.log`
- `.output/printer-dropdown-verification/protocol-baseline.log`
- `.output/printer-dropdown-verification/mobile-printer-dropdown.png`

## Deployment boundary

No commit, push, production deployment, service restart, printer enablement, queue/journal deletion or physical print was performed for this change. The operational system was already stopped. Deploy the scoped frontend/server files and PocketBase hook together using the normal release workflow; do not deploy the heavily dirty checkout wholesale. Physical Station 2/3 acceptance and deliberate-rescan reprint semantics remain separate from this dropdown change.
