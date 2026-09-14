<!-- Hallmark · pre-emit critique: P5 H4 E4 S5 R4 V4 -->
# Signed-in usability cleanup

Date: 2026-09-14

## Scope and constraints

Simplify logged-in workflows for attendees, reviewers, MCs, check-in operators, and administrators. Preserve the existing WTS design system and essential privacy, consent, publication, physical-approval, and destructive-action guidance.

`DESIGN.md` and `src/styles/app.css` were verified byte-identical to the pre-edit snapshot. No new theme, token stylesheet, fonts, dependencies, production routes, or backend business rules were introduced. No files were deleted. Existing unrelated work remains uncommitted and untouched by this task.

The release modifies 43 existing UI files. The only changed `src/lib` file is the disposable test helper. Routes and component ownership remain intact.

## Screen inventory and changes

| Area | Routes / owners | Result |
| --- | --- | --- |
| Account | `/user/profile`, `LoginMenu` | Account / Achievements / Talk proposals jump links, straightforward names and actions, smaller identity block, flatter sections. |
| Achievements | `/user/profile#gamification` | Removed duplicated recent badges; optional Public visibility and Badges to earn disclosures; retained visibility controls, independent badge settings, consent and withdrawal consequences. |
| Mission redemption | `/missions/redeem` | Concise action/results, Code help disclosure, achievements link; retained pending-code resume/retry and separate unchecked partner consent. |
| Live Q&A | `LiveQaPanel` on `/sessions/[slug]` | Shorter private-question notice, compact drafting/list/pagination, timing help disclosure. Public session content unchanged. |
| MC | `/mc`, `LiveQaDashboard`, existing `LiveQaStages` | Shorter page header and question controls; newer upstream stage-scoped catalogue, QR links and filtering preserved. |
| Admin landing | `/admin` | Grouped Programme / CFP review / Event operations / Access destinations instead of repeated promotional cards; all original links plus MC Q&A. CFP failure feedback is visible. |
| Admin management | `/admin/users`, `/admin/proposals`, `/admin/agenda`, `/admin/speakers`, `/admin/sessions`, `/admin/partners`, `/admin/mcp`, `/admin/tickets` | Shared header simplification and shorter explanations; technical/legacy setup detail disclosed where appropriate. Tables and mutations preserved. |
| Admin achievements | `/admin/gamification` and its mission/support components | Draft forms disclosed, concise guidance; activation, retirement, secret-code handling and consent boundaries retained. |
| Reviewer | `/reviewer`, `/reviewer/[id]`, `/reviewer/leaderboard`, `/reviewer/weights` | Clear queue/actions, retained scoring criteria and ranges, concise weight guidance and feedback. |
| CFP | `/cfp/01-intro` through `/cfp/06-confirmation`, `/cfp/my-submissions` | One task heading, compact step indicator, plain labels, less repeated prose. Intro retains anonymized review and expense policy with optional topic ideas. Corrected confirmation's personal-details link to the real route. |
| Check-in administration | `/admin/checkin`, seven existing check-in components | Copy-only reductions in event/agent/label explanations and field labels. AST comparison found JSX text changes only in that lane. |
| Check-in operations | `/checkin`, `/checkin-tools` | Event-selector wording shortened. Existing compact scanner, recovery, lookup, lifecycle, monitoring and arrival controls deliberately retained: their remaining explanations convey safety constraints. |
| Redirects and public content | `/user`, `/admin/weights`, `/reviewer/weights` wrappers; `/cfp/closed`; other public routes | Existing behavior retained. Public marketing, shared branding/background, and footer not redesigned. |

## Clean release verification

The approved cleanup was transferred as a task-only delta onto `origin/master` at `f28873a`, without bringing the dirty checkout's unrelated work or unshipped commits. Conflicts were reconciled with the newer stage-based Q&A implementation and its midnight-safe fixtures, not resolved by overwriting them with stale files.

- Frozen dependency install: passed; dependency versions and lockfile unchanged.
- `pnpm test`: **1,372 passed, 1 skipped** across 112 files. The existing opt-in live-registration test is skipped without production configuration.
- `pnpm test:usability`: **27 passed**.
- `pnpm test:workspace-browser`: **19 passed**, including the upstream authenticated navigation and stage-scoping regressions as well as the new responsive/workspace checks.
- `pnpm typecheck`, `pnpm build`, `git diff --check`: passed.
- `pnpm check`: **0 errors, 122 warnings** on the release tree; formatting remains disabled by existing configuration.
- CI now runs the usability suite and the combined workspace/Q&A browser suite. GitHub CI and exact-SHA deployment evidence belong to the release PR, not the earlier working-tree results below.

## Original implementation verification

- `pnpm test`: **110 files, 1,167 tests passed**.
- `pnpm test:usability`: **3 files, 27 tests passed** (account, admin and reviewer/CFP regressions).
- `pnpm typecheck`: passed, including the new workspace Playwright config and test file.
- `pnpm check`: **0 errors, 120 warnings** at the recorded check. Formatting is disabled by the existing configuration. No warning backlog cleanup was attempted.
- `git diff --check`: passed.
- `pnpm test:workspace-browser`: **12 tests passed** against an isolated production build and real disposable PocketBase.
  - All five roles save their names and public visibility settings, read back the exact database records, reload and verify persistence.
  - Original admin destinations remain available; CFP state changes are read back and restored.
  - Q&A privacy, moderation, closure, account switching, revoked authority, lost-response exact retry, and draft preservation remain covered.
  - Account, admin hubs, reviewer pages and CFP steps render at **320 / 375 / 414 / 768 CSS px**. Admin disclosures are opened by keyboard and their expanded forms are checked too. The tests check offscreen controls, document overflow and wrapped button labels.
- `node scripts/run-checkin-browser.mjs tests/checkin-agents.spec.ts tests/checkin-label-profiles.spec.ts tests/checkin-labels.spec.ts tests/checkin-events.spec.ts`: **16 tests passed**. Updated exact-label locators retain the audit, immutable-version, simulated approval, keyboard, raster, event and uncertain-response retry assertions.
- Independent Standards and admin reviews found no high-confidence introduced regressions. The Spec review's remaining verbose CFP introduction was shortened and covered by retained assertions.
- Visual inspection of actual admin, mobile profile and final CFP screenshots found no clipped controls or overlapping content in the inspected areas. Shared decorative background/footer remain by scope.

## Evidence

Screenshots use synthetic test accounts/data, not production attendee information:

- `.scratch/signed-in-usability/admin-dashboard.png`
- `.scratch/signed-in-usability/profile-mobile.png`
- `.scratch/signed-in-usability/cfp-intro-mobile.png`

Detailed per-width screenshots are under `test-results/workspace-usability/`; check-in evidence is under `test-results/checkin/`. These output directories are replaced by subsequent test runs.

## Limits and existing issues

- **CFP cold entry:** existing page constructors call `isCfpOpen()` before the asynchronous conference configuration loads. After the fallback deadline, even a reopened disposable CFP can initially redirect to `/cfp/closed`. This is not introduced or fixed by the cleanup. CFP layout tests explicitly use a browser date inside the application window; they do not claim to fix late reopening.
- **External systems:** workspace tests disable external network access. Ticket-evidence unavailability in the profile screenshot is intentional fixture behavior. The live ticket catalogue, email delivery, and real printer hardware were not exercised.
- **Content states:** profile persistence and privacy controls are browser-tested; populated earned-badge/partner-consent states retain existing business tests and source-contract coverage, not a new complete browser acceptance suite for every consent scenario. Reviewer form mutation semantics and submission acceptance remain covered by existing service tests; the new CFP coverage is layout/structure, not end-to-end mail/submission delivery.
- Vite emits an existing open-handle/shutdown warning after successful unit tests; recorded commands exited successfully.
- Hallmark's in-place usability rules were applied within the locked system. Catalog rotation, portable token exports, shared public chrome and global reskin gates are outside this explicitly preserved-system scope. This is **not** a blanket “58/58” design-system certification.

The original implementation verification did not commit, deploy or update production data. Shipping is performed from the separate clean release worktree; the primary working checkout is intentionally not synchronized or reset.
