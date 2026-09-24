# Private feedback results

## Surface brief / direction contract

- Route: `/admin/feedback`, linked from Admin → Event operations → Feedback results.
- Mode: **Operate**. Preserve WTS's dark admin identity, Space Grotesk, existing OKLCH/Daisy tokens, `AdminPageShell` and `AdminDataPanel`. No global redesign.
- Task: read main-day ratings, answered denominators, requests for next year, and comments by question/session. Read-only; refresh and native comment disclosures, no exports or mutations.
- Composition: overview and distribution, category table, next-year counts, conference comments, session feedback. Mobile table wraps labels rather than introducing horizontal scrolling.
- Existing full desktop admin navigation overflows at 1280px. This route opts into the existing compact navigation drawer at every width; other routes keep their incumbent navigation. Browser verification covers Escape/focus return and keyboard comment disclosures.

## Data and authorization boundary

`POST /api/admin/feedback` accepts no selection input and always resolves the survey by the exact key `wts-2026-main-day-feedback`. It never aggregates different surveys or includes organizer tests by default. Missing live survey is an unavailable result, not an empty result.

Every request requires the existing same-origin policy and `server-auth-core.requireAdmin()` (including PocketBase auth refresh) **before** obtaining the privileged client. Reviewers, regular users/speakers, MCs, check-in operators and anonymous callers cannot read results. The page's existing client navigation guard is not the security boundary.

The server queries only `feedback_surveys` and `feedback_responses`. There is no invitation/contact join and no invented response rate. The adapter selects only the necessary fields, exhausts pagination, checks page sizes/totals, rejects duplicates, validates version/session membership and all persisted answers, and fails closed on incomplete/malformed reads. A final count check rejects collection-size changes during pagination. This is not a database transaction snapshot; simultaneous same-count privileged edits remain outside that check.

The browser DTO contains:

- Survey title and response count.
- Overall mean (null when unanswered), rating count and 1–5 distribution.
- Category score, numeric rating count, N/A count and skipped count. Means exclude N/A and skipped values.
- Counts for each “more next year” option.
- Independently shuffled comment strings per question and session, without respondent bundles.
- Session title and comments; score is **null** below five numeric ratings. No sub-threshold count, average or distribution is serialized. Comment counts do not satisfy the rating threshold.

No persistence IDs, timestamps, traversal order, source identities, emails, invitations, tokens or hashes are included as DTO metadata. Comments can contain identifying information volunteered by respondents; they remain organizer-private and the page warns to review them before sharing. Text is rendered as escaped JSX, never HTML.

## Browser privacy

Results load client-side only, after authorization; no results are serialized into the SSR document or browser persistent storage. Refresh/error states hide stale results. API errors contain only a generic state and discard raw SDK errors without logging them.

Page/API aliases receive private/no-store, no-referrer, noindex and restrictive existing operational CSP headers. Admin privacy is separate from public survey privacy: admin cookies are preserved, not stripped. `Document` excludes analytics/pixels on the route. The dashboard link enters a fresh document; a private-document marker also forces a reload for alternate SPA entries before results are fetched, preventing previously loaded marketing scripts from observing results.

## Local verification

No production configuration, credentials, responses, email or deployment is used. `scripts/run-feedback-browser.mjs --admin` builds an isolated app copy with an allowlisted environment, a disposable loopback PocketBase, real feedback migrations/hooks, synthetic users, and synthetic survey data. The server has a loopback-only egress guard. `--inspect` runs the browser suite and then keeps the preview alive. Disposable credentials/tokens are stored only in the runner's 0600 fixture JSON under its 0700 scratch directory and are never printed.

Commands:

```sh
pnpm install --frozen-lockfile
pnpm generate:icons
pnpm exec velite
pnpm pocketbase:download-test
pnpm test:feedback-admin
pnpm test:feedback-admin-browser
pnpm typecheck
pnpm check
TMPDIR="$(realpath "$TMPDIR")" pnpm test
# Keep the tested built preview running:
node --experimental-strip-types scripts/run-feedback-browser.mjs --admin --inspect
```

The canonical `TMPDIR` is necessary on hosts where `/home` resolves through `/var/home`: existing check-in lifecycle tests deliberately reject symlinked paths. The initial noncanonical full-suite run had 25 such failures; the unchanged tests passed with canonical scratch. Do not weaken their path safeguards.

Verification evidence is retained locally under `.impeccable/review/feedback-admin/` (ignored artifacts): final built-browser log, full-suite/typecheck logs, initial failure log and desktop/mobile screenshots. Two visual capture rounds only: the first exposed inherited desktop navbar overflow; the final round confirmed the route-scoped fix, native controls and no mobile/desktop overflow. The mechanical Impeccable detector returned exit 0 with no findings. Existing Vitest shutdown warnings remain (`close timed out after 10000ms`) despite passing suites.

## Final review

Independent spec/privacy review found no concrete defects. Independent standards and visual finish review returned **ship**, with no material fixes. It inspected desktop/mobile captures and compared the built surface with the incumbent shared shell, panels, typography and tokens. No design-system change was introduced; `DESIGN.md` remains untouched. Screenshots prove the synthetic ready-state layout, not live accessibility conformance or production-scale performance.

Parent verification independently reran the 38 focused tests, nine built-browser tests, full suite, typecheck, `pnpm check`, and `git diff --check`. The check caught a browser-test variable shadowing the DOM `document`; that was renamed, and new-component refetch method binding was made explicit. The final check and rebuilt browser suite passed. Existing unrelated lint warnings remain. No production access, commit, push or deployment was performed.

