# Add Speaker Profile Admin APIs

Status: closed
Labels: implementation, programme-admin
Parent: [Map: Admin Speaker Editing and CFP Session Promotion](../MAP.md)
Assignee: OpenCode
Blocked by: [Split Implementation Into Agent-Ready Work](07-split-implementation-into-agent-ready-work.md), [Add Programme Provenance Schema And Types](08-add-programme-provenance-schema-and-types.md)
Blocks: [Build Admin Speaker Edit UI](11-build-admin-speaker-edit-ui.md), [Add CFP Promotion Admin APIs](12-add-cfp-promotion-admin-apis.md)

## What to build

Add safe, typed admin-side Speaker profile APIs for editing public Speaker snapshots and for creating/reusing CFP-origin Speaker snapshots.

Implement a typed Speaker profile update server action that validates admin authorization inside the server function, allowlists only public Speaker profile fields, supports photo replacement/removal through `speakers.photo`, and never mutates CFP Applicant, User, or CFP Submission records.

Update the existing speaker-only CFP Applicant to draft Speaker path used by `/admin/speakers` so it copies the resolved public snapshot fields once: display name from the linked User, affiliation/bio/social handles from the CFP Applicant, and a real User avatar file into `speakers.photo` when present. Keep created Speakers unpublished. Share this create/reuse logic with the later CFP promotion API.

## Acceptance criteria

- [x] A typed admin Speaker profile update action accepts only `display_name`, `slug`, `affiliation`, `bio`, `social_handles`, and explicit photo replace/remove operations.
- [x] The update action requires non-empty display name and slug.
- [x] Slug validation rejects invalid or duplicate slugs with an actionable error, excluding the Speaker currently being edited.
- [x] Social handles are normalized to non-empty values.
- [x] Photo replacement accepts JPEG, PNG, or WebP up to the existing 5 MB limit.
- [x] Photo removal clears `speakers.photo` without affecting User avatar or CFP Applicant data.
- [x] The action never writes to `cfp_applicants`, `users`, or `cfp_submissions`.
- [x] CFP-origin draft Speaker creation/reuse copies the resolved snapshot fields once and keeps `published: false`.
- [x] Duplicate CFP Applicant Speaker creation is handled through lookup plus friendly handling of the unique-index race.

## Verification

- [x] Add focused tests or extracted-helper tests for validation, slug collision handling, social normalization, photo remove intent, and CFP-origin Speaker reuse/create behavior where feasible.
- [x] Run `pnpm test`.
- [x] Run `pnpm build`.

## Decision references

- [Decide Speaker Profile Source Policy](02-decide-speaker-profile-source-policy.md)
- [Shape Speaker Edit UX](03-shape-speaker-edit-ux.md)
- [Check Data Model and Migration Needs](06-check-data-model-and-migration-needs.md)
- [Speaker Edit UX Prototype](../assets/speaker-edit-ux-prototype.md)
- [Data Model and Migration Needs Research](../assets/data-model-and-migration-needs-research.md)

## Comments

### Resolution Comment - 2026-07-09

Added `adminUpdateSpeakerProfile` with admin authorization, allowlisted Speaker-only profile fields, required display name/slug validation, slug format and duplicate checks excluding the current Speaker, normalized non-empty social handles, JPEG/PNG/WebP photo replacement up to 5 MB, and explicit `speakers.photo` removal via `photo: null`.

Extracted reusable Speaker profile helpers in `src/lib/admin-speaker-profile.ts` and updated the existing CFP Applicant to draft Speaker path to reuse/create by `cfp_applicant`, copy User display name plus CFP Applicant affiliation/bio/social handles once, best-effort copy a real User avatar into `speakers.photo`, keep `published: false`, and recover friendly from the unique-index race by returning the raced Speaker.

Verification: `pnpm test` passed; `pnpm build` passed; `git diff --check -- src .scratch/admin-speaker-session-promotion/issues/10-add-speaker-profile-admin-apis.md` passed.
