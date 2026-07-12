# Easter Egg Mission Support

Status: ready-for-agent
Type: AFK
Created: 2026-06-06

## Parent

`.scratch/wts-2026-gamification/PRD.md`

The closed decisions in `.scratch/wts-2026-gamification/wayfinder/MAP.md` supersede conflicting PRD text.

## What to build

Support hidden easter-egg **Missions** and Badges for playful technical exploration. Easter eggs use the same **Mission** and **Activity Claim** model as other configured Activities, with hidden visibility and static-code redemption. September treats a discovered static code/link as the evidence and does not add server-side puzzle-answer validation.

This slice should make hackery-style achievements possible without encouraging unsafe behavior or exposing secret unlock values.

Inventory constraint: each safe discovery is one hidden `easter_egg.{eggKey}` Mission containing one `.discovery` Activity with `static_discovery` outcome and `static_puzzle_code` evidence. It has no required partner, Session, or event relation, and a leaked static code is still bounded by the configured easter-egg scoring group.

## Acceptance criteria

- [ ] Admins can configure a hidden easter egg achievement.
- [ ] Hidden easter egg achievements do not reveal spoiler details to Users who have not unlocked them.
- [ ] A static easter egg code can be redeemed through the secure mission redemption flow.
- [ ] No server-side puzzle-answer validator or invalid-answer flow is added for September; static code/link redemption remains the only easter-egg evidence path.
- [ ] Disabled, expired, not-yet-active, limited, and rate-limited easter-egg codes return the settled clear redemption states. Badge revocation is shown only as a neutral profile correction, not a code state.
- [ ] Each accepted static discovery awards 10 total XP and zero **Leaderboard XP** idempotently. The dynamic easter-egg category/conference total-XP ceiling is the sum of active discovery policies, while no static discovery can affect rank.
- [ ] The User profile displays unlocked hidden achievements correctly after redemption.
- [ ] Hidden-until-unlocked Achievements are absent from locked lists, suggested Missions, and public Badge snippets before unlock; post-unlock copy is spoiler-safe and still follows User Badge visibility controls.
- [ ] The implementation does not require destructive or unsafe user behavior to complete an easter egg.
- [ ] Tests cover hidden DTO treatment, static-code redemption, no server-side answer validation, zero Leaderboard XP, code lifecycle states, and spoiler-safe public boundaries.
- [ ] The build completes successfully.

## Blocked by

- `.scratch/wts-2026-gamification/issues/01-september-gamification-accounting-foundation-and-profile-read-model.md`
- `.scratch/wts-2026-gamification/issues/02-secure-mission-code-redemption.md`
- `.scratch/wts-2026-gamification/issues/03-admin-gamification-configuration-and-code-operations.md`
- `.scratch/wts-2026-gamification/issues/05-public-ops-board-and-profile-visibility-controls.md`
