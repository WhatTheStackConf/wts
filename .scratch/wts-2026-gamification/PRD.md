# PRD: WTS 2026 Gamification Layer

Status: ready-for-agent
Type: PRD
Created: 2026-06-06

## Problem Statement

WTS 2026 currently has authentication, User profiles, Hi.Events ticket visibility, public Speaker and Session pages, and admin/reviewer workflows, but it does not yet have the achievement, experience, and real-world gamification layer that existed in the previous edition. The conference needs a system that makes attendance and participation feel more playful, motivates Users to engage with Sessions, workshops, partner booths, community events, and hidden easter eggs, and bridges physical activity at the venue back into the app through QR codes, staff verification, partner verification, and web puzzles.

The previous WTS edition proved the basic shape: achievements, XP, levels, profile display, QR unlocks, and a leaderboard. For WTS 2026, the same concept needs to be rebuilt in a safer and more extensible way. The system must not trust client-supplied User IDs, must not expose secret unlock hashes, must support multiple real-world verification modes, must be fair enough to avoid pay-to-win behavior, and must respect attendee privacy, especially around partner booth scans and lead sharing.

## Solution

Build a WTS 2026 gamification layer modeled around verified activity claims. A User participates in something, evidence is recorded as an activity claim, the server evaluates achievement rules, achievement badges are unlocked, XP events are written to an append-only ledger, and the User's gamification profile is updated for fast display.

The user-facing theme should align with the current profile language: Users are agents, achievements are badges, real-world tasks are missions, QR/code/staff-verified activity is field evidence, XP increases access level, and optional public rankings become the ops board.

The MVP should include a secure XP ledger, achievements, User achievements, activity/code redemption, profile XP and badge display, Hi.Events ticket/check-in achievements, QR mission redemption, admin achievement/code management, booth/partner/workshop activity support, easter egg code support, and opt-in leaderboards. The design should support later additions such as NFC stickers, staff scanner mode, partner verifier accounts, live team/faction scoreboards, attendee-to-attendee scans, physical passports, and richer puzzle mechanics.

## User Stories

1. As a User, I want to see my current XP total, so that I understand my progress through WTS 2026.
2. As a User, I want to see my current level, so that my participation has a visible sense of progression.
3. As a User, I want to see how much XP remains until the next level, so that I know what to aim for next.
4. As a User, I want to see my unlocked achievements on my profile, so that I can remember what I participated in.
5. As a User, I want to see locked or hidden achievements where appropriate, so that I have goals to chase without ruining surprises.
6. As a User, I want recently unlocked achievements to be visible immediately after an action, so that the system feels responsive.
7. As a User, I want achievement names, descriptions, icons, rarity, and XP to be understandable, so that I know why each badge matters.
8. As a User, I want the gamification UI to match the WTS visual identity, so that it feels like part of the conference experience.
9. As a User, I want achievements to use playful agent/mission language, so that the system feels thematic rather than generic.
10. As a User, I want the system to remember my progress across sessions, so that I do not lose credit when I refresh or change devices.
11. As a User, I want duplicate scans to be harmless, so that I do not accidentally inflate or corrupt my progress.
12. As a User, I want achievements to unlock only when I am authenticated, so that my progress is attached to my account.
13. As a User, I want an unauthenticated mission link to send me to login and then resume redemption, so that I do not lose a QR code interaction.
14. As a User, I want to redeem a QR code from a venue poster, so that physical participation can unlock digital progress.
15. As a User, I want to redeem a QR code shown at the end of a Session, so that attending the Session can count toward my progress.
16. As a User, I want to redeem a QR code at a workshop or satellite event, so that activities outside the main conference day count.
17. As a User, I want QR redemption to show what I unlocked, so that the result is clear.
18. As a User, I want QR redemption to tell me if I already redeemed that code, so that repeat scans are not confusing.
19. As a User, I want expired or invalid QR codes to show a clear message, so that I know whether I made a mistake or missed a time window.
20. As a User, I want QR codes to support time-boxed missions, so that event-day activities can remain fair.
21. As a User, I want to earn a booth visit achievement, so that partner exploration is recognized.
22. As a User, I want to earn a booth game participation achievement, so that trying an activity counts even if I do not win.
23. As a User, I want to earn booth activity completion achievements, so that solving a challenge or completing a demo is rewarded.
24. As a User, I want to earn higher-tier booth achievements, so that winning or reaching a high score feels meaningful.
25. As a User, I want booth activities to have multiple tiers, so that I can progress from visit to completion to champion-level outcomes.
26. As a User, I want booth staff to verify high-value activities, so that hard achievements feel legitimate.
27. As a booth staff member, I want to scan a User badge, so that I can award a booth activity result without asking the User to type anything.
28. As a booth staff member, I want to choose a result tier after scanning, so that a booth can award participation, completion, win, or high-score outcomes.
29. As a booth staff member, I want to award only activities for my booth, so that partner verifier permissions remain limited.
30. As a partner, I want multiple achievements for a single booth, so that our activity can have depth without custom application logic.
31. As an organizer, I want booth XP capped and deduplicated, so that one booth cannot dominate the leaderboard unfairly.
32. As a User, I want a workshop attendance achievement, so that deep learning activities count more than casual scans.
33. As a User, I want a workshop completion achievement, so that staying through the meaningful part of the workshop is rewarded.
34. As a workshop organizer, I want an entrance code and an end code, so that completion can be distinguished from simple check-in.
35. As a workshop organizer, I want staff verification as an alternative to public QR codes, so that smaller workshops can use manual confirmation.
36. As a User, I want satellite event attendance to count, so that WTS-adjacent activities feel connected to the conference.
37. As a User, I want warmup event attendance to count, so that pre-conference community participation matters.
38. As a User, I want afterparty or social event attendance to count, so that the full conference experience is recognized.
39. As an organizer, I want event codes to be limited to a time window, so that attendance achievements are not redeemable indefinitely.
40. As an organizer, I want event codes to be scoped to a workshop, satellite event, warmup event, or social event, so that the source of XP is auditable.
41. As an organizer, I want achievements for combinations of events, so that Users can earn meta badges like attending a warmup, the main conference, and an afterparty.
42. As a User, I want partner community achievements, so that community participation beyond commercial booths is recognized.
43. As a community partner, I want limited verifier permissions, so that I can award only my community's activities.
44. As a community partner, I want to publish achievement codes at meetups or in community channels, so that WTS participation can extend before and after the conference day.
45. As a User, I want achievements for participating in multiple partner communities, so that cross-community exploration is encouraged.
46. As a User, I want partner community achievements to be distinct from sponsor booth achievements, so that community contribution does not feel commercialized.
47. As an organizer, I want community partner awards to be auditable, so that accidental or abusive awards can be reviewed.
48. As an organizer, I want community achievements to be configurable without code changes, so that new partners can be added quickly.
49. As a User, I want hidden easter egg achievements, so that curiosity and technical exploration are rewarded.
50. As a User, I want to find an easter egg in browser console messages, so that the website itself becomes playful.
51. As a User, I want to find easter eggs in source, headers, DNS records, robots.txt, or well-known URLs, so that hackery-style exploration is rewarded.
52. As a User, I want to solve a puzzle and redeem a flag, so that easter eggs are more than static QR scans.
53. As a User, I want hidden achievements to have prestige, so that finding them feels special even if XP is modest.
54. As an organizer, I want easter egg codes to be revocable, so that leaked or broken puzzles can be handled.
55. As an organizer, I want easter egg achievements to be hidden until unlocked, so that surprise is preserved.
56. As an organizer, I want some easter eggs to validate answers server-side, so that advanced puzzles cannot be completed by guessing a visible code.
57. As an organizer, I want easter eggs to be safe and non-destructive, so that playful hackery does not encourage harmful behavior.
58. As a User, I want XP events to be based on clear reasons, so that I understand where my points came from.
59. As a User, I want XP to come from participation and achievements, so that progress is earned through conference engagement.
60. As a User, I want paid ticket tier badges to avoid large XP advantages, so that the system does not feel pay-to-win.
61. As a User, I want repeated low-effort actions to be capped, so that the leaderboard rewards broad engagement rather than spam.
62. As a User, I want achievements to remain after leaderboard rules change, so that badges are not lost when scoring is tuned.
63. As a User, I want admin adjustments to be understandable if they affect me, so that corrections do not feel arbitrary.
64. As an organizer, I want an append-only XP ledger, so that every XP change can be audited.
65. As an organizer, I want to void suspicious XP events instead of deleting history, so that investigations preserve context.
66. As an organizer, I want profile totals cached, so that profiles and leaderboards remain fast.
67. As a User, I want to opt in before appearing on an individual leaderboard, so that my participation is private by default.
68. As a User, I want to use a display name for leaderboards, so that my full identity is not exposed by default.
69. As a User, I want to hide some badges from public display, so that I control how much of my activity is visible.
70. As an organizer, I want a team or faction leaderboard, so that public competition can be fun without exposing every individual.
71. As an organizer, I want separate total XP and leaderboard XP, so that admin awards, paid-tier badges, or speaker badges can be excluded from rankings.
72. As an organizer, I want a live team score view later, so that break-time screens can show communal progress.
73. As an admin, I want to create achievements, so that the conference team can define badges without code changes.
74. As an admin, I want to configure achievement categories, XP, rarity, and visibility, so that badges can represent different kinds of participation.
75. As an admin, I want to generate QR/code batches for activities, so that booth, workshop, partner, and easter egg missions can be prepared before the event.
76. As an admin, I want QR/code batches to support max redemptions, per-User limits, active windows, and labels, so that each code matches its real-world use.
77. As an admin, I want to manually award or revoke achievements when needed, so that support cases can be resolved.
78. As an admin, I want manual awards to create audit events, so that manual changes are traceable.
79. As an admin, I want to see User gamification history, so that I can debug support questions.
80. As an admin, I want to see activity-level analytics, so that I know which booths, workshops, and partner activities were used.
81. As an admin, I want to limit staff and partner verifier permissions, so that booth staff cannot award unrelated achievements.
82. As an admin, I want to invalidate a leaked code, so that abuse can be stopped quickly.
83. As an admin, I want to reissue a corrected code, so that an event-day mistake does not block attendees.
84. As a partner, I want attendees to explicitly consent before contact details are shared, so that booth XP is not confused with lead capture.
85. As a User, I want partner scans for XP to be separate from sharing my contact details, so that I can play without unintended data sharing.
86. As a User, I want gamification interactions to work on mobile, so that QR scanning and profile progress work at the venue.
87. As a User, I want redemption screens to be accessible, so that the system works for attendees using assistive technologies.
88. As a User, I want clear fallback instructions if a QR code fails, so that I can ask staff for help.
89. As an organizer, I want the system to degrade gracefully if Hi.Events is temporarily unavailable, so that local achievement redemption can still work.
90. As an organizer, I want Hi.Events ticket and check-in achievements to sync safely, so that ticket-linked and checked-in badges reflect real attendance.

## Implementation Decisions

- Build the feature around an activity claim model. A claim records evidence that something happened; achievement rules evaluate claims; achievement records and XP events are then created.
- Use an append-only XP ledger as the source of truth for XP. Do not calculate XP only by summing unlocked achievements, and do not rely only on a mutable XP field on the User record.
- Maintain a gamification profile per User with cached totals and display preferences for fast profile and leaderboard rendering.
- Use achievements as the narrative layer and XP events as the accounting layer. A User should experience badge unlocks; the system should record auditable XP events with reasons and idempotency keys.
- Support at least these activity claim sources: QR code redemption, staff scan, partner verifier scan, Hi.Events check-in, web puzzle, admin manual award, API/webhook, and attendee-to-attendee scan for future use.
- All user-facing redemption and award flows must derive the User from server-side authentication. The client must never send an arbitrary User ID to receive an achievement or XP.
- Use SolidStart server functions for gamification actions and the existing server-side admin PocketBase service for privileged operations.
- The public PocketBase client should not be able to create achievement unlocks, XP events, activity claims, or redemptions directly.
- Store secret redemption codes as hashes. Do not expose raw unlock hashes in public achievement records.
- Make every award idempotent through stable idempotency keys. Repeating the same scan or claim must not create duplicate XP.
- Model QR/code definitions separately from code redemptions. Codes should support labels, source type, associated achievement or activity, active windows, maximum redemptions, per-User limits, and enabled/disabled state.
- Model user achievements separately from achievements. A user achievement records the User, achievement, unlock time, source, and metadata.
- Model XP events separately from user achievements. XP events record amount, category, source type, source ID, idempotency key, voided state, reason, and metadata.
- Support voiding XP events rather than deleting them. This preserves auditability when correcting abuse or mistakes.
- Cache total XP and leaderboard XP in the gamification profile, while keeping the XP ledger authoritative.
- Track total XP separately from leaderboard XP. Leaderboard XP should be able to exclude admin corrections, paid-tier badges, speaker/admin-only badges, or any category the organizers decide should not rank Users.
- Use non-linear level thresholds so early progress feels fast and later levels require broader engagement.
- Keep XP values small and understandable. Low-effort scans should award small XP; verified completions and meta achievements should award more.
- Avoid pay-to-win scoring. Paid ticket-tier badges may exist, but should award little or no leaderboard XP.
- Support achievement categories such as onboarding, ticketing, attendance, booth, workshop, satellite event, warmup event, community, easter egg, social, meta, and admin/manual.
- Support public, hidden, and retired achievement visibility. Hidden achievements should not reveal details until unlocked.
- Support booth activities with multiple tiers. A booth can award visit, participation, completion, win, high-score, and meta-achievement outcomes.
- Provide a staff scanner mode for booth and event staff. Staff should scan a User badge and then choose from allowed activity outcomes.
- Restrict partner and staff verifiers to only the activities they are authorized to award.
- Keep sponsor lead sharing separate from gamification. A booth scan for XP must not automatically share contact details with the partner.
- Add explicit consent for partner contact sharing when a partner interaction includes lead capture.
- Support workshop and event attendance with one-code or two-code models. Some events can require only a check-in; others can require an entrance and end code to distinguish attendance from completion.
- Support warmup, satellite, afterparty, and partner community activities as first-class event activity types rather than one-off custom logic.
- Support partner community achievements independently from commercial booth achievements.
- Support easter egg achievements through the same code/claim system, with optional server-side answer validation for puzzle-style achievements.
- Integrate Hi.Events ticket and check-in data as claim sources for ticket-linked and checked-in achievements.
- Plan for Hi.Events attendee pagination before relying on attendee fetches for large event-day data volumes.
- Add a profile gamification panel that shows level, XP, progress to next level, unlocked badges, recent unlocks, and a suggested next mission.
- Add a mission redemption route that handles login redirect, validates the code server-side, redeems the claim, evaluates achievements, writes XP events, and shows the result.
- Add an opt-in individual leaderboard. Users should not appear publicly by default.
- Add support for a team/faction leaderboard as a future-friendly model because team competition is less personally exposing and works well on venue screens.
- Add admin management for achievements, activity definitions, code generation, code invalidation, manual awards, manual revocations, and history review.
- Use current WTS copy and visual direction: agent, mission, access level, ops board, field evidence, and badges.
- Add new domain glossary terms after implementation planning: Achievement, Mission, Activity Claim, XP Event, Gamification Profile, Partner Activity, Community Partner, Verifier, Faction, and Leaderboard XP.

## Testing Decisions

- Tests should assert external behavior, not implementation details. A good test should prove that a User action produces the expected redemption result, achievement unlocks, XP events, profile totals, and privacy behavior without depending on internal helper names.
- The highest-value seam is the gamification server-function boundary. Tests should call redemption, summary, leaderboard, admin code generation, and admin/manual award actions as the public contract for the feature.
- The next seam is the award/rule evaluator. If the implementation extracts a pure evaluator, tests should verify that claims produce the correct achievement and XP decisions without touching PocketBase.
- The persistence seam should verify idempotency and auditability. Repeating the same claim should not duplicate achievements or XP events, and voiding an XP event should update totals without deleting history.
- The authentication seam should verify that redemption uses the authenticated User and rejects unauthenticated or spoofed attempts.
- The authorization seam should verify that admins can manage all gamification records, partner verifiers can award only allowed activities, and regular Users cannot directly create claims, user achievements, or XP events.
- The QR/code seam should verify valid code, already-redeemed code, expired code, disabled code, max-redemption code, per-User-limited code, and invalid code behavior.
- The Hi.Events seam should verify ticket-linked and checked-in achievements using controlled attendee data, including no-ticket, ticket-present, checked-in, and API-unavailable cases.
- The booth activity seam should verify visit, participation, completion, win, high-score, and meta-achievement tier behavior.
- The workshop/event seam should verify one-code attendance, two-code completion, active windows, and event-type-specific achievements.
- The partner consent seam should verify that earning XP does not share contact data unless explicit consent is recorded.
- The easter egg seam should verify hidden achievements, static code redemption, server-side answer validation, and invalid answer behavior.
- The profile UI seam should verify that the profile displays XP, level, next-level progress, badges, and recent unlocks based on the summary returned by the server function.
- The leaderboard seam should verify opt-in behavior, display name handling, total XP versus leaderboard XP, and exclusion of non-ranking XP categories.
- The admin UI seam should verify code generation, code invalidation, manual award, revocation/voiding, and history visibility from the admin user's perspective.
- Existing prior art in the codebase includes server functions for admin and reviewer actions, route guards for admin/reviewer authorization, Hi.Events server integration, and profile data loading via resources. New tests should prefer those same high-level seams.
- The repo currently documents manual checks and build verification rather than a full test runner. The implementation should either add an appropriate minimal test seam for gamification logic or, at minimum, keep the core rule evaluator isolated enough to be tested once a test runner is introduced.
- Build verification should include the existing production build command, because the feature touches SolidStart server functions, client/server serialization, PocketBase DTOs, and UI rendering.

## Out of Scope

- Implementing the full feature in this PRD issue.
- Migrating WTS 2025 user achievements or XP into WTS 2026.
- Native mobile applications.
- Purchasing or managing NFC hardware, badge printers, physical passport printing, or venue signage logistics.
- Detailed content design for every booth game, community challenge, workshop, or easter egg puzzle.
- Prize policy, legal terms for competitions, or sponsor reward fulfillment.
- Sponsor CRM integration beyond explicit consent capture and audit-ready data modeling.
- A live event scoreboard screen, except as a future-compatible design consideration.
- Telnet/SSH/game-server infrastructure for hackery easter eggs, except as a future-compatible activity source.
- Real-time anti-fraud operations beyond idempotency, caps, authorization, code invalidation, audit logs, and voiding.
- Replacing Hi.Events ticketing or check-in workflows.
- Public exposure of CFP Submission, reviewer, or private applicant data.

## Further Notes

- The current domain glossary does not yet define the gamification vocabulary. Implementation should add or propose definitions for Achievement, Mission, Activity Claim, XP Event, Gamification Profile, Verifier, Partner Activity, Community Partner, Faction, and Leaderboard XP.
- The design intentionally improves on the previous edition by replacing client-driven unlocks with server-authenticated redemption and hashed code storage.
- The system should reward participation without becoming surveillance. Attendance and scans should be framed as voluntary achievements, not mandatory tracking.
- The first implementation slice should be small: schema, summary action, secure code redemption, XP ledger, profile display, Hi.Events ticket/check-in badges, admin QR/code generation, and opt-in leaderboard.
- Booth tiers, staff scanner mode, partner community verifiers, easter egg validation, and team/faction scoring can be implemented as follow-up slices using the same claim and XP event model.

## Comments

- Created from the WTS 2026 gamification planning conversation and published locally because the repo is using the `.scratch` local issue strategy for this PRD.
