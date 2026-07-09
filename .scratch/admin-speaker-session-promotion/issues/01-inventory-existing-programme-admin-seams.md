# Inventory Existing Programme Admin Seams

Status: closed
Labels: wayfinder:research
Parent: [Map: Admin Speaker Editing and CFP Session Promotion](../MAP.md)
Assignee: OpenCode
Blocked by: None
Blocks: [Decide Speaker Profile Source Policy](02-decide-speaker-profile-source-policy.md), [Decide CFP Submission Promotion Semantics](04-decide-cfp-submission-promotion-semantics.md)

## Question

Which existing admin actions, components, PocketBase fields/migrations, public DTO mapping rules, and tests are relevant to editing Speaker profiles/images and promoting CFP Submissions into draft public Sessions?

Create a concise markdown research asset linked in the resolution comment. Include code references, current behavior, missing seams, and hazards that later decisions must account for.

## Resolution

Resolved in the resolution comment below.

## Comments

### Resolution Comment - 2026-07-08

Research asset: [Programme Admin Seams Research](../assets/programme-admin-seams-research.md)

The current admin programme seams are clear enough to unblock the next decisions. The app already supports creating draft Speakers from accepted CFP applicants, inviting Speakers with photo upload, generic Session create/edit, and publish toggles. Missing seams are full Speaker editing, update-time image handling, per-submission CFP-to-draft-Session promotion, and persisted promotion provenance.

Key hazard for the next ticket: public Speaker pages and MCP programme data currently disagree on CFP-origin Speaker field precedence. Public pages read CFP-origin bio/socials/affiliation/photo from CFP Applicant/User sources, while MCP programme data already prefers Speaker fields as overrides.
