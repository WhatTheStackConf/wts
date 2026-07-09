# Check Data Model and Migration Needs

Status: closed
Labels: wayfinder:research
Parent: [Map: Admin Speaker Editing and CFP Session Promotion](../MAP.md)
Assignee: OpenCode
Blocked by: [Decide Speaker Profile Source Policy](02-decide-speaker-profile-source-policy.md), [Shape Speaker Edit UX](03-shape-speaker-edit-ux.md), [Decide CFP Submission Promotion Semantics](04-decide-cfp-submission-promotion-semantics.md), [Shape CFP Promotion Admin UX](05-shape-cfp-promotion-admin-ux.md)
Blocks: [Split Implementation Into Agent-Ready Work](07-split-implementation-into-agent-ready-work.md)

## Question

Given the resolved Speaker source policy and CFP promotion semantics/UX, does the current PocketBase schema support the work, or are migrations/type updates required?

Answer with the minimal schema/API change set, including any new relation/provenance fields, file fields, override fields, uniqueness constraints, generated type updates, and public DTO mapping changes. Link any research notes in the resolution comment.

## Resolution

Resolved in the resolution comment below.

## Comments

### Resolution Comment - 2026-07-08

Research notes: [Data Model and Migration Needs Research](../assets/data-model-and-migration-needs-research.md)

Decision: the existing Speaker schema is sufficient for the resolved public Speaker edit policy; no new Speaker override fields or file fields are needed. The minimal required schema addition is `sessions.cfp_submission`, an optional relation to `cfp_submissions`, with a partial unique index so each CFP Submission can promote to at most one Session. Add a matching partial unique index on `speakers.cfp_applicant` to make Speaker reuse/create race-safe.

The implementation spec should also require manual `SessionRecord.cfp_submission` type updates, typed allowlisted Speaker edit and CFP promotion server actions, strict public Speaker DTO mapping from `speakers` only, no CFP provenance in public DTOs, and MCP programme data updates so Speaker fields no longer fall back to CFP Applicant/User data while Session DTOs expose `cfp_submission_id` for authorized programme consumers.
