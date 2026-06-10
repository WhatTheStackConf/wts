# Booth Tiers, Caps, And Meta Achievements

Status: ready-for-agent
Type: AFK
Created: 2026-06-06

## Parent

`.scratch/wts-2026-gamification/PRD.md`

## What to build

Extend booth gamification beyond basic verification by adding higher-tier outcomes, category caps, and meta achievements across multiple booths. Booths should be able to award configured tiers such as win or high score, while the system prevents one booth or repeated low-effort actions from dominating XP or leaderboard ranking.

This slice should make booth games richer without changing the core claim and XP ledger model.

## Acceptance criteria

- [ ] Booth activities can define higher-tier outcomes beyond visit, participation, and completion.
- [ ] Higher-tier outcomes can award different achievements and XP values.
- [ ] Awarding a higher-tier outcome is idempotent for the relevant User and activity.
- [ ] Booth-related XP can be capped by category, day, activity, or other configured boundary.
- [ ] Capped XP behavior is visible enough for admins to understand why no extra leaderboard XP was awarded.
- [ ] Meta achievements can unlock based on activity across multiple booths.
- [ ] Example meta achievements such as visiting multiple booths or completing multiple booth activities can be represented.
- [ ] The leaderboard uses capped or category-aware XP according to configured rules.
- [ ] The User profile displays higher-tier and meta achievements correctly.
- [ ] The build completes successfully.

## Blocked by

- `.scratch/wts-2026-gamification/issues/06-booth-activity-verification-with-consent.md`
