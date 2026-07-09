# Decide Speaker Profile Source Policy

Status: closed
Labels: wayfinder:grilling
Parent: [Map: Admin Speaker Editing and CFP Session Promotion](../MAP.md)
Assignee: OpenCode
Blocked by: [Inventory Existing Programme Admin Seams](01-inventory-existing-programme-admin-seams.md)
Blocks: [Shape Speaker Edit UX](03-shape-speaker-edit-ux.md), [Check Data Model and Migration Needs](06-check-data-model-and-migration-needs.md)

## Question

For public Speaker profile editing across CFP-origin and invited Speakers, where should admin edits live and how should public pages resolve profile fields?

Resolve at least: display name, slug, affiliation, bio, social handles, and image. Decide whether CFP-origin edits update the linked CFP Applicant/User source fields, use Speaker-owned public overrides, or use a field-by-field hybrid. Capture the field precedence rules and any glossary update needed to keep **CFP Applicant** and **Speaker** distinct.

## Resolution

Resolved in the resolution comment below.

## Comments

### Resolution Comment - 2026-07-08

Decision: use strict copy-on-promotion for public **Speaker** profiles.

Resolved policy:

- Public profile fields for every **Speaker origin** live on the `speakers` record.
- For CFP-origin **Speakers**, promotion copies whitelisted **CFP Applicant** and **User** values into `speakers` once.
- Public pages should read display name, slug, affiliation, bio, social handles, and image from `speakers` only.
- Admin edits update the public `speakers` record and do not mutate linked **CFP Applicant** or **User** source records.
- Later **CFP Applicant** or **User** changes do not auto-sync to the public **Speaker** profile.
- Do not backfill existing CFP-origin Speaker records automatically; incomplete existing records will be completed manually through the new admin edit flow.
- Public Speaker images use `speakers.photo` only. Promotion may copy a real `users.avatar` file into `speakers.photo` when present; otherwise the Speaker starts without a photo until admin upload or placeholder handling.
- Public Speaker images must not fall back to User avatar or Gravatar.
- Never copy **CFP Submission** review-only/private fields into public Speaker fields.

Domain glossary updated in `CONTEXT.md` under **Speaker profile (public page)**, **Speaker photo**, and **Public data access**.
