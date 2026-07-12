# Reshape Delivery Issues From Wayfinder Outcomes

Status: closed
Assignee: OpenCode
Labels: wayfinder:task
Type: AFK
Created: 2026-07-09
Closed: 2026-07-09
Part of: `.scratch/wts-2026-gamification/wayfinder/MAP.md`

## Question

How should the existing implementation issue briefs be updated after Wayfinder decisions are known?

Update or propose updates to `.scratch/wts-2026-gamification/issues/` so the delivery slices reflect the resolved September release scope, dependencies, terminology, data model, UX boundaries, ops requirements, privacy choices, and out-of-scope decisions. Explicitly remove stale MVP, opt-in ops-board, verifier/staff-scan, attendee peer-scan, team/faction, and September server-side puzzle-validation assumptions. The result should be a clear set of agent-ready implementation issues, with any deferred or invalidated slices marked accordingly.

## Blocked by

- `.scratch/wts-2026-gamification/wayfinder/tickets/01-define-gamification-language-and-destination.md`
- `.scratch/wts-2026-gamification/wayfinder/tickets/02-decide-september-conference-release-scope.md`
- `.scratch/wts-2026-gamification/wayfinder/tickets/03-decide-core-accounting-and-data-model.md`
- `.scratch/wts-2026-gamification/wayfinder/tickets/04-decide-secure-mission-redemption-model.md`
- `.scratch/wts-2026-gamification/wayfinder/tickets/05-decide-profile-redemption-and-ops-board-ux-boundaries.md`
- `.scratch/wts-2026-gamification/wayfinder/tickets/06-decide-hievents-awarding-semantics.md`
- `.scratch/wts-2026-gamification/wayfinder/tickets/07-decide-admin-operations-and-audit-model.md`
- `.scratch/wts-2026-gamification/wayfinder/tickets/08-decide-automated-partner-activity-and-consent-model.md`
- `.scratch/wts-2026-gamification/wayfinder/tickets/09-decide-scoring-fairness-caps-and-leaderboard-rules.md`
- `.scratch/wts-2026-gamification/wayfinder/tickets/12-decide-september-mission-inventory.md`

## Resolution

The delivery plan is now agent-ready for the full September release. Each retained brief states that the closed Wayfinder map supersedes conflicting PRD text, uses the settled **User**, **Achievement**, **Badge**, **Mission**, **Activity Claim**, **XP Event**, **Leaderboard XP**, **Gamification Profile**, **Partner Activity**, and **Community Partner** vocabulary, and carries behavior-focused test requirements rather than only a build check.

### Reshaped briefs

- Renamed the foundation to [September Gamification Accounting Foundation And Profile Read Model](../../issues/01-september-gamification-accounting-foundation-and-profile-read-model.md). It owns the authoritative accounting/read-model records, schedule-based access levels, default public ops-board visibility, and no longer seeds an invented production onboarding Badge.
- Renamed [Admin Gamification Configuration And Code Operations](../../issues/03-admin-gamification-configuration-and-code-operations.md), [Public Ops Board And Profile Visibility Controls](../../issues/05-public-ops-board-and-profile-visibility-controls.md), [Booth Higher-Tier Activities And Caps](../../issues/07-booth-higher-tier-activities-and-caps.md), [Configured Workshop And Surrounding Event Missions](../../issues/08-configured-workshop-and-surrounding-event-missions.md), and [Community Partner Activities And Achievements](../../issues/09-community-partner-activities-and-achievements.md) to remove superseded MVP, opt-in, and over-broad scope language.
- Strengthened secure redemption, Hi.Events, basic booth/consent, easter-egg, and admin-correction briefs with their settled security, privacy, cap, source-state, and audit boundaries.
- Added [Shared Meta Achievement Evaluator](../../issues/13-shared-meta-achievement-evaluator.md) so Meta Achievement accounting, source diversity, score bands, capped-source treatment, and void re-evaluation are implemented once.
- Added [Session Attendance Missions](../../issues/14-session-attendance-missions.md) so selected published Sessions have an owner for configured single-code attendance, 20/15 scoring, caps, privacy, and Meta eligibility.
- Closed [Team/Faction Scoring Design Spike](../../issues/12-team-faction-scoring-design-spike.md) without implementation because faction assignment, team scoring, and venue-screen boards are out of scope for WTS 2026.

### Delivery order

1. Implement the accounting/profile foundation, then secure redemption and admin configuration/code operations. The public ops board can start after the foundation.
2. Implement admin support/audit operations and the shared Meta Achievement evaluator.
3. Implement Hi.Events, basic booths, configured events, community activities, static easter eggs, and Session attendance according to their explicit dependencies; higher booth tiers follow basic booths.
4. Before event activation, organizers supply the real September event ID/statuses, selected Session keys/windows, event and Partner Activity artifacts, catalog copy, and active score schedule. These are configuration prerequisites, not unresolved product-architecture decisions.

Exact implementation files, migrations, and activated catalog content belong to the agent-ready delivery work and organizer configuration above. The later-discovered programme agenda prerequisite is resolved separately by `Decide Programme Agenda Data Model And Editorial Operations`.
