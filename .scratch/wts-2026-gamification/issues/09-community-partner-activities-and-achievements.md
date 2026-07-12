# Community Partner Activities And Achievements

Status: ready-for-agent
Type: AFK
Created: 2026-06-06

## Parent

`.scratch/wts-2026-gamification/PRD.md`

The closed decisions in `.scratch/wts-2026-gamification/wayfinder/MAP.md` supersede conflicting PRD text.

## What to build

Support **Community Partner** Activities and their distinct Badges independently from commercial booth outcomes. Community Partners can run WTS-linked **Partner Activities** before, during, or after the conference through WTS-admin generated QR/link/code/static evidence. They receive no verifier, scanner, award, support, code-management, User-history, raw-code, or consent-query account.

This slice should make community participation first-class while preserving auditability and the admin-only support boundary.

Inventory constraint: each selected Community Partner programme has an immutable `community.{partnerKey}.{activityKey}` Mission and selected attendance, participation, or completion Activities. It relates to an existing `partners` record with gamification `partnerKind = community_partner`; this classification is configured for gamification and is not inferred from public partner type or tier. Cross-community metas select at most one qualifying Activity per Community Partner programme.

## Acceptance criteria

- [ ] Admins can configure a Community Partner through the existing partner record and create community-scoped Activities with outcome, evidence channel/role, windows, limits, cap key, Achievement rule, and WTS-managed code deployment metadata.
- [ ] Community Activities can be linked to distinct Achievements and configured total-XP/**Leaderboard XP** policies without being presented as commercial booth outcomes.
- [ ] Community QR/link/manual/static codes can be published and redeemed through the secure Mission redemption flow; an external community URL or form click is never evidence.
- [ ] WTS-admin generated community evidence creates auditable **Activity Claims** and XP Events idempotently. Reissued/different codes cannot bypass an Activity's per-User limit, and an exhausted XP cap does not erase a valid claim or Badge.
- [ ] Community achievements are distinguishable from commercial booth achievements in admin and User views.
- [ ] Community attendance, participation, and completion use 20/15, 25/20, and 30/25 total-XP/**Leaderboard XP** policies. One Community Partner shares its highest active programme ceiling, up to 30/25, or 40/30 only for an explicitly approved two-code programme.
- [ ] Community category, day, and conference ceilings are derived from distinct active Community Partner group policies; cross-community metas count at most one designated Activity per Community Partner.
- [ ] Cross-community meta achievements can be represented or evaluated.
- [ ] Public or locked-teaser Mission/Badge presentation is organizer-approved per programme. Codes, claims, consent, partner attribution, and deployment data are admin-only.
- [ ] An explicitly approved Community Partner programme may use the established two-code start/finish flow; it follows the shared event bands and related-group cap.
- [ ] Community Activities register their configured meta eligibility with the shared evaluator from issue 13 rather than implementing a separate meta path.
- [ ] Optional contact consent, if approved for a named Community Partner Activity, is an unchecked separate one-time name/email handoff controlled by admins. It never changes gamification, creates no partner portal or automatic sharing, and can be withdrawn by the current User for future WTS handoffs.
- [ ] Regular **Users**, Community Partners, and staff cannot award or manage community achievements. Legitimate exceptions use only an audited admin manual award.
- [ ] Tests cover source/evidence isolation, single-Community-Partner caps, consent separation, visibility boundaries, shared meta eligibility, and safe DTOs.
- [ ] The build completes successfully.

## Blocked by

- `.scratch/wts-2026-gamification/issues/01-september-gamification-accounting-foundation-and-profile-read-model.md`
- `.scratch/wts-2026-gamification/issues/02-secure-mission-code-redemption.md`
- `.scratch/wts-2026-gamification/issues/03-admin-gamification-configuration-and-code-operations.md`
- `.scratch/wts-2026-gamification/issues/06-booth-activity-verification-with-consent.md`
- `.scratch/wts-2026-gamification/issues/13-shared-meta-achievement-evaluator.md`
