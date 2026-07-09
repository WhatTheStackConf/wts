# Shape Speaker Edit UX

Status: closed
Labels: wayfinder:prototype
Parent: [Map: Admin Speaker Editing and CFP Session Promotion](../MAP.md)
Assignee: OpenCode
Blocked by: [Decide Speaker Profile Source Policy](02-decide-speaker-profile-source-policy.md)
Blocks: [Check Data Model and Migration Needs](06-check-data-model-and-migration-needs.md)

## Question

What should the admin Speaker editing experience look like once the source policy is known?

Produce a low-fidelity prototype or concrete UI outline for the Speakers admin page covering edit entry points, origin/source cues, profile image preview/upload/removal, validation, save/cancel behavior, publication controls, and mobile/desktop layout expectations. Link the prototype asset in the resolution comment.

## Resolution

Resolved in the resolution comment below.

## Comments

### Resolution Comment - 2026-07-08

Prototype asset: [Speaker Edit UX Prototype](../assets/speaker-edit-ux-prototype.md)

Decision: Speaker editing lives inline on `/admin/speakers`, above the list, using one shared public-profile form for CFP-origin and invited Speakers. Rows/cards get `Edit`; publishing remains the existing list/card toggle; saving profile content never publishes automatically.

The form edits `display_name`, `slug`, `affiliation`, `bio`, `social_handles`, and `photo`; shows origin/source as read-only context; previews current photo; supports replacement and removal; requires only name and slug; and uses a two-column desktop layout that stacks on mobile.
