# September Gamification Accounting Foundation And Profile Read Model

Status: ready-for-agent
Type: AFK
Created: 2026-06-06

## Parent

`.scratch/wts-2026-gamification/PRD.md`

The closed decisions in `.scratch/wts-2026-gamification/wayfinder/MAP.md` supersede conflicting PRD text.

## What to build

Build the September accounting and profile-read-model foundation for a **User**: configured **Achievements** and **Missions**, Activities, authoritative **Activity Claims**, **Badges**, an append-only **XP Event** ledger, a **Gamification Profile**, versioned dynamic-score schedules, access-level calculation, and a profile panel.

This is a full-release foundation, not an MVP or a production catalog seed. It establishes the server-only accounting contracts that later code, Hi.Events, event, Partner Activity, and admin slices use. Code/redemption and partner-consent records belong to their dedicated briefs.

## Acceptance criteria

- [ ] A Gamification Profile can be created or fetched for an authenticated User.
- [ ] The authoritative foundation supports configured **Achievements**, **Missions**, Activities, **Activity Claims**, User Achievement/Badge state, **XP Events**, **Gamification Profiles**, and admin audit actions with the settled server-only, idempotent, and void/revocation boundaries.
- [ ] An **Achievement** stores its rule and Badge presentation. The Activity/versioned score policy owns direct total XP and **Leaderboard XP**; unlocking a direct Badge never creates a second direct XP award.
- [ ] User Achievement records unlock a Badge at most once per **User** and **Achievement** and preserve audited revocation rather than deletion.
- [ ] XP events are append-only and include amount, reason, category, source, idempotency key, and voided state.
- [ ] User XP totals and level progress are calculated from non-voided XP events.
- [ ] The active September score schedule records direct total-XP/**Leaderboard XP** policies, cap membership, and its calculated dynamic ceilings; only active score-bearing policies contribute to the schedule.
- [ ] Access Levels 1 through 7 use the fixed schedule's total-XP thresholds of 0%, 5%, 15%, 30%, 50%, 75%, and 100%, without lowering an earned level after a later successor policy is activated.
- [ ] Profile totals are cached or otherwise exposed efficiently for profile display.
- [ ] No live onboarding Achievement is seeded or auto-awarded unless organizers later configure it as a valid September Activity. Test fixtures are not production catalog content.
- [ ] A newly created **Gamification Profile** is ops-board-visible by default and has a safe non-email display-name fallback; it retains those visibility settings across rebuilds.
- [ ] The User profile shows server-provided total XP, access level, next-level progress, unlocked Badges, and no raw claims, XP ledger rows, code material, or private source metadata.
- [ ] Unauthenticated Users cannot fetch a private gamification summary.
- [ ] The implementation keeps privileged writes behind server-side authentication and does not allow the public PocketBase client to create XP or achievement records directly.
- [ ] Tests cover server-only writes, idempotent Badge/XP creation, voided-event totals, access-level thresholds, profile-cache rebuilds, and safe current-User DTO boundaries.
- [ ] The build completes successfully.

## Blocked by

None - can start immediately
