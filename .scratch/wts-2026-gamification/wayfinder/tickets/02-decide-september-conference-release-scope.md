# Decide September Conference Release Scope

Status: closed
Assignee: OpenCode
Labels: wayfinder:grilling
Type: HITL
Created: 2026-07-09
Closed: 2026-07-09
Part of: `.scratch/wts-2026-gamification/wayfinder/MAP.md`

## Question

What is the full WTS 2026 gamification release that should ship for the September conference, and which PRD capabilities are still out of scope for this year?

Decide whether the September conference release includes profile XP/badges, secure QR mission redemption, Hi.Events ticket/check-in badges, admin code generation, opt-in individual leaderboard, booth activity support, workshops/satellite events, community achievements, easter eggs, manual admin corrections, and team/faction scoring. The answer should classify each capability as September release, post-conference, or out of scope for WTS 2026, and should prefer QR/link/code/check-in/puzzle flows over human intervention.

## Blocked by

None - can start immediately.

## Resolution

September is the full conference release, not an MVP. The release should ship the full automated gamification layer needed for event-day use, with QR/link/code/check-in/static-puzzle evidence preferred over routine human verification.

September release capabilities:

- **Gamification Profile**, XP total, level/access-level progress, Badge display, recent unlocks, locked/hidden Badge treatment, and suggested next Missions are in scope.
- **Secure Mission redemption** is in scope for QR, link, and code flows. Redemption must derive the **User** from server-side authentication, resume after login, store secret codes hashed, enforce active windows, max-redemption limits, per-User limits, disabled/expired states, and idempotent repeated scans.
- **Hi.Events ticket and check-in evidence** is in scope for ticket-linked and checked-in Achievements. Exact matching, outage behavior, paid-tier treatment, and XP weighting remain for `Decide Hi.Events Awarding Semantics` and `Decide Scoring, Fairness, Caps, And Leaderboard Rules`.
- **Admin achievement and mission/code management** is in scope, including Achievement configuration, activity/Mission definitions, code generation, invalidation, reissue, history/debug views, analytics useful for event operations, and audit logs.
- **Manual admin awarding and corrections** are in scope as broad audited admin tools. They may award arbitrary Achievements and support revocation or XP voiding, but ordinary gameplay should still prefer automated evidence instead of human verification.
- **Individual ops board / leaderboard** is in scope and should be visible by default with opt-out controls, safe display names, Leaderboard XP exclusions, and privacy controls. This replaces the earlier PRD assumption that the board is opt-in.
- **Automated Partner Activities** are in scope for sponsor booths, workshops, community partners, and related event activities. They should use WTS-admin generated QR/link/code/static-puzzle evidence, caps, duplicate handling, audit metadata, and consent separation instead of partner/staff verifier accounts.
- **Booth activity tiers** are in scope for configurable visit, participation, completion, win, high-score, and meta outcomes, implemented through distinct automated evidence where possible.
- **Workshops, warmups, satellite events, community meetups, and social/afterparty events** are in scope as first-class event activity types, with configurable one-code and two-code attendance/completion flows.
- **Community partner Achievements** are in scope and should stay distinct from sponsor booth Achievements.
- **Static easter egg Missions** are in scope through hidden QR/link/code Missions, including safe browser/source/header/URL-style discoveries, revocable codes, and hidden-until-unlocked Achievements.

Post-conference or conditional follow-up:

- Server-side puzzle answer validation is not September scope. Keep it as a conditional post-conference candidate only if the rest of implementation lands cleanly.

Out of scope for WTS 2026:

- Team/faction scoring, faction assignment, and public team/faction scoreboard views.
- Partner/staff verifier accounts and routine scanner-based awarding flows.
- Attendee-to-attendee scan Missions.
- Native mobile apps, NFC hardware, badge printers, physical passports, venue signage procurement, prize/legal policy, sponsor CRM integration beyond explicit consent capture and audit-ready data boundaries, telnet/SSH/game-server/destructive hackery infrastructure, and real-time anti-fraud operations beyond the baseline controls already named in the map.
