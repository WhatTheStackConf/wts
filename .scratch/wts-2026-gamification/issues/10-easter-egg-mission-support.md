# Easter Egg Mission Support

Status: ready-for-agent
Type: AFK
Created: 2026-06-06

## Parent

`.scratch/wts-2026-gamification/PRD.md`

## What to build

Support hidden easter egg achievements for playful technical exploration. Easter eggs should use the same mission and claim model as other achievements, while supporting hidden achievement visibility, static code redemption, revoked or expired puzzle states, and optional server-side answer validation for puzzle-style flags.

This slice should make hackery-style achievements possible without encouraging unsafe behavior or exposing secret unlock values.

## Acceptance criteria

- [ ] Admins can configure a hidden easter egg achievement.
- [ ] Hidden easter egg achievements do not reveal spoiler details to Users who have not unlocked them.
- [ ] A static easter egg code can be redeemed through the secure mission redemption flow.
- [ ] A puzzle-style easter egg can validate an answer server-side before awarding a claim, achievement, and XP.
- [ ] Invalid answers return a clear failure state without awarding XP.
- [ ] Revoked, disabled, expired, or not-yet-active easter egg missions return clear states.
- [ ] Easter egg XP is awarded idempotently and can be excluded or weighted separately for leaderboard XP if configured.
- [ ] The User profile displays unlocked hidden achievements correctly after redemption.
- [ ] The implementation does not require destructive or unsafe user behavior to complete an easter egg.
- [ ] The build completes successfully.

## Blocked by

- `.scratch/wts-2026-gamification/issues/01-gamification-foundation-and-profile-mvp.md`
- `.scratch/wts-2026-gamification/issues/02-secure-mission-code-redemption.md`
- `.scratch/wts-2026-gamification/issues/03-admin-achievement-and-code-management.md`
