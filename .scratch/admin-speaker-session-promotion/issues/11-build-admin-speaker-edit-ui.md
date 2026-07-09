# Build Admin Speaker Edit UI

Status: closed
Labels: implementation, programme-admin
Parent: [Map: Admin Speaker Editing and CFP Session Promotion](../MAP.md)
Assignee: OpenCode
Blocked by: [Split Implementation Into Agent-Ready Work](07-split-implementation-into-agent-ready-work.md), [Align Public and MCP Programme DTO Mapping](09-align-public-and-mcp-programme-dto-mapping.md), [Add Speaker Profile Admin APIs](10-add-speaker-profile-admin-apis.md)
Blocks: None

## What to build

Implement the resolved `/admin/speakers` editing experience for public Speaker snapshots.

Add an `Edit` action to Speaker rows/cards. Opening it should show the shared Speaker form inline above the list, using the existing invite form area or an extracted shared form component. The form edits `display_name`, `slug`, `affiliation`, `bio`, `social_handles`, and `photo`; shows read-only origin/source context; previews current or replacement photo; supports remove photo; and saves through the typed Speaker profile admin API.

Publishing remains controlled only by the existing list/card toggle. Saving profile content must not publish a Speaker automatically.

## Acceptance criteria

- [x] Every Speaker row/card has an `Edit` action alongside existing publish and preview actions.
- [x] Edit mode opens an inline form above the list and can be cancelled without persisting changes.
- [x] The form supports both CFP-origin and invited Speakers without separate modes.
- [x] The form requires only display name and slug on the client.
- [x] Affiliation, bio, social handles, and photo remain optional.
- [x] Social handles are edited one per line and blank lines are ignored on save.
- [x] Current photo preview, replacement preview, and remove-photo states are clear.
- [x] Read-only source context explains that CFP-origin data is a copied snapshot and does not sync back.
- [x] Save refetches or updates the Speaker list and leaves `published` unchanged.
- [x] Failed saves keep the user's entered values and show actionable error text when available.
- [x] The layout follows the resolved two-column desktop and stacked mobile shape.

## Verification

- [x] Manually verify edit, cancel, save, photo replacement, photo removal, and validation states on desktop and mobile widths.
- [x] Manually verify a CFP-origin edit changes public Speaker data after the DTO mapping ticket is complete.
- [x] Run `pnpm build`.

## Decision references

- [Shape Speaker Edit UX](03-shape-speaker-edit-ux.md)
- [Speaker Edit UX Prototype](../assets/speaker-edit-ux-prototype.md)
- [Decide Speaker Profile Source Policy](02-decide-speaker-profile-source-policy.md)

## Comments

### Resolution Comment - 2026-07-09

Added `Edit` actions to `/admin/speakers` desktop rows and mobile cards, plus an inline shared Speaker profile edit form above the list. The form edits `display_name`, `slug`, `affiliation`, `bio`, `social_handles`, and `photo`; shows read-only invited/CFP-origin source context; supports current photo preview, replacement preview, remove-photo intent, and client-required name/slug only; saves through `adminUpdateSpeakerProfile`; and leaves publication controlled only by the existing list toggle.

Verification: manually checked invited edit/cancel/validation/duplicate-slug failure, successful invited save with blank social lines ignored, CFP-origin save with source Applicant/User unchanged, photo replacement with a real non-empty browser `File`, photo removal, desktop two-column geometry, and mobile stacked/card layout. `pnpm build` passed. `git diff --check -- src .scratch/admin-speaker-session-promotion/issues/11-build-admin-speaker-edit-ui.md` passed.
