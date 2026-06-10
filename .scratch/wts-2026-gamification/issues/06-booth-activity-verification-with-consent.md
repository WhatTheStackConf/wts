# Booth Activity Verification With Consent

Status: ready-for-agent
Type: AFK
Created: 2026-06-06

## Parent

`.scratch/wts-2026-gamification/PRD.md`

## What to build

Support partner booth activities that can be verified by authorized booth staff. Booth staff should be able to scan or identify a User, select an allowed booth activity result, and award the appropriate activity claim, achievement, and XP. Contact sharing must be explicit and separate from earning XP.

This slice should deliver the basic booth game path with visit, participation, and completion outcomes, while keeping high-score tiers and meta achievements for a later slice.

## Acceptance criteria

- [ ] Admins can configure a partner booth activity with at least visit, participation, and completion outcomes.
- [ ] Authorized booth staff can verify only the booth activities they are allowed to award.
- [ ] Booth staff can scan or otherwise select a User and award an allowed activity outcome.
- [ ] Awarding a booth outcome creates an activity claim and idempotently awards the configured achievement and XP.
- [ ] The same booth outcome cannot be awarded repeatedly to inflate XP.
- [ ] Regular Users cannot self-award staff-verified booth outcomes.
- [ ] Contact-sharing consent is recorded separately from the XP award.
- [ ] Earning booth XP does not automatically share a User's contact details with a partner.
- [ ] The User can see booth achievements in their profile summary.
- [ ] The build completes successfully.

## Blocked by

- `.scratch/wts-2026-gamification/issues/01-gamification-foundation-and-profile-mvp.md`
- `.scratch/wts-2026-gamification/issues/02-secure-mission-code-redemption.md`
- `.scratch/wts-2026-gamification/issues/03-admin-achievement-and-code-management.md`
