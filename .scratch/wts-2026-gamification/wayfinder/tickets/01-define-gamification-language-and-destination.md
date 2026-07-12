# Define Gamification Language And Destination

Status: closed
Assignee: opencode
Labels: wayfinder:grilling
Type: HITL
Created: 2026-07-09
Closed: 2026-07-09
Part of: `.scratch/wts-2026-gamification/wayfinder/MAP.md`

## Question

What exact destination should this Wayfinder map optimize for, and what canonical gamification terms should WTS use before implementation planning continues?

Resolve the boundary between **Achievement**, **Badge**, **Mission**, **Activity Claim**, **XP Event**, **Gamification Profile**, **Verifier**, **Partner Activity**, **Community Partner**, **Faction**, **Leaderboard XP**, and the existing repo term **User**. Decide which terms are user-facing copy, which are implementation/domain names, and which need to be added to domain docs.

## Blocked by

None - can start immediately.

## Resolution

The Wayfinder destination is a decision-ready implementation plan for the full WTS 2026 September conference release, not an MVP, polished PRD rewrite, or implementation pass. The map is complete when the existing delivery slices can be reshaped so implementation agents can build without reopening core terminology, release scope, data/accounting, privacy, or operations decisions.

Resolved terms added to `CONTEXT.md`:

- **Achievement** is the domain/admin term for the configured unlockable accomplishment.
- **Badge** is the user-facing presentation of an unlocked **Achievement**.
- **Mission** is the user-facing gamification activity a **User** completes.
- **Activity Claim** is the evidence that a **User** appears to have completed a gamification activity through a source.
- **XP Event** is the append-only accounting record for XP changes.
- **Gamification Profile** is the per-**User** cached summary/read model for XP, level, progress, and visibility preferences.
- **Leaderboard XP** is the ranking-eligible subset of XP, separate from total XP.
- **Partner Activity** is a sponsor, booth, workshop-host, or community-partner activity redeemed through WTS-controlled automated evidence.
- **Community Partner** is a non-sponsor group or community that can run WTS-linked **Partner Activities**.

Terms intentionally not added as September-release core vocabulary:

- **Verifier** is excluded from the September release vocabulary. Ordinary gameplay should use automated QR/link/code/check-in/puzzle evidence; human correction belongs to admin/support manual awards.
- **Faction** remains pending until `Decide Team/Faction Scoring Scope` decides whether WTS 2026 uses team scoring at all.
