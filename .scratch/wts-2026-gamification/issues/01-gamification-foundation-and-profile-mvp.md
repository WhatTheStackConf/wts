# Gamification Foundation And Profile MVP

Status: ready-for-agent
Type: AFK
Created: 2026-06-06

## Parent

`.scratch/wts-2026-gamification/PRD.md`

## What to build

Build the first complete gamification tracer bullet for a User: persistent achievements, User achievements, an append-only XP ledger, a Gamification Profile summary, level calculation, an initial seed achievement, and a profile UI panel showing XP, level progress, and unlocked badges.

This slice should prove the core accounting model end-to-end without QR codes, partner verifiers, or event-day mechanics. A User should be able to open their profile and see a real gamification summary derived from server-side data rather than mocked UI.

## Acceptance criteria

- [ ] A Gamification Profile can be created or fetched for an authenticated User.
- [ ] Achievements can be stored with name, description, icon, category, XP value, rarity, visibility, and active state.
- [ ] User achievements can record that a User unlocked an achievement exactly once.
- [ ] XP events are append-only and include amount, reason, category, source, idempotency key, and voided state.
- [ ] User XP totals and level progress are calculated from non-voided XP events.
- [ ] Profile totals are cached or otherwise exposed efficiently for profile display.
- [ ] An initial onboarding achievement such as “Agent Activated” is seeded or created and can be awarded idempotently.
- [ ] The User profile shows XP, level, next-level progress, and unlocked badges using server-provided data.
- [ ] Unauthenticated Users cannot fetch a private gamification summary.
- [ ] The implementation keeps privileged writes behind server-side authentication and does not allow the public PocketBase client to create XP or achievement records directly.
- [ ] The build completes successfully.

## Blocked by

None - can start immediately
