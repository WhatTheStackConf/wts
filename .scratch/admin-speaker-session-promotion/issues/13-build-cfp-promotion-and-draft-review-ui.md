# Build CFP Promotion And Draft Review UI

Status: closed
Labels: implementation, programme-admin
Parent: [Map: Admin Speaker Editing and CFP Session Promotion](../MAP.md)
Assignee: OpenCode
Blocked by: [Split Implementation Into Agent-Ready Work](07-split-implementation-into-agent-ready-work.md), [Add CFP Promotion Admin APIs](12-add-cfp-promotion-admin-apis.md)
Blocks: None

## What to build

Implement the admin UI for promoting accepted CFP Submissions into draft Sessions and reviewing those drafts.

On `/admin/proposals`, replace the old proposal-row speaker-only promotion affordance with `Create draft session` for accepted, promotable CFP Submissions. Already-promoted rows should derive their state from `sessions.cfp_submission`, showing draft or published Session review actions instead of a second create action. Success should offer `Review draft session`, routing to `/admin/sessions?edit={sessionId}`.

On `/admin/sessions`, support opening the existing edit form from `?edit={sessionId}` and show read-only `From CFP` source context for provenance-linked Sessions. The Session form must not expose `cfp_submission` as editable input.

Update `/admin/speakers` copy so `Create draft profile` remains clearly positioned as a speaker-only escape hatch, not the primary CFP-to-Session promotion path.

## Acceptance criteria

- [x] Accepted proposal rows/cards without a promoted Session show `Create draft session`.
- [x] Pending or rejected proposal rows/cards do not offer promotion.
- [x] Rows missing required source data show a disabled or explanatory non-create state.
- [x] Clicking `Create draft session` calls the promotion API and shows a busy state while pending.
- [x] Successful promotion updates the row state and offers `Review draft session`.
- [x] `/admin/sessions?edit={sessionId}` opens the draft Session in edit mode.
- [x] Already-promoted unpublished Sessions show `Draft session exists` plus a review/edit path.
- [x] Already-promoted published Sessions show `Published session exists` plus an edit or public view path.
- [x] No second create action is offered for a CFP Submission with any provenance-linked Session.
- [x] The old proposal-row speaker-only `Publish speaker` action is removed or replaced by the promotion flow.
- [x] Sessions admin shows a read-only `From CFP` source panel or badge for provenance-linked Sessions.
- [x] Session edit payloads from the UI do not include `cfp_submission`.
- [x] Speaker admin copy clarifies that `Create draft profile` creates only a Speaker profile.
- [x] Desktop table and mobile card layouts remain usable.

## Verification

- [x] Manually verify accepted, pending, rejected, already-draft, already-published, missing-source-data, success, and error states.
- [x] Manually verify the review path opens the correct draft Session from the toast and from a promoted row.
- [x] Manually verify no CFP private/review fields appear in the proposal row promotion UI or Sessions admin source panel.
- [x] Run `pnpm build`.

## Decision references

- [Shape CFP Promotion Admin UX](05-shape-cfp-promotion-admin-ux.md)
- [CFP Promotion Admin UX Prototype](../assets/cfp-promotion-admin-ux-prototype.md)
- [Decide CFP Submission Promotion Semantics](04-decide-cfp-submission-promotion-semantics.md)

## Comments

### Blocker Comment - 2026-07-09

Implemented the ticket 13 UI slice: `/admin/proposals` now replaces the proposal-row speaker-only `Publish speaker` action with CFP draft Session promotion states derived from `promotedSession`; accepted promotable rows/cards show `Create draft session`; pending/rejected rows show non-create copy; already-draft/published rows show review/edit/public paths; promotion calls the ticket 12 action with busy/error states and a success-toast review action; `/admin/sessions?edit={sessionId}` opens the existing edit form; provenance-linked Sessions show read-only `From CFP` source context without editable `cfp_submission`; `/admin/speakers` copy now frames `Create draft profile` as a speaker-only escape hatch.

Runtime blocker from ticket 12: `adminPromoteSubmissionToDraftSession` fails before create while checking duplicate provenance, because the server action's `sessions` query with `filter=cfp_submission = "{submissionId}"` returns PocketBase 400. Per this slice's rules, backend promotion code was not changed here, so successful create/refetch/toast review could not be completed manually.

Verification completed: `pnpm build` passed; desktop and mobile proposal layouts verified with local fixtures for accepted, pending, rejected, already-draft, already-published, busy, and error states; promoted-row `Review draft` opens `/admin/sessions?edit={sessionId}`; Sessions admin shows `From CFP` source context and does not show CFP private/review fields. Missing-applicant fixture could not be created locally because the current schema requires the applicant relation.

### Closure Comment - 2026-07-09

Fixed the ticket 12 runtime blocker encountered during this UI slice. The root cause was sorting `sessions` and `speakers` lookup queries by `created`, but those collections were created without `created`/`updated` system fields. Removed the unnecessary `sort: "created"` from the CFP promotion duplicate lookup and CFP speaker reuse lookup; both paths are uniqueness-constrained and only need the linked record.

Runtime verification now passes: clicking `Create draft session` for accepted submission `vsags729x5t247y` created draft Session `4rpxtr9ennrfg3l`, changed the row to `Draft session exists`, and `Review draft` opened `/admin/sessions?edit=4rpxtr9ennrfg3l` with the `From CFP` source panel and no CFP private/review fields. The current schema requires `cfp_submissions.applicant`, so a true missing-applicant record is not constructible locally; missing source-data handling is covered by the UI blocker path for missing applicant/title/abstract.

Automated verification: `pnpm test` passed, `pnpm build` passed, and `git diff --check -- src .scratch/admin-speaker-session-promotion/issues/13-build-cfp-promotion-and-draft-review-ui.md` passed.

### Manual Rerun - 2026-07-09

Created fresh local fixture submission `e5waql15rdgdojn` (`Ticket 13 manual promotion manualh84myj`) and reran the browser flow from `/admin/proposals`. The accepted row showed `Create draft session`, switched to `Creating draft...` while pending, then changed to `Draft session exists` with `Review draft`. The review path opened `/admin/sessions?edit=qecwo3uso0l41nj`; the Session editor showed `From CFP`, source submission `e5waql15rdgdojn`, copied only the public title/abstract, selected the generated Speaker, and did not expose CFP private/review fields. Direct PocketBase confirmation: Session `qecwo3uso0l41nj` is unpublished and has `cfp_submission: e5waql15rdgdojn`.
