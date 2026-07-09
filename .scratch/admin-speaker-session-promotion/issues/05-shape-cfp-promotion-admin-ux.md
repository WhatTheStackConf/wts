# Shape CFP Promotion Admin UX

Status: closed
Labels: wayfinder:prototype
Parent: [Map: Admin Speaker Editing and CFP Session Promotion](../MAP.md)
Assignee: OpenCode
Blocked by: [Decide CFP Submission Promotion Semantics](04-decide-cfp-submission-promotion-semantics.md)
Blocks: [Check Data Model and Migration Needs](06-check-data-model-and-migration-needs.md)

## Question

Where should the CFP-to-draft-Session promotion affordance live, and what should the admin flow be?

Produce a low-fidelity prototype or concrete UI outline covering the proposal leaderboard, Speakers admin, Sessions admin, success/error states, draft review path, duplicate/already-promoted state, and the relationship to the existing “Create draft profile” action. Link the prototype asset in the resolution comment.

## Resolution

Resolved in the resolution comment below.

## Comments

### Resolution Comment - 2026-07-08

Prototype asset: [CFP Promotion Admin UX Prototype](../assets/cfp-promotion-admin-ux-prototype.md)

HITL decision: approved the prototype's recommended flow.

Decision: CFP-to-draft-Session promotion lives on each accepted **CFP Submission** row/card in `/admin/proposals` as the primary `Create draft session` action. Successful promotion creates or reuses the **Speaker**, creates one unpublished draft **Session**, then offers `Review draft session`, which opens `/admin/sessions?edit={sessionId}` with the draft loaded for review.

The proposal leaderboard should no longer expose a separate speaker-only `Publish speaker` action once `Create draft session` exists, because promotion owns Speaker creation/reuse. The existing `Create draft profile` action remains on `/admin/speakers` as a speaker-only escape hatch for preparing a Speaker profile without promoting a specific Submission.

Already-promoted rows are keyed by Session provenance (`sessions.cfp_submission`): unpublished Sessions show `Draft session exists` plus `Review draft`, published Sessions show `Published session exists` plus edit/view paths, and no second create action is offered. Errors keep the row retryable only when valid and should explain accepted-status, missing-applicant, or duplicate-state blockers without exposing private CFP/review fields.
