# Wayfinder Map: WTS 2026 Gamification Layer

Status: closed
Labels: wayfinder:map
Created: 2026-07-09
Closed: 2026-07-09

## Destination

Find the decision-ready route from the existing gamification PRD to implementable WTS 2026 September conference delivery slices. The map is complete when domain language, September release scope, data/accounting, security, privacy, UX, ops, scoring, programme agenda data, integration, and delivery-ticket boundaries are clear enough that implementation agents can build the full conference release without reopening product architecture.

## Notes

- This map is local markdown because `.scratch/wts-2026-gamification/PRD.md` was published locally and already has local issue briefs.
- The canonical source PRD is `.scratch/wts-2026-gamification/PRD.md`.
- Existing files in `.scratch/wts-2026-gamification/issues/` are delivery slices, not Wayfinder decision tickets. They were reshaped when this map cleared and are the downstream implementation references.
- Wayfinder tickets live in `.scratch/wts-2026-gamification/wayfinder/tickets/` and use `Blocked by` lines as the local dependency fallback.
- Use `CONTEXT.md` vocabulary, especially **User**, and add gamification terms as a domain-doc follow-up instead of inventing conflicting names.
- Planning only by default: resolve decisions and reshape delivery tickets, but do not implement gamification unless a later note changes the destination.
- This is not an MVP planning effort. Optimize for the full WTS 2026 conference release in September, with delivery slices sized for agents.
- Prefer automated QR/link/code/check-in/static-puzzle flows over human intervention. Use audited admin/support manual awards where a required conference scenario cannot be made fair or supportable through automated evidence.
- `Verifier` is not a September-release domain term. Ordinary gameplay should use automated evidence; human correction belongs to admin/support manual awards.
- The programme agenda is a prerequisite data model for published Session scheduling and Session Mission configuration. It must remain schedule context, never proof of attendance or an automatic gamification award.
- Relevant repo guidance: `docs/agent-guidelines/solidstart-typescript.md`, `docs/agent-guidelines/pocketbase.md`, `docs/agent-guidelines/styling.md`, and `docs/agent-guidelines/issue-workflow.md`.

## Decisions so far

- [Define Gamification Language And Destination](tickets/01-define-gamification-language-and-destination.md) — the map targets a decision-ready implementation plan for the full September conference release; core gamification terms were added to `CONTEXT.md`, `Verifier` was excluded from September vocabulary, and `Faction` was deferred to release-scope work.
- [Decide September Conference Release Scope](tickets/02-decide-september-conference-release-scope.md) — September includes the full automated conference gamification release with opt-out individual ops board, automated partner/event Missions, broad audited admin manual awards, static easter eggs, and no team/faction, verifier-account, or peer-scan scope for WTS 2026.
- [Decide Core Accounting And Data Model](tickets/03-decide-core-accounting-and-data-model.md) — September uses configured Achievements/Missions/Activities/Codes plus server-only claims, Badge unlocks, XP ledger, and profile cache; Activity Claims and XP Events are authoritative while no verifier, peer-scan, team/faction, or puzzle-validator records are added.
- [Decide Secure Mission Redemption Model](tickets/04-decide-secure-mission-redemption-model.md) — Mission redemption uses `/missions/redeem` with fragment bearer codes, HMAC+prefix lookup, auth resume without raw-code redirects, server-derived Users, idempotent server-only accounting writes, safe public result DTOs, rate limits, and admin invalidation/reissue support.
- [Decide Profile, Redemption, And Ops Board UX Boundaries](tickets/05-decide-profile-redemption-and-ops-board-ux-boundaries.md) — September UX is limited to `/user/profile` Gamification Profile summary, `/missions/redeem` redemption, and public `/ops-board`, with Badge states, auth resume, mobile fallback, accessibility, opt-out visibility, display names, public snippets, and DTO privacy boundaries decided.
- [Decide Hi.Events Awarding Semantics](tickets/06-decide-hievents-awarding-semantics.md) — Hi.Events creates only ticket-present and checked-in Activity Claims for normalized-email matches, with lazy profile refresh plus admin paginated sync, no paid-tier Achievements, ticket XP excluded from Leaderboard XP, check-in XP fixed and leaderboard-eligible, source-driven corrections, and strict profile/ops-board/admin privacy boundaries.
- [Decide Admin Operations And Audit Model](tickets/07-decide-admin-operations-and-audit-model.md) — September uses one admin-only gamification operations surface for audited configuration, one-time code lifecycle, single-User corrections/cache rebuilds, and complete paginated Hi.Events reconciliation; no delegated verifier/support accounts or bulk manual operations.
- [Decide Automated Partner Activity And Consent Model](tickets/08-decide-automated-partner-activity-and-consent-model.md) — Partner Activities use admin-configured WTS evidence and exceptional admin support only; optional, per-activity name/email consent is separately auditable, withdrawable, and never affects gamification.
- [Decide September Mission Inventory](tickets/12-decide-september-mission-inventory.md) — September uses configurable passive main-conference, Session, sponsor, event, Community Partner, static-easter-egg, and meta inventory slots with WTS-only evidence, explicit source references, bounded scoring inputs, and admin-only exceptions.
- [Decide Scoring, Fairness, Caps, And Leaderboard Rules](tickets/09-decide-scoring-fairness-caps-and-leaderboard-rules.md) — active policy sums produce versioned dynamic caps; one-off score bands, access levels, capped evidence/Badge treatment, opt-out ranking, and exceptional admin corrections are fixed for September.
- [Reshape Delivery Issues From Wayfinder Outcomes](tickets/11-reshape-delivery-issues-from-wayfinder-outcomes.md) — delivery briefs now cover the full September architecture with shared Meta and Session slices, corrected dependencies, and the faction spike closed as out of scope.
- [Decide Programme Agenda Data Model And Editorial Operations](tickets/15-decide-programme-agenda-data-model-and-editorial-operations.md) — the public programme uses Days, day-specific Tracks, and typed Slots; schedule context supports Session Mission configuration but never awards gamification evidence.

## Not yet specified

- Organizer-supplied catalog configuration: real Achievement/Badge copy, iconography, rarity, selected Sessions, event details, Partner Activity artifacts, and score-schedule activation inputs. These are delivery prerequisites, not product-architecture decisions.
- Event-day operating runbook, staff training notes, and fallback procedures. The delivery briefs define the required behavior; the real September programme and operating ownership are still needed to write the runbook.

## Out of scope

- Implementing the gamification feature during this Wayfinder run.
- Migrating WTS 2025 achievements, XP, or unlock history into WTS 2026.
- Native mobile apps, NFC hardware, badge printers, physical passports, venue signage procurement, and prize/legal policy.
- Sponsor CRM integration beyond explicit consent capture and audit-ready data boundaries.
- Team/faction scoring, faction assignment, and public team/faction scoreboard views for WTS 2026.
- Partner/staff verifier accounts and routine scanner-based awarding flows for WTS 2026.
- Attendee-to-attendee scan Missions for WTS 2026.
- Server-side puzzle answer validation for the September release; it remains only a conditional post-conference candidate if implementation capacity allows.
- Telnet, SSH, game-server, or destructive hackery infrastructure for easter eggs.
- Real-time anti-fraud operations beyond baseline idempotency, caps, authorization, code invalidation, audit logs, and voiding.
