# Programme Admin Seams Research

Date: 2026-07-08
Ticket: [Inventory Existing Programme Admin Seams](../issues/01-inventory-existing-programme-admin-seams.md)

## Summary

The existing programme admin code already has draft/publish primitives for public **Speakers** and **Sessions**, plus accepted-CFP-to-draft-**Speaker** creation. It does not yet have a full **Speaker** edit flow, file upload support for updating Speaker photos, or any **CFP Submission** to draft **Session** promotion/provenance seam.

The highest-risk discovery is a source-of-truth mismatch: public pages treat CFP-origin **Speaker** profile fields as live reads from **CFP Applicant** and **User**, while MCP programme data already prefers **Speaker** fields over **CFP Applicant** fields. The next policy ticket must resolve that before implementation.

## Existing Admin Surfaces

- `src/routes/admin/speakers.tsx:5` loads `AdminSpeakersHub` client-only behind `useRequireAdmin`.
- `src/components/admin/AdminSpeakersHub.tsx:73` fetches all Speakers through `adminFetchSpeakers`.
- `src/components/admin/AdminSpeakersHub.tsx:83` fetches accepted CFP applicants without a Speaker profile through `adminFetchAcceptedApplicantsWithoutSpeaker`.
- `src/components/admin/AdminSpeakersHub.tsx:107` toggles `speakers.published` through `adminSetSpeakerPublished`.
- `src/components/admin/AdminSpeakersHub.tsx:124` creates a draft CFP-origin Speaker through `adminPublishFromApplicant`.
- `src/components/admin/AdminSpeakersHub.tsx:144` through `src/components/admin/AdminSpeakersHub.tsx:212` contains invite-Speaker form state, client-side photo serialization, and create behavior.
- `src/components/admin/AdminSpeakersHub.tsx:214` renders Speaker rows with visibility and preview actions only. There is no edit action for existing Speakers.
- `src/components/admin/AdminSpeakersHub.tsx:473` renders the invite photo upload field. File validation is only wired for invite creation.
- `src/routes/admin/sessions.tsx:5` loads `AdminSessionsHub` client-only behind `useRequireAdmin`.
- `src/components/admin/AdminSessionsHub.tsx:55` fetches public Sessions through `adminFetchSessions`.
- `src/components/admin/AdminSessionsHub.tsx:65` through `src/components/admin/AdminSessionsHub.tsx:73` stores editable Session form state.
- `src/components/admin/AdminSessionsHub.tsx:101` loads an existing Session into the generic edit form.
- `src/components/admin/AdminSessionsHub.tsx:124` submits either `adminUpdateSession` or `adminCreateSession`.
- `src/components/admin/AdminSessionsHub.tsx:156` toggles `sessions.published` through `adminSetSessionPublished`.
- `src/components/admin/AdminSessionsHub.tsx:353` through `src/components/admin/AdminSessionsHub.tsx:397` links Sessions to existing Speakers.
- `src/routes/admin/proposals.tsx:5` loads `AdminProposalsTable` client-only behind `useRequireAdmin`.
- `src/components/admin/AdminProposalsTable.tsx:44` fetches proposal leaderboard data through `adminFetchLeaderboardData`.
- `src/components/admin/AdminProposalsTable.tsx:94` tracks applicants that already have a Speaker via `adminFetchSpeakers` and a `cfp_applicant` Set.
- `src/components/admin/AdminProposalsTable.tsx:107` creates a draft Speaker for an accepted proposal's applicant through `adminPublishFromApplicant`.
- `src/components/admin/AdminProposalsTable.tsx:116` and `src/components/admin/AdminProposalsTable.tsx:202` update individual and bulk CFP Submission statuses.
- `src/components/admin/AdminProposalsTable.tsx:464` and `src/components/admin/AdminProposalsTable.tsx:599` show the existing `Publish speaker` action only when the proposal is accepted and the applicant has no Speaker.
- `src/components/admin/AdminProposalsTable.tsx:474` and `src/components/admin/AdminProposalsTable.tsx:610` link to reviewer detail, not to a public draft Session review flow.
- `src/routes/admin/index.tsx:119` and `src/routes/admin/index.tsx:137` already expose dashboard cards for Speakers and Sessions.

## Existing Server Actions

- `src/lib/admin-actions.ts:277` fetches all CFP Submissions, all reviews, and all weight votes for the admin leaderboard. It expands `applicant.user` and does not filter to accepted only.
- `src/lib/admin-actions.ts:437` and `src/lib/admin-actions.ts:451` update CFP Submission status after validating against `pending`, `accepted`, and `rejected`.
- `src/lib/admin-actions.ts:605` fetches Speakers with `expand: "cfp_applicant.user,user"`.
- `src/lib/admin-actions.ts:621` fetches Sessions with `expand: "speakers"`.
- `src/lib/admin-actions.ts:638` is named `adminPublishFromApplicant`, but it actually creates or returns an unpublished CFP-origin Speaker. It returns existing Speaker records instead of creating duplicates for the same CFP Applicant.
- `src/lib/admin-actions.ts:671` creates CFP-origin Speaker records with `slug`, `published: false`, `origin: "cfp"`, `cfp_applicant`, `user`, and `display_name`. It does not copy applicant bio, affiliation, social handles, or any photo field onto the Speaker record.
- `src/lib/admin-actions.ts:706` creates invited Speakers, validates photo payloads, writes `origin: "invite"`, and stores `affiliation`, `bio`, `social_handles`, and optional `photo` on the Speaker record.
- `src/lib/admin-actions.ts:759` exposes a generic `adminUpdateSpeaker(id, data)` action with no typed validation and no file/FormData path. It is currently only used indirectly for published toggles.
- `src/lib/admin-actions.ts:772` toggles Speaker publication through generic Speaker update.
- `src/lib/admin-actions.ts:789` creates generic draft Sessions. It slugifies `input.slug || input.title`, copies core fields, links provided Speakers, and defaults `published` to false.
- `src/lib/admin-actions.ts:812` exposes a generic `adminUpdateSession(id, data)` action with no typed validation.
- `src/lib/admin-actions.ts:825` toggles Session publication through generic Session update.
- `src/lib/admin-actions.ts:830` fetches accepted CFP Submissions for the accepted-applicant panel.
- `src/lib/admin-actions.ts:859` returns accepted applicants without Speakers, grouped by applicant. If an applicant has multiple accepted CFP Submissions, only the first submission title is surfaced.
- `src/lib/pocketbase-admin-service.ts:84` and `src/lib/pocketbase-admin-service.ts:99` support arbitrary create/update payloads, including `FormData`, through the admin PocketBase client.

## PocketBase Schema Seams

- `pocketbase/pb_migrations/1735401500_create_cfp_applicants.js:16` through `pocketbase/pb_migrations/1735401500_create_cfp_applicants.js:37` created CFP Applicant `affiliation`, `bio`, `social_handles`, and `user` fields.
- `pocketbase/pb_migrations/1767014404_updated_cfp_applicants.js:6` added `preferred_contact_method`.
- `pocketbase/pb_migrations/1767103015_updated_cfp_applicants.js:6` added `previous_talks`.
- `pocketbase/pb_migrations/1774942493_updated_cfp_applicants.js:5` made `affiliation` optional to match form UX.
- `pocketbase/pb_migrations/1735401600_create_cfp_submissions.js:17` through `pocketbase/pb_migrations/1735401600_create_cfp_submissions.js:47` created CFP Submission `session_title`, `abstract`, `key_takeaways`, `technical_requirements`, `notes`, and `applicant` fields.
- `pocketbase/pb_migrations/1767102990_updated_cfp_submissions.js:6` added CFP Submission `meta` JSON.
- `pocketbase/pb_migrations/1776000002_add_cfp_submissions_status.js:12` added CFP Submission `status` with `pending`, `accepted`, and `rejected`.
- `pocketbase/pb_migrations/1776000000_create_speakers_and_sessions.js:17` through `pocketbase/pb_migrations/1776000000_create_speakers_and_sessions.js:75` created Speaker `slug`, `published`, `origin`, `display_name`, `user`, `cfp_applicant`, `photo`, `affiliation`, `bio`, and `social_handles` fields.
- `pocketbase/pb_migrations/1777000002_speaker_promo_field.js:5` added Speaker `promo` JSON.
- `pocketbase/pb_migrations/1776000000_create_speakers_and_sessions.js:96` through `pocketbase/pb_migrations/1776000000_create_speakers_and_sessions.js:138` created Session `slug`, `published`, `title`, `abstract`, `format`, `starts_at`, `track`, `room`, and `speakers` fields.
- There is no Session relation back to CFP Submission, no CFP Submission relation to promoted Session, and no provenance/duplicate-prevention field for promotion.
- `src/lib/pocketbase-types.ts:45` through `src/lib/pocketbase-types.ts:61` mirrors the current Speaker fields.
- `src/lib/pocketbase-types.ts:63` through `src/lib/pocketbase-types.ts:77` mirrors the current Session fields without any CFP provenance.

## Public Mapping Seams

- `src/lib/conference-public.ts:201` maps public Speaker summaries.
- `src/lib/conference-public.ts:205` through `src/lib/conference-public.ts:216` treats CFP-origin Speakers as a hybrid: display name from `speakers.display_name` or User name, photo from `users.avatar` or Gravatar, and affiliation from CFP Applicant.
- `src/lib/conference-public.ts:219` through `src/lib/conference-public.ts:232` treats invited Speakers as Speaker-owned: display name, `speakers.photo`, affiliation, and User/Gravatar fallback.
- `src/lib/conference-public.ts:243` through `src/lib/conference-public.ts:249` maps CFP-origin Speaker detail bio and social handles from CFP Applicant only.
- `src/lib/conference-public.ts:253` through `src/lib/conference-public.ts:258` maps invited Speaker detail bio and social handles from Speaker fields.
- `src/lib/conference-public.ts:286` and `src/lib/conference-public.ts:295` fetch only `published = true` Speakers and Sessions for public pages.
- `src/lib/conference-public.ts:407` through `src/lib/conference-public.ts:435` maps public Session detail directly from Session fields and expanded Speakers. It does not reference CFP Submissions.
- `src/routes/speakers/[slug]/index.tsx:71` renders sanitized Speaker bio HTML.
- `src/routes/sessions/[slug].tsx:100` renders sanitized Session abstract HTML.
- `src/routes/speakers/index.tsx:7` and `src/routes/sessions/index.tsx:10` load public server functions only; unpublished records stay hidden.

## MCP Programme Data Seams

- `src/lib/mcp-program-data.ts:65` through `src/lib/mcp-program-data.ts:78` maps Speakers for MCP consumers and already prefers Speaker fields before CFP Applicant fields for affiliation, bio, and social handles.
- `src/lib/mcp-program-data.ts:81` through `src/lib/mcp-program-data.ts:96` maps Sessions and expanded Speakers.
- `src/lib/mcp-program-data.ts:121` through `src/lib/mcp-program-data.ts:149` exposes proposal data including `key_takeaways`, `technical_requirements`, and `notes` to MCP proposal contexts.
- `src/lib/mcp-program-data.ts:161` through `src/lib/mcp-program-data.ts:176` fetches all Sessions and Speakers, not only published records.
- `src/lib/mcp-program-data.ts:179` allows proposal filtering by status but defaults to all proposals.

## Tests And Verification Seams

- `package.json:7` defines `pnpm build` as `velite && vite build`.
- `package.json:8` defines `pnpm test` as only `vitest run src/lib/mcp-token-utils.test.ts src/lib/mcp-program-data.test.ts`.
- `src/lib/mcp-program-data.test.ts:54` verifies MCP proposal listing includes all statuses by default.
- `src/lib/mcp-program-data.test.ts:80` verifies MCP proposal context works for rejected proposals.
- There are no current tests for `adminPublishFromApplicant`, `adminCreateInviteSpeaker`, `adminUpdateSpeaker`, `adminCreateSession`, `adminUpdateSession`, `AdminSpeakersHub`, `AdminSessionsHub`, or `AdminProposalsTable`.

## Current Hazards For Later Decisions

- The **Speaker Profile Source Policy** must reconcile public mapping and MCP mapping before implementation. Public pages ignore Speaker-owned `bio`, `affiliation`, `social_handles`, and `photo` for CFP-origin records, but MCP data already treats those Speaker fields as overrides.
- Updating CFP-origin profile images is especially unclear. Public CFP-origin photos use `users.avatar` or Gravatar, while the app's user profile UI currently edits User name and displays Gravatar. There is no obvious admin upload path for `users.avatar`.
- The existing `adminUpdateSpeaker` action is too generic for a safe admin edit form. It lacks input validation, field allowlisting, social handle normalization, slug collision handling, and file upload/update support.
- The existing invite photo serialization can be reused conceptually, but `buildSpeakerCreateBody` is create-oriented. Updating or removing photos will need a deliberate server action design.
- The existing Session create path has no `uniqueSessionSlug` helper. Duplicate slugs rely on PocketBase uniqueness errors instead of a user-friendly promotion flow.
- The existing accepted-applicant helper is applicant-centric, not submission-centric. A CFP-to-Session promotion flow must operate per **CFP Submission**, because one **CFP Applicant** can have multiple accepted submissions.
- There is no persisted link between CFP Submissions and Sessions. Without a provenance relation, duplicate promotion prevention would need to infer by title/applicant/speaker, which is brittle.
- Promotion must explicitly exclude **Key takeaways**, `technical_requirements`, `notes`, reviewer data, and private `meta` values unless a later decision intentionally maps a public-safe field.
- Any source policy or provenance schema change will require updating `src/lib/pocketbase-types.ts` manually because `package.json:16` defines `generate:pb-types` as a manual reminder.

## Likely Implementation Seams After Decisions

- Add a typed Speaker edit server action instead of expanding generic `adminUpdateSpeaker` usage.
- Add update-time file payload handling for Speaker photo or User avatar, depending on source policy.
- Add an edit entry point and form state to `AdminSpeakersHub` or extract a Speaker form component shared with invite creation.
- Add a typed CFP Submission promotion server action that fetches the submission, validates accepted status, ensures/creates the Speaker, creates a draft Session, and returns the draft Session for review.
- Add provenance or duplicate-prevention fields if the data-model ticket chooses persisted linkage.
- Update public mapping and MCP mapping together so both agree on public Speaker field precedence.
- Add tests around pure mapping helpers or extracted server-action helper logic where feasible, because current tests do not cover admin actions or UI components.
