# Admin Manual Awards And Audit History

Status: ready-for-agent
Type: AFK
Created: 2026-06-06

## Parent

`.scratch/wts-2026-gamification/PRD.md`

## What to build

Add admin support for manual corrections and audit review. Admins should be able to manually award an achievement, revoke or void an XP event when correcting an issue, and inspect a User's gamification history to understand how achievements and XP were earned.

This slice should make the system operable under real event-day support conditions without deleting historical records.

## Acceptance criteria

- [ ] Admins can manually award an achievement to a User.
- [ ] Manual awards create auditable user achievement and XP event records.
- [ ] Manual awards can be marked or categorized so they can be excluded from leaderboard XP where configured.
- [ ] Admins can void an XP event without deleting it.
- [ ] Voided XP events no longer count toward total XP or leaderboard XP.
- [ ] Admins can view a User's gamification history, including achievements, claims, XP events, voided events, and manual actions.
- [ ] Regular Users cannot manually award, revoke, or void achievements or XP.
- [ ] User-facing totals update after a manual award or void.
- [ ] Support/debug views expose enough context to answer why a User has or does not have a badge.
- [ ] The build completes successfully.

## Blocked by

- `.scratch/wts-2026-gamification/issues/01-gamification-foundation-and-profile-mvp.md`
