# Add CFP Promotion Admin APIs

Status: closed
Labels: implementation, programme-admin
Parent: [Map: Admin Speaker Editing and CFP Session Promotion](../MAP.md)
Assignee: OpenCode
Blocked by: [Split Implementation Into Agent-Ready Work](07-split-implementation-into-agent-ready-work.md), [Add Programme Provenance Schema And Types](08-add-programme-provenance-schema-and-types.md), [Add Speaker Profile Admin APIs](10-add-speaker-profile-admin-apis.md)
Blocks: [Build CFP Promotion And Draft Review UI](13-build-cfp-promotion-and-draft-review-ui.md)

## What to build

Add typed admin APIs for promoting one accepted CFP Submission into one unpublished draft Session linked to the correct Speaker.

Implement `adminPromoteSubmissionToDraftSession` or an equivalent server action that validates admin authorization, fetches the CFP Submission with its applicant and user, enforces accepted-only eligibility, rejects missing applicants, guards duplicate promotion by `sessions.cfp_submission`, reuses or creates the CFP-origin Speaker through the shared Speaker snapshot helper, creates one unpublished Session, and returns enough draft Session summary data for the UI to review it.

Update admin programme fetch/update APIs so proposal rows can show promoted Session state and Session edits cannot mutate provenance through ordinary forms.

## Acceptance criteria

- [x] Promotion is allowed only for CFP Submissions with `status = accepted` and a linked CFP Applicant.
- [x] Each CFP Submission can create at most one Session, guarded by a pre-check and the `sessions.cfp_submission` unique index.
- [x] Promotion reuses an existing CFP-origin Speaker for the applicant or creates one unpublished Speaker using the resolved snapshot-copy rules.
- [x] The created Session is unpublished and linked to the Speaker.
- [x] The created Session copies only `cfp_submissions.session_title` to `sessions.title` and `cfp_submissions.abstract` to `sessions.abstract`.
- [x] The created Session gets a unique draft slug from the title.
- [x] `format`, `starts_at`, `track`, and `room` are left empty for admin review.
- [x] `sessions.cfp_submission` is set to the source CFP Submission id.
- [x] Key takeaways, technical requirements, notes, private metadata, review scores, review notes, and reviewer identities are never copied into Session or Speaker public fields.
- [x] `adminFetchLeaderboardData` or an equivalent admin fetch includes `promotedSession` per CFP Submission, derived from `sessions.cfp_submission`.
- [x] Ordinary Session edit/update input cannot set or change `cfp_submission`.

## Verification

- [x] Add focused tests or extracted-helper tests for accepted-only eligibility, missing-applicant errors, duplicate prevention, Speaker reuse, private-field exclusion, and unique slug behavior where feasible.
- [x] Add or update tests for promoted Session summary data in leaderboard results where feasible.
- [x] Run `pnpm test`.
- [x] Run `pnpm build`.

## Decision references

- [Decide CFP Submission Promotion Semantics](04-decide-cfp-submission-promotion-semantics.md)
- [Shape CFP Promotion Admin UX](05-shape-cfp-promotion-admin-ux.md)
- [Check Data Model and Migration Needs](06-check-data-model-and-migration-needs.md)
- [CFP Promotion Admin UX Prototype](../assets/cfp-promotion-admin-ux-prototype.md)
- [Data Model and Migration Needs Research](../assets/data-model-and-migration-needs-research.md)

## Comments

### Resolution Comment - 2026-07-09

Added `adminPromoteSubmissionToDraftSession` backed by a tested promotion helper. The action requires admin authorization, fetches CFP Submissions with `expand: "applicant.user"`, enforces accepted-only plus linked-applicant eligibility, guards duplicate Sessions by `sessions.cfp_submission` before create and after unique-index races, reuses or creates the CFP-origin Speaker through the ticket 10 snapshot helper, and creates one unpublished draft Session linked to that Speaker with only title, abstract, generated slug, empty review fields, and CFP provenance.

Updated leaderboard data to include `promotedSession` per submission from `sessions.cfp_submission`, and changed ordinary Session create/update writes to an allowlist that does not accept `cfp_submission`.

Verification: `pnpm test` passed; `pnpm build` passed; `git diff --check -- src .scratch/admin-speaker-session-promotion/issues/12-add-cfp-promotion-admin-apis.md` passed.
