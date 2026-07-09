# Decide CFP Submission Promotion Semantics

Status: closed
Labels: wayfinder:grilling
Parent: [Map: Admin Speaker Editing and CFP Session Promotion](../MAP.md)
Assignee: OpenCode
Blocked by: [Inventory Existing Programme Admin Seams](01-inventory-existing-programme-admin-seams.md)
Blocks: [Shape CFP Promotion Admin UX](05-shape-cfp-promotion-admin-ux.md), [Check Data Model and Migration Needs](06-check-data-model-and-migration-needs.md)

## Question

Exactly what should happen when an admin promotes an accepted CFP Submission into a draft public Session?

Resolve at least: eligibility rules, duplicate prevention, whether to create or require a Speaker first, how the Speaker is linked, which fields copy from the CFP Submission, which private fields are excluded, whether promotion records provenance back to the CFP Submission, and what happens when the source CFP Submission later changes.

## Resolution

Resolved in the resolution comment below.

## Comments

### Resolution Comment - 2026-07-08

Decision: promoting an accepted **CFP Submission** is a one-time copy into an admin-owned draft public **Session**, with persisted provenance back to the source submission.

Resolved policy:

- Eligibility: only **CFP Submissions** with `status = accepted`, a valid linked **CFP Applicant**, and no existing provenance-linked **Session** are promotable.
- Duplicate prevention: each **CFP Submission** can promote to at most one **Session**. Add persisted provenance on the **Session**, e.g. `sessions.cfp_submission`, and use that link as the duplicate guard and audit link-back.
- Speaker handling: promotion owns the Speaker-linking step. Reuse the existing CFP-origin **Speaker** for the source **CFP Applicant** when one exists; otherwise create a new unpublished CFP-origin **Speaker** snapshot using the whitelisted **CFP Applicant** and **User** copy rules from [Decide Speaker Profile Source Policy](02-decide-speaker-profile-source-policy.md).
- Session creation: create an unpublished draft **Session** linked to that **Speaker**.
- Public field copy: copy only `cfp_submissions.session_title` to `sessions.title` and `cfp_submissions.abstract` to `sessions.abstract`; generate a unique draft `sessions.slug` from the title.
- Empty admin-review fields: leave `sessions.format`, `sessions.starts_at`, `sessions.track`, and `sessions.room` empty for admin review.
- Private exclusions: do not copy `key_takeaways`, `technical_requirements`, `notes`, review scores/notes, `meta`, reviewer data, or any other private CFP/review metadata into the public **Session** or public DTO.
- Source changes: later edits to the **CFP Submission**, **CFP Applicant**, or **User** do not auto-sync into the promoted **Session** or linked **Speaker**. After promotion, admins edit public programme data on **Session** and **Speaker** records directly.
- Publishing: promotion never publishes automatically; admins must explicitly publish the **Session** and **Speaker** when ready.
