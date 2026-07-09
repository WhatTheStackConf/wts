# Add Programme Provenance Schema And Types

Status: closed
Labels: implementation, programme-admin
Parent: [Map: Admin Speaker Editing and CFP Session Promotion](../MAP.md)
Assignee: OpenCode
Blocked by: [Split Implementation Into Agent-Ready Work](07-split-implementation-into-agent-ready-work.md)
Blocks: [Align Public and MCP Programme DTO Mapping](09-align-public-and-mcp-programme-dto-mapping.md), [Add Speaker Profile Admin APIs](10-add-speaker-profile-admin-apis.md), [Add CFP Promotion Admin APIs](12-add-cfp-promotion-admin-apis.md)

## What to build

Add the minimal PocketBase schema and TypeScript type support needed for CFP Submission to draft Session promotion provenance.

Create a PocketBase migration that adds optional `sessions.cfp_submission` as a relation to `cfp_submissions`, with no cascade delete, and a partial unique index so each non-empty CFP Submission can be linked to at most one Session. In the same migration, add a partial unique index on non-empty `speakers.cfp_applicant` so CFP-origin Speaker reuse/create is race-safe.

Update `src/lib/pocketbase-types.ts` manually so `SessionRecord` includes optional `cfp_submission?: string`.

## Acceptance criteria

- [x] A migration adds `sessions.cfp_submission` as an optional relation to `cfp_submissions`.
- [x] A partial unique index enforces one promoted Session per non-empty `cfp_submission`.
- [x] A partial unique index enforces one CFP-origin Speaker per non-empty `cfp_applicant`.
- [x] The down migration removes both indexes and removes `sessions.cfp_submission`.
- [x] No `cfp_submissions.promoted_session` field is added.
- [x] No new Speaker override/profile/image fields are added.
- [x] `SessionRecord` includes `cfp_submission?: string`.
- [x] Existing manual Sessions and invited Speakers with empty relation fields can still coexist.

## Verification

- [x] Check current data for duplicate non-empty `speakers.cfp_applicant` values before relying on the unique index.
- [x] Apply and revert the PocketBase migration locally or against a disposable data copy.
- [x] Run `pnpm build` after the manual type update.

## Decision references

- [Check Data Model and Migration Needs](06-check-data-model-and-migration-needs.md)
- [Data Model and Migration Needs Research](../assets/data-model-and-migration-needs-research.md)

## Comments

### Resolution Comment - 2026-07-08

Added `pocketbase/pb_migrations/1784000000_add_programme_provenance.js` with optional non-cascading `sessions.cfp_submission`, partial unique indexes for non-empty `sessions.cfp_submission` and `speakers.cfp_applicant`, and a down migration that removes both indexes and the Session provenance field. Updated `SessionRecord` with `cfp_submission?: string` only.

Verification: inspected existing migration/type conventions; found no duplicate non-empty `speakers.cfp_applicant` values in local data; applied and reverted the migration against a disposable `pb_data` copy; `pnpm build` passed; `git diff --check -- pocketbase src/lib/pocketbase-types.ts .scratch/admin-speaker-session-promotion/issues/08-add-programme-provenance-schema-and-types.md` passed.
