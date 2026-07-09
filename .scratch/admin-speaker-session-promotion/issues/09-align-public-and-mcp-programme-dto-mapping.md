# Align Public and MCP Programme DTO Mapping

Status: closed
Labels: implementation, programme-admin
Parent: [Map: Admin Speaker Editing and CFP Session Promotion](../MAP.md)
Assignee: OpenCode
Blocked by: [Split Implementation Into Agent-Ready Work](07-split-implementation-into-agent-ready-work.md), [Add Programme Provenance Schema And Types](08-add-programme-provenance-schema-and-types.md)
Blocks: [Build Admin Speaker Edit UI](11-build-admin-speaker-edit-ui.md)

## What to build

Make public and MCP programme data agree with the resolved Speaker-owned source policy.

Update public Speaker mapping so public Speaker summaries, details, cards, Session pages, and promo metadata read public profile data from `speakers` only. CFP-origin Speakers must not fall back to CFP Applicant fields, User avatars, User names, or Gravatar. Handle missing `speakers.photo` with a neutral local placeholder rendering path or by allowing nullable photo URLs and updating consumers.

Update MCP programme data so Speaker DTOs also read display name, affiliation, bio, and social handles from `speakers` only. Session DTOs for authorized programme consumers should expose `cfp_submission_id` from `sessions.cfp_submission || null`; public DTOs must not expose CFP provenance or private CFP/review data.

## Acceptance criteria

- [x] Public Speaker `displayName`, `photoUrl`, `affiliation`, `bio`, and `socialHandles` come from the Speaker record only.
- [x] CFP-origin public Speakers do not use User avatar, Gravatar, CFP Applicant bio, CFP Applicant affiliation, or CFP Applicant social handles as fallbacks.
- [x] Missing Speaker photos render as a neutral placeholder without breaking Speaker cards, Speaker detail pages, Session pages, or OpenGraph/promo rendering.
- [x] Public Session DTOs do not include `cfp_submission`, `cfp_submission_id`, Key takeaways, technical requirements, notes, review data, or private CFP metadata.
- [x] MCP Speaker DTOs use Speaker-owned fields only.
- [x] MCP Session DTOs include `cfp_submission_id` for authorized programme consumers.
- [x] Existing published/unpublished filtering behavior remains unchanged.

## Verification

- [x] Add or update MCP programme data tests proving CFP Applicant/User fallback no longer appears in Speaker DTOs.
- [x] Add or update MCP Session DTO tests proving `cfp_submission_id` is present when set and `null` when absent.
- [x] Run `pnpm test`.
- [x] Run `pnpm build`.

## Decision references

- [Decide Speaker Profile Source Policy](02-decide-speaker-profile-source-policy.md)
- [Check Data Model and Migration Needs](06-check-data-model-and-migration-needs.md)
- [Data Model and Migration Needs Research](../assets/data-model-and-migration-needs-research.md)

## Comments

### Resolution Comment - 2026-07-08

Updated public Speaker mapping to use only `speakers` fields, with nullable `photoUrl` and a shared neutral avatar placeholder for missing `speakers.photo`. Removed public CFP/User expansion for Speaker rendering, kept public Session DTOs free of CFP provenance/private CFP fields, updated MCP Speaker DTOs to use Speaker-owned fields only, and added MCP Session `cfp_submission_id` from `sessions.cfp_submission || null`.

Verification: added MCP tests for removed CFP Applicant/User Speaker fallbacks and Session `cfp_submission_id` set/null behavior. `pnpm test` passed, `pnpm build` passed, and `git diff --check -- src .scratch/admin-speaker-session-promotion/issues/09-align-public-and-mcp-programme-dto-mapping.md` passed.
