# Map: Admin Speaker Editing and CFP Session Promotion

Status: active
Labels: wayfinder:map
Tracker: local-markdown
Created: 2026-07-08

## Destination

An agent-ready implementation spec/ticket map for the admin programme workflow: admins can edit public Speaker profile data and images for both CFP-origin and invited Speakers, and can promote an accepted CFP Submission into a prefilled draft public Session linked to the right Speaker.

The map is done when the source/override policy, promotion semantics, admin UX shape, data model/migration needs, and implementation slices are clear enough for an implementation agent to proceed without further product decisions.

## Notes

Use the vocabulary in `CONTEXT.md`: **CFP Applicant**, **Speaker**, **CFP Submission**, **Session**, and **Published** are distinct. Public pages must never expose CFP review-only content such as **Key takeaways**, reviewer notes, or private submission metadata.

Confirmed during charting: this is a planning map, not a code-change session; speaker editing covers both CFP-origin and invited Speakers; CFP promotion should create a draft Session for admin review, not publish directly.

Use `/domain-modeling` for source-of-truth decisions, `/grilling` for HITL decisions, and `/modern-web-guidance` before frontend/admin UI design work. Local markdown has no native child/dependency feature here, so child tickets live in `issues/` and use `Parent`, `Blocked by`, and `Blocks` links as the fallback dependency convention.

## Decisions so far

- [Inventory Existing Programme Admin Seams](issues/01-inventory-existing-programme-admin-seams.md) — Existing code has draft Speaker and generic Session primitives, but lacks Speaker edit/update-photo, per-submission CFP-to-draft-Session promotion, and promotion provenance; public and MCP Speaker field precedence currently disagree for CFP-origin Speakers.
- [Decide Speaker Profile Source Policy](issues/02-decide-speaker-profile-source-policy.md) — Public Speaker profile fields are strict Speaker-owned snapshots for every origin; CFP promotion copies whitelisted CFP/User values once, admin edits only `speakers`, there is no auto-sync/backfill, and public images use only `speakers.photo`.
- [Shape Speaker Edit UX](issues/03-shape-speaker-edit-ux.md) — Speaker editing uses an inline shared form on `/admin/speakers` for all origins, with read-only source context, photo preview/replace/remove, name+slug-only required validation, list-only publish toggle, and responsive two-column-to-stacked layout.
- [Decide CFP Submission Promotion Semantics](issues/04-decide-cfp-submission-promotion-semantics.md) — Promotion is accepted-only and copy-once: reuse/create an unpublished Speaker, create one unpublished draft Session with `sessions.cfp_submission` provenance, copy only title+abstract, exclude private CFP/review fields, and never auto-sync.
- [Shape CFP Promotion Admin UX](issues/05-shape-cfp-promotion-admin-ux.md) — `Create draft session` lives on accepted proposal rows/cards, routes success to Sessions admin draft review, and leaves `Create draft profile` on Speakers admin as a speaker-only escape hatch.
- [Check Data Model and Migration Needs](issues/06-check-data-model-and-migration-needs.md) — Existing Speaker fields/photos are sufficient; add Session CFP provenance with uniqueness and update admin APIs plus public/MCP mappers to use Speaker-owned data only.
- [Split Implementation Into Agent-Ready Work](issues/07-split-implementation-into-agent-ready-work.md) — Implementation is split into six dependent ready-for-agent slices covering schema/types, DTO mapping, Speaker APIs/UI, and CFP promotion APIs/UI.

## Not yet specified

- None; the implementation breakdown now lives in [Split Implementation Into Agent-Ready Work](issues/07-split-implementation-into-agent-ready-work.md).

## Out of scope

- Redesigning CFP review, scoring, weighting, or acceptance workflows beyond consuming the existing accepted status.
- Publishing **Key takeaways**, reviewer notes, private notes, or private CFP metadata on public Speaker or Session pages.
- Automatic schedule, room, or track assignment during promotion.
- Public website visual redesign unrelated to displaying the edited Speaker data or promoted draft Sessions.
- Speaker notification emails after promotion.
