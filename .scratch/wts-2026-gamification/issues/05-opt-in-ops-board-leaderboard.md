# Opt-In Ops Board Leaderboard

Status: ready-for-agent
Type: AFK
Created: 2026-06-06

## Parent

`.scratch/wts-2026-gamification/PRD.md`

## What to build

Build an opt-in individual leaderboard for gamification. Users should be private by default, can opt in with a display name, and can appear on an ops-board-style ranking based on leaderboard XP rather than raw total XP. The leaderboard should exclude non-ranking XP categories such as admin corrections or other configured categories.

This slice should make progression social while preserving privacy and fairness.

## Acceptance criteria

- [ ] Users are excluded from the individual leaderboard by default.
- [ ] Users can opt in or out of leaderboard visibility.
- [ ] Users can set or confirm a leaderboard display name.
- [ ] The leaderboard uses leaderboard XP rather than blindly using all XP events.
- [ ] Voided XP events do not count toward leaderboard position.
- [ ] Excluded categories such as admin adjustments do not count toward leaderboard XP.
- [ ] The leaderboard shows rank, display name, level or XP, and enough badge/progress context to be useful.
- [ ] Opting out removes the User from public leaderboard output without deleting their achievements or XP history.
- [ ] The leaderboard UI works on desktop and mobile.
- [ ] The build completes successfully.

## Blocked by

- `.scratch/wts-2026-gamification/issues/01-gamification-foundation-and-profile-mvp.md`
