# Data Model and Migration Needs Research

Date: 2026-07-08
Ticket: [Check Data Model and Migration Needs](../issues/06-check-data-model-and-migration-needs.md)

## Summary

The current PocketBase schema already supports the resolved Speaker edit policy. `speakers` has the canonical public fields admins need to edit: `slug`, `published`, `origin`, `display_name`, `user`, `cfp_applicant`, `photo`, `affiliation`, `bio`, `social_handles`, and existing `promo` JSON. No new Speaker override fields or file fields are needed.

The required schema gap is CFP-to-draft-Session provenance. Add an optional `sessions.cfp_submission` relation to `cfp_submissions` and enforce one promoted Session per CFP Submission with a partial unique index. Add a matching partial unique index on `speakers.cfp_applicant` to make the existing one-CFP-Applicant-to-one-CFP-origin-Speaker assumption race-safe during promotion.

The required API/DTO gap is consistency. Public pages and MCP programme data currently still fall back to CFP Applicant/User fields for CFP-origin Speakers. They must be changed to read public Speaker profile data from `speakers` only.

## Current Evidence

- `pocketbase/pb_migrations/1776000000_create_speakers_and_sessions.js:17` through `pocketbase/pb_migrations/1776000000_create_speakers_and_sessions.js:78` already define all public Speaker edit fields, including `photo` with JPEG/PNG/WebP and 5 MB limits.
- `pocketbase/pb_migrations/1777000002_speaker_promo_field.js:5` adds unrelated Speaker promo JSON; it does not affect the public profile source policy.
- `pocketbase/pb_migrations/1776000000_create_speakers_and_sessions.js:96` through `pocketbase/pb_migrations/1776000000_create_speakers_and_sessions.js:144` define Sessions without any CFP Submission provenance relation.
- `src/lib/pocketbase-types.ts:45` through `src/lib/pocketbase-types.ts:61` mirror current Speaker fields; `src/lib/pocketbase-types.ts:63` through `src/lib/pocketbase-types.ts:77` mirror current Session fields without provenance.
- `src/lib/admin-actions.ts:637` through `src/lib/admin-actions.ts:680` creates CFP-origin Speakers but only copies `display_name`; it does not copy affiliation, bio, social handles, or avatar/photo into the Speaker snapshot.
- `src/lib/admin-actions.ts:759` exposes generic Speaker update and `src/lib/admin-actions.ts:812` exposes generic Session update; neither is a safe allowlisted edit/promotion API.
- `src/lib/conference-public.ts:201` through `src/lib/conference-public.ts:259` uses CFP Applicant/User fallbacks for CFP-origin display data, image, bio, and social handles.
- `src/lib/mcp-program-data.ts:65` through `src/lib/mcp-program-data.ts:78` prefers Speaker fields but still falls back to CFP Applicant data.
- `PB_TYPES_GUIDE.md:29` through `PB_TYPES_GUIDE.md:76` confirms PocketBase type updates are manual in this repo.

## Minimal PocketBase Migration

Create one migration for the programme provenance constraints.

Add `sessions.cfp_submission`:

```js
const submissions = app.findCollectionByNameOrId("cfp_submissions");
const sessions = app.findCollectionByNameOrId("sessions");

sessions.fields.add(new Field({
  name: "cfp_submission",
  type: "relation",
  required: false,
  presentable: false,
  collectionId: submissions.id,
  maxSelect: 1,
  cascadeDelete: false,
}));

sessions.addIndex(
  "idx_sessions_cfp_submission_unique",
  true,
  "cfp_submission",
  "cfp_submission != ''",
);

app.save(sessions);
```

Add a Speaker uniqueness index in the same migration, after checking for existing duplicate CFP Applicant links:

```js
const speakers = app.findCollectionByNameOrId("speakers");
speakers.addIndex(
  "idx_speakers_cfp_applicant_unique",
  true,
  "cfp_applicant",
  "cfp_applicant != ''",
);
app.save(speakers);
```

The `sessions.cfp_submission` relation should not cascade delete. Deleting a CFP Submission must not delete a public programme Session. Use the relation for audit and duplicate prevention only.

The partial indexes are important because optional relation fields can be empty. A plain unique constraint on the column would risk treating empty manual Sessions or invited Speakers as duplicates.

The down migration should remove both indexes with `removeIndex(...)` and remove `sessions.cfp_submission` with `fields.removeByName("cfp_submission")` before saving the collections.

Do not add `cfp_submissions.promoted_session`. The Session-owned provenance relation is sufficient and avoids bidirectional consistency problems.

## Fields Not Needed

- No new Speaker profile fields: existing `speakers.display_name`, `speakers.affiliation`, `speakers.bio`, `speakers.social_handles`, and `speakers.photo` are the canonical public snapshot fields.
- No new Speaker image field: `speakers.photo` already supports replacement uploads. Promotion can copy a `users.avatar` file into this field when present.
- No public override fields: the resolved policy is not field-by-field override; public profile data lives directly on `speakers`.
- No Session file fields.
- No CFP Submission backlink field.
- No schema field for promotion status; promotion state is derived from the existence and `published` value of the provenance-linked Session.

## Manual Type Updates

Update `src/lib/pocketbase-types.ts` manually:

```ts
export interface SessionRecord extends RecordModel {
  id: string;
  slug: string;
  published: boolean;
  title: string;
  abstract: string;
  format?: string;
  starts_at?: string;
  track?: string;
  room?: string;
  speakers?: string[];
  cfp_submission?: string;
  created: string;
  updated: string;
}
```

No `SpeakerRecord` schema type change is required, but downstream UI/API types should become stricter:

- Add a `SpeakerProfileInput` or equivalent allowlisted input for admin Speaker edits.
- Reuse or rename `InviteSpeakerPhotoPayload` as a general Speaker photo payload for create/update.
- Add a `PromotedSessionSummary` shape for proposal rows, for example `{ id, slug, title, published }`.
- Add a promotion result shape for `adminPromoteSubmissionToDraftSession`, including the created/reused Speaker id and draft Session summary.
- Keep manual `SessionInput` free of public form access to `cfp_submission`; only the promotion action should set provenance.

## Admin API Change Set

Add a typed Speaker profile update action rather than expanding use of generic `adminUpdateSpeaker`:

- Validate admin authorization inside the server function.
- Allowlist `display_name`, `slug`, `affiliation`, `bio`, `social_handles`, and photo operations only.
- Require non-empty display name and slug, matching the resolved UX.
- Normalize `social_handles` to an array of non-empty strings.
- Enforce unique slug checks excluding the current Speaker record.
- Support photo replace and remove using `FormData` and the existing `speakers.photo` file field.
- Never update `cfp_applicants`, `users`, or `cfp_submissions` from this action.

Update the existing speaker-only creation path used from `/admin/speakers`:

- Keep `adminPublishFromApplicant` or rename it for clarity, but leave it as the Speakers admin escape hatch only.
- When creating a CFP-origin Speaker, copy the resolved public snapshot fields once: display name from User, affiliation/bio/social handles from CFP Applicant, and photo from User avatar into `speakers.photo` when a real avatar file exists.
- Keep `published: false`.
- Rely on the `idx_speakers_cfp_applicant_unique` index plus friendly duplicate handling.

Add a dedicated `adminPromoteSubmissionToDraftSession(submissionId)` action:

- Validate admin authorization inside the server function.
- Fetch the CFP Submission with `expand: "applicant.user"`.
- Reject unless `status === "accepted"`.
- Reject if there is no linked applicant.
- Check for an existing `sessions.cfp_submission = submissionId` before creating, and also handle the unique-index violation as the race-safe duplicate guard.
- Reuse the existing CFP-origin Speaker for the applicant, or create one using the same snapshot copy rules as above.
- Create exactly one unpublished Session with `title` from `cfp_submissions.session_title`, `abstract` from `cfp_submissions.abstract`, a unique slug generated from the title, `speakers: [speaker.id]`, empty `format`, `starts_at`, `track`, and `room`, and `cfp_submission: submissionId`.
- Do not copy `key_takeaways`, `technical_requirements`, `notes`, `meta`, review scores, review notes, or reviewer identities into the public Session.
- Return the draft Session summary so the UI can route to `/admin/sessions?edit={sessionId}`.

Update proposal leaderboard data:

- `adminFetchLeaderboardData` should include a `promotedSession` summary per CFP Submission, derived from Sessions keyed by `cfp_submission`.
- Accepted rows with no promoted Session are promotable.
- Rows with an unpublished promoted Session show draft-review state.
- Rows with a published promoted Session show published-session state.
- The old proposal-row `Publish speaker` action should stop being the primary proposal action; Speakers admin keeps the speaker-only escape hatch.

Harden Session update paths:

- Keep promotion provenance immutable through ordinary Session edit forms.
- Replace or wrap generic `adminUpdateSession(id, data)` with an allowlisted input for title, slug, abstract, format, starts_at, track, room, speakers, and published state.
- Do not expose `cfp_submission` in the public Session form payload.

## Public DTO Mapping Changes

Update `src/lib/conference-public.ts` so every public Speaker DTO reads public profile data from `speakers` only:

- `displayName`: `row.display_name` only, with a neutral fallback such as `"Speaker"` or slug for incomplete legacy drafts.
- `photoUrl`: `row.photo ? getPbFileUrl(row, row.photo) : null` or a local neutral placeholder; no User avatar fallback and no Gravatar fallback.
- `affiliation`: `row.affiliation || ""`.
- `bio`: `row.bio || ""`.
- `socialHandles`: `normalizeSocialHandles(row.social_handles)`.

The current `PublicSpeakerSummary.photoUrl` type is `string`. Because there is no existing local placeholder asset under `public/`, the clean minimal DTO change is to allow `photoUrl: string | null` and update `SpeakerAvatar`, speaker cards, session pages, and promo OpenGraph handling to render a local visual placeholder when null. Alternatively, add a neutral static placeholder asset and keep `photoUrl: string`.

Do not add `cfp_submission` or any CFP review/source fields to `PublicSessionCard`, `PublicSessionDetail`, `PublicSpeakerSummary`, `PublicSpeakerDetail`, or `PublicSpeakerPromo`.

After this change, public speaker fetches no longer need `expand: "cfp_applicant.user,user"` for rendering public profile fields. Session detail still needs expanded `speakers`, but not nested CFP/User expansion for public DTOs.

## MCP And Programme Data Mapping Changes

Update `src/lib/mcp-program-data.ts` to match the same public Speaker source policy:

- `speakerDto` should not fall back to CFP Applicant/User public profile fields for display name, affiliation, bio, or social handles.
- `display_name` should be `speaker.display_name` with slug as an operational fallback for incomplete draft data.
- `affiliation`, `bio`, and `social_handles` should come from `speaker` fields only.

For Sessions, include provenance for admin/MCP consumers but keep it out of public DTOs:

```ts
cfp_submission_id: session.cfp_submission || null,
```

This lets MCP programme consumers join promoted draft/published Sessions back to proposal data without inferring from title or Speaker. It does not require expanding the CFP Submission in the Session DTO.

No MCP proposal field needs to be copied into Session DTOs. Proposal contexts may continue to expose review/private fields to authorized MCP consumers, but public programme DTOs must not.

## Verification Targets For Implementation

- Run the PocketBase migration against a copy of current data and verify there are no duplicate non-empty `speakers.cfp_applicant` or `sessions.cfp_submission` values before adding unique indexes.
- Run `pnpm generate:pb-types` as a reminder, then manually update `src/lib/pocketbase-types.ts`.
- Add or update tests for MCP speaker mapping so CFP Applicant fallback no longer appears in programme Speaker DTOs.
- Add or update tests for MCP Session DTOs containing `cfp_submission_id` when present.
- Add server-action tests or extracted helper tests for promotion eligibility, duplicate prevention, private-field exclusion, and Speaker reuse.
- Run `pnpm test` and `pnpm build` after implementation.

## Residual Risk

The current `speakers` and `sessions` PocketBase collections have public list/view rules for published records. The public SolidStart pages are DTO-backed and should not expose `sessions.cfp_submission`, but a direct PocketBase API consumer may see raw non-hidden fields on published Session records. If direct PocketBase API output is treated as part of the public surface, make `sessions.cfp_submission` hidden or restrict direct collection rules and keep provenance access behind server/admin actions.
