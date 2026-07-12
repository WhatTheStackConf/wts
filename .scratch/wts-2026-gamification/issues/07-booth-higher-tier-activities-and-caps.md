# Booth Higher-Tier Activities And Caps

Status: ready-for-agent
Type: AFK
Created: 2026-06-06

## Parent

`.scratch/wts-2026-gamification/PRD.md`

The closed decisions in `.scratch/wts-2026-gamification/wayfinder/MAP.md` supersede conflicting PRD text.

## What to build

Extend booth gamification with optional higher-tier outcomes and configured caps. `win` and `high_score` are distinct Activities with outcome-specific WTS-controlled evidence, not staff-selected scanner results. A booth assertion alone is not automated evidence; if WTS cannot operate a fair outcome artifact, the exception remains an audited admin manual award.

This slice should make booth games richer without changing the core claim and XP ledger model.

Inventory constraint: `win` and `high_score` are optional slots on an existing configured booth Mission, not promised content for every sponsor. Generic Meta Achievement evaluation belongs to issue 13; this brief only registers the direct higher-tier Activities and their cap membership.

## Acceptance criteria

- [ ] Booth Activities can define `win` and `high_score` as distinct higher-tier outcomes with separate keys, evidence artifacts, Achievement rules, per-User limits, and cap keys.
- [ ] A high-tier automatic claim is accepted only from a WTS-controlled outcome-specific artifact. Partners/staff have no scanner, tier-selection endpoint, raw-code access, or ability to create a claim; legitimate exceptions use the existing audited admin manual award path.
- [ ] Higher-tier outcomes can award different configured Badge, total-XP, and **Leaderboard XP** results without inferring lower-tier claims.
- [ ] Awarding a higher-tier outcome is idempotent for the relevant User and Activity, including across reissued codes.
- [ ] Booth-related XP can be capped by activity, partner, category, day, or conference boundary through cap keys, with total-XP and **Leaderboard XP** evaluated independently.
- [ ] An exhausted cap leaves valid Activity Claims and Badge unlocks intact while limiting subsequent XP; admin support can see the applied cap and resulting XP without exposing it publicly.
- [ ] The leaderboard uses capped or category-aware XP according to configured rules.
- [ ] Booth `win` and `high_score` use 30/25 and 35/25 total-XP/**Leaderboard XP** policies. A booth group, and all booth groups for the same sponsor, share the highest active group cap, up to 35/25; valid lower outcomes and their Badges remain accepted when that cap is exhausted.
- [ ] Booth category, day, and conference ceilings are derived at score-schedule activation by summing distinct active sponsor group ceilings, never by scan, code, consent, or attempt count.
- [ ] The User profile displays higher-tier Badges correctly without exposing source evidence or cap diagnostics.
- [ ] Tests cover WTS-controlled high-tier evidence, idempotency across reissue, independent total/ranking caps, and preserved Claims/Badges after cap exhaustion.
- [ ] The build completes successfully.

## Blocked by

- `.scratch/wts-2026-gamification/issues/06-booth-activity-verification-with-consent.md`
