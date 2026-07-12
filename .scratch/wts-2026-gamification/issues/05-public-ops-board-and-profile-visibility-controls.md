# Public Ops Board And Profile Visibility Controls

Status: ready-for-agent
Type: AFK
Created: 2026-06-06

## Parent

`.scratch/wts-2026-gamification/PRD.md`

The closed decisions in `.scratch/wts-2026-gamification/wayfinder/MAP.md` supersede conflicting PRD text.

## What to build

Build the individual `/ops-board` and **Gamification Profile** visibility controls. **Users** are visible by default and can opt out, set a display name, and appear in an ops-board-style ranking based on **Leaderboard XP** rather than raw total XP. The board excludes non-ranking XP categories such as admin corrections or other configured categories.

This slice should make progression social while preserving privacy and fairness.

## Acceptance criteria

- [ ] Users are included in the individual ops board by default and can opt out of public visibility.
- [ ] Users can opt out or back in to ops-board visibility.
- [ ] Users can set or confirm an ops-board display name; its safe default is `users.name` when available or a generated `Agent <short-id>`, never email.
- [ ] The leaderboard uses leaderboard XP rather than blindly using all XP events.
- [ ] Voided XP events do not count toward leaderboard position.
- [ ] Ticket-present, static easter eggs, total-only policies, and manual awards/corrections by default have zero **Leaderboard XP**; partner consent, external activity, code attempts, and support interactions have no gameplay value.
- [ ] Equal **Leaderboard XP** totals share competition ranks (`1, 1, 3`) with no secondary ranking criterion based on private activity, total XP, timing, or Badge count.
- [ ] Profile-changing award, void, correction, and rebuild operations refresh the row before returning; the board reads profile cache on request and may refresh no more than once per minute without a push channel.
- [ ] Public rows contain only visible rank, safe display name, access level, **Leaderboard XP**, public Badge count, and permitted public Badge snippets.
- [ ] Opting out removes the User from public leaderboard output without deleting their Badges or XP history.
- [ ] The authenticated profile includes the visibility toggle, display-name control, global Badge-snippet control, and per-Badge public/private controls without creating a separate settings route.
- [ ] Hidden-until-unlocked, revoked, retired, and private Badges follow the settled profile/ops-board presentation rules; hidden details, raw Activity Claims, ticket data, partner activity, consent, and raw activity history never enter a public DTO.
- [ ] The profile summary supports current-User Badge states, safe suggested Missions, and redemption links without exposing private evidence.
- [ ] The leaderboard UI works on desktop and mobile.
- [ ] Tests cover default visibility, opt-out, display-name privacy, allowed Badge snippets, competition ties, excluded XP, and public DTO allowlisting.
- [ ] The build completes successfully.

## Blocked by

- `.scratch/wts-2026-gamification/issues/01-september-gamification-accounting-foundation-and-profile-read-model.md`
