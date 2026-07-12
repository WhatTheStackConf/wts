# Configured Workshop And Surrounding Event Missions

Status: ready-for-agent
Type: AFK
Created: 2026-06-06

## Parent

`.scratch/wts-2026-gamification/PRD.md`

The closed decisions in `.scratch/wts-2026-gamification/wayfinder/MAP.md` supersede conflicting PRD text.

## What to build

Support configured event Activities for workshops, warmups, satellite events, socials, and related WTS activities. An event may have an optional host-partner attribution, but WTS-run events are not **Partner Activities** by default. Admins configure WTS-controlled one-code attendance or two-code start/finish completion evidence. Users earn attendance or completion Badges through authenticated Mission redemption; event-day exceptions use audited admin support, not staff verification.

This slice should let WTS connect the main conference day with surrounding events without creating one-off custom code for each event.

Inventory constraint: every non-Session event uses an organizer-configured immutable event reference (`eventKey`, kind, title, operating window), not `timeline_events` or the unused generic `events` helpers. Workshops explicitly support one-code attendance or two-code start/finish completion; warmup, satellite, and social slots are configured only when organizers supply a real event and may use the same model when justified.

## Acceptance criteria

- [ ] Admins can configure an event-scoped Mission/Activity for a workshop, warmup event, satellite event, or social event with event reference, optional host partner relation, outcome, evidence role/channel, active window, limits, cap key, and Achievement rules.
- [ ] One-code attendance uses a `single_code` Activity and WTS-controlled QR/link/manual-code evidence in its configured window.
- [ ] Two-code completion uses distinct `two_code_start` and `two_code_finish` Activities/Codes. Completion unlocks only when both accepted Activity Claims satisfy the configured claim-set rule; a start claim may separately unlock a configured attendance Badge but never implies completion.
- [ ] Two-code evidence has no hidden code-order rule. Two-code flows outside workshops are enabled only when organizers explicitly approve them.
- [ ] Event mission codes can be time-boxed to an active window.
- [ ] A User can redeem an event Mission code and receive the configured attendance Badge and XP idempotently.
- [ ] A User can complete a two-code flow and receive a completion Badge and XP idempotently; reissued/different codes cannot bypass per-Activity User limits.
- [ ] A User who has only one claim from a two-code flow does not receive the completion Badge.
- [ ] One-code attendance awards 30 total XP / 25 **Leaderboard XP**. A two-code flow awards 10/5 from start, 0/0 from finish, and one 30/25 completion award only after both claims, with a related-event ceiling of 40/30.
- [ ] Event category, day, and conference ceilings are derived from distinct active event-group policies at score-schedule activation; a completed event cannot be counted as two full attendances.
- [ ] No workshop/staff verifier or scanner flow is added. Hosts receive no WTS User lookup, raw-code, award, or code-management access; a legitimate exception can be resolved only through the audited admin manual-award path.
- [ ] Hi.Events unavailability or failure never blocks local event QR/link/code redemption.
- [ ] Event Activities can register as qualifying sources for cross-event Meta Achievements, such as a warmup, main conference check-in, and afterparty circuit.
- [ ] Event Activities register their configured meta eligibility with the shared evaluator from issue 13; this brief does not create event-specific meta accounting.
- [ ] Public/internal Mission visibility, active windows, and WTS-controlled artifact deployment are configured independently; internal events are not surfaced as public suggestions.
- [ ] Tests cover one-code and two-code evidence, no start-only completion, reissue limits, no code-order requirement, total/ranking cap treatment, source-specific unavailable isolation, and safe DTOs.
- [ ] The build completes successfully.

## Blocked by

- `.scratch/wts-2026-gamification/issues/01-september-gamification-accounting-foundation-and-profile-read-model.md`
- `.scratch/wts-2026-gamification/issues/02-secure-mission-code-redemption.md`
- `.scratch/wts-2026-gamification/issues/03-admin-gamification-configuration-and-code-operations.md`
- `.scratch/wts-2026-gamification/issues/11-admin-manual-awards-and-audit-history.md`
- `.scratch/wts-2026-gamification/issues/13-shared-meta-achievement-evaluator.md`
