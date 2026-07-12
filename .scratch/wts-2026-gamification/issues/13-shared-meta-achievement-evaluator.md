# Shared Meta Achievement Evaluator

Status: ready-for-agent
Type: AFK
Created: 2026-07-09

## Parent

`.scratch/wts-2026-gamification/PRD.md`

The closed decisions in `.scratch/wts-2026-gamification/wayfinder/MAP.md` supersede conflicting PRD text.

## What to build

Build the one shared evaluator for **Meta Achievements**. It evaluates configured claim-set and claim-count rules after relevant accepted **Activity Claims**, creates one derived `system_meta` **Activity Claim** using `meta_rule` evidence and one Meta Badge/XP outcome, and reevaluates after relevant source claims are voided or corrected. Session, booth, event, and Community Partner briefs only register their qualifying Activities with this evaluator; they must not reimplement meta accounting.

## Acceptance criteria

- [ ] Admins configure an active Meta Achievement as an exact `claim_set` or a selected-source `claim_count`, with fixed 20/15, 30/25, or 40/30 total-XP/**Leaderboard XP** band matched to its source breadth.
- [ ] The evaluator uses only accepted, non-voided source claims. Source claims remain eligible after their direct XP is capped to zero.
- [ ] A cross-Session, cross-booth, or cross-community rule selects at most one designated qualifying Activity per Session, sponsor, or Community Partner programme. Multiple tiers at one source cannot satisfy diversity.
- [ ] Satisfying a rule creates at most one idempotent derived `system_meta` Activity Claim, Badge, and score outcome per User and Meta Achievement.
- [ ] A voided source reevaluates affected Meta Achievements, voiding/revoking only outcomes no longer supported by remaining accepted evidence while preserving audit history.
- [ ] Meta outcomes use the same independent category/day/conference cap treatment as other score policies. A cap never removes a valid meta claim or Badge.
- [ ] Meta composition, source claim progress, cap diagnostics, and source history are current-User/admin-only. Public ops-board snippets reveal only permitted Meta Badge presentation.
- [ ] Tests cover exact-set/count rules, source diversity, capped-source eligibility, idempotency, source void/re-evaluation, band selection, caps, and DTO privacy.

## Blocked by

- `.scratch/wts-2026-gamification/issues/01-september-gamification-accounting-foundation-and-profile-read-model.md`
- `.scratch/wts-2026-gamification/issues/02-secure-mission-code-redemption.md`
- `.scratch/wts-2026-gamification/issues/03-admin-gamification-configuration-and-code-operations.md`
