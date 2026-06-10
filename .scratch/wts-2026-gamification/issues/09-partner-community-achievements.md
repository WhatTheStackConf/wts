# Partner Community Achievements

Status: ready-for-agent
Type: AFK
Created: 2026-06-06

## Parent

`.scratch/wts-2026-gamification/PRD.md`

## What to build

Support community partner achievements independently from commercial booth achievements. Community partners should be able to run WTS-linked activities before, during, or after the conference, and authorized community verifiers should be able to award only their community's configured achievements or codes.

This slice should make community participation first-class while preserving auditability and limited verifier permissions.

## Acceptance criteria

- [ ] Admins can configure a community partner and community-scoped activity.
- [ ] Community activities can be linked to achievements and XP values.
- [ ] Community verifier permissions are limited to their configured community activities.
- [ ] A community verifier can award a community achievement to an authenticated User or valid User target through an authorized flow.
- [ ] Community codes can be published and redeemed through the secure mission redemption flow.
- [ ] Community awards create auditable activity claims and XP events.
- [ ] Community achievements are distinguishable from commercial booth achievements in admin and User views.
- [ ] Cross-community meta achievements can be represented or evaluated.
- [ ] Unauthorized Users cannot award or manage community achievements.
- [ ] The build completes successfully.

## Blocked by

- `.scratch/wts-2026-gamification/issues/01-gamification-foundation-and-profile-mvp.md`
- `.scratch/wts-2026-gamification/issues/02-secure-mission-code-redemption.md`
- `.scratch/wts-2026-gamification/issues/03-admin-achievement-and-code-management.md`
