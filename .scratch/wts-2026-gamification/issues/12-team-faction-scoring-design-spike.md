# Team/Faction Scoring Design Spike

Status: ready-for-human
Type: HITL
Created: 2026-06-06

## Parent

`.scratch/wts-2026-gamification/PRD.md`

## What to build

Decide how team or faction scoring should work before implementation. This is a human-in-the-loop design spike because it requires event identity and experience decisions, not only technical execution. The output should define faction names, assignment rules, public display expectations, scoring rules, privacy implications, and whether team XP mirrors or weights personal XP.

This slice should produce a decision-ready specification that can become one or more AFK implementation issues later.

## Acceptance criteria

- [ ] Faction or team names are chosen or a decision is made not to use factions for WTS 2026.
- [ ] The User assignment model is defined, such as random assignment, self-selection, ticket-based assignment, or admin assignment.
- [ ] The scoring model is defined, including whether team XP mirrors personal XP or uses separate weighting.
- [ ] The relationship between team XP, total XP, and leaderboard XP is clarified.
- [ ] Privacy expectations for public team scoring are documented.
- [ ] Venue-screen or live ops-board expectations are documented if this is planned for event day.
- [ ] Abuse and fairness concerns are listed with mitigations.
- [ ] The resulting decision is recorded in a follow-up issue, ADR, or PRD comment.
- [ ] No implementation work is required to complete this spike unless a small prototype is explicitly requested.

## Blocked by

- `.scratch/wts-2026-gamification/issues/05-opt-in-ops-board-leaderboard.md`
