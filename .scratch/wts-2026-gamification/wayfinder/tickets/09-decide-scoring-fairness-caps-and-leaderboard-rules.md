# Decide Scoring, Fairness, Caps, And Leaderboard Rules

Status: closed
Assignee: OpenCode
Labels: wayfinder:grilling
Type: HITL
Created: 2026-07-09
Closed: 2026-07-09
Part of: `.scratch/wts-2026-gamification/wayfinder/MAP.md`

## Question

What scoring rules make XP motivating without making the system feel pay-to-win, spammy, or invasive?

Decide level thresholds, XP value bands, total XP versus **Leaderboard XP**, excluded categories, exact ticket-present/check-in XP values within the Hi.Events semantics already decided, booth/activity caps, repeated low-effort limits, manual/admin correction handling, hidden/easter egg weighting, ranking behavior for the already-decided opt-out public ops board, and how rule changes affect existing **Achievements**. Do not reopen the decision that September has no paid ticket tier **Achievements**.

## Settled Inputs

- Each Partner Activity outcome is a distinct Activity with a normally-one per-User claim limit; reissued/different codes for that same Activity cannot create another claim, Badge, or XP award.
- Activity, partner, category, day, and conference cap keys constrain XP after legitimate evidence is accepted. A cap never deletes the accepted **Activity Claim** or its Badge result; it limits only total XP and/or **Leaderboard XP**, potentially to zero, with an auditable cap outcome.
- This ticket chooses cap dimensions, windows, values, and user-facing treatment. It must not reintroduce partner/staff scanners, verifier accounts, or a cap rule that treats valid evidence as an invalid redemption.
- The passive main-conference Mission has only `conference.main.ticket_present` and `conference.main.checked_in`. Ticket-present remains total-XP-only; check-in is the sole main-conference evidence that may receive a bounded **Leaderboard XP** value. Neither is a paid-tier signal.
- Each selected Session has one attendance Activity; selected booth experiences have independently evidenced `visit`, `participation`, `completion`, `win`, and/or `high_score` slots; workshops and events use one attendance Activity or an explicitly configured start/finish pair; Community Partner programmes use selected attendance/participation/completion Activities; static easter eggs use one discovery Activity. Values must be bounded by source family and must not reward code delivery form, repeat scans, external clicks/forms, or consent.
- Booth outcomes and two-code start/finish claims are related activity groups. Decide their activity/partner/category/day/conference caps so one booth or a start-plus-finish sequence cannot dominate broad participation, while retaining valid claims and Badges after XP is capped.
- Meta rules use only accepted, non-voided claims and award once. Cross-Session, cross-booth, and cross-community rules must select one qualifying Activity per source entity, not count multiple tiers from one entity as exploration diversity. Source claims whose XP was capped remain eligible for configured Badge/meta rules.
- Workshops, warmups, satellites, socials, Community Partner programmes, and easter eggs are optional configured slots, not promised content. Score their configured categories independently so surrounding activity, one leaked easter-egg set, or one Community Partner cannot decide the ops board.
- Admin manual awards are exceptional, admin-only accounting actions rather than Missions. Their default **Leaderboard XP** remains zero; any ranking effect requires the existing explicit high-impact confirmation. Partner contact consent always has zero gameplay value.

## Blocked by

- `.scratch/wts-2026-gamification/wayfinder/tickets/02-decide-september-conference-release-scope.md`
- `.scratch/wts-2026-gamification/wayfinder/tickets/03-decide-core-accounting-and-data-model.md`
- `.scratch/wts-2026-gamification/wayfinder/tickets/05-decide-profile-redemption-and-ops-board-ux-boundaries.md`
- `.scratch/wts-2026-gamification/wayfinder/tickets/06-decide-hievents-awarding-semantics.md`
- `.scratch/wts-2026-gamification/wayfinder/tickets/08-decide-automated-partner-activity-and-consent-model.md`
- `.scratch/wts-2026-gamification/wayfinder/tickets/12-decide-september-mission-inventory.md`

## Resolution

September uses a small, one-off score schedule. It has no fixed conference-wide numeric ceiling: the September scoring schedule calculates total-XP and **Leaderboard XP** caps from the active score policies in the configured inventory. Only active, score-bearing September policies count. Draft, retired, disabled, total-only, nonranking, and historic policies do not enlarge a ranking cap.

### Direct score policies

Each configured Activity has one direct total-XP/**Leaderboard XP** policy. QR, WTS link, manual-code, and reissued-code delivery forms redeem the same Activity and cannot multiply its policy. A direct Badge may be unlocked by the accepted claim, but the claim and Badge do not produce separate direct XP awards.

| Source family and outcome | Total XP | Leaderboard XP | Rule |
| --- | ---: | ---: | --- |
| Main conference `ticket_present` | 10 | 0 | One per User; never a ticket-tier or price signal. |
| Main conference `checked_in` | 20 | 10 | One per User; the only main-conference source eligible for Leaderboard XP. |
| Selected Session attendance | 20 | 15 | One per configured Session Activity. |
| Booth visit | 5 | 5 | Independent evidence only. |
| Booth participation | 10 | 10 | Independent evidence only. |
| Booth completion | 20 | 15 | Independent evidence only. |
| Booth win | 30 | 25 | Requires the configured WTS-controlled outcome artifact. |
| Booth high score | 35 | 25 | Requires the configured WTS-controlled outcome artifact. |
| One-code workshop, warmup, satellite, or social attendance | 30 | 25 | One Activity and one attendance result. |
| Two-code event start | 10 | 5 | May unlock a configured attendance Badge, but never completion. |
| Two-code event finish | 0 | 0 | Accepted evidence only; it completes no score by itself. |
| Two-code completion after accepted start and finish | 30 | 25 | One derived completion award, so the related event group is capped at 40/30. |
| Community Partner attendance | 20 | 15 | One configured programme Activity. |
| Community Partner participation | 25 | 20 | One configured programme Activity. |
| Community Partner completion | 30 | 25 | One configured programme Activity. |
| Static easter-egg discovery | 10 | 0 | Hidden discovery remains total-XP-only. |
| Meta explorer across two or three designated source entities | 20 | 15 | One award per configured Meta Achievement. |
| Meta circuit across four or more designated sources or categories | 30 | 25 | One award per configured Meta Achievement. |
| Meta milestone across five or more designated sources, or a configured cross-category conference circuit | 40 | 30 | One award per configured Meta Achievement. |

Meta configuration must select the appropriate band from this table and validate the stated source breadth. A cross-Session, cross-booth, or cross-community meta selects at most one designated qualifying Activity per Session, sponsor, or Community Partner programme. Every Meta Achievement evaluates accepted, non-voided source claims, including source claims whose XP was reduced to zero by a cap.

### Dynamic cap schedule

The admin activates a versioned September score schedule after the score-bearing inventory is configured. It records each policy, its cap membership, and the calculated ceilings so support can explain an award. Total XP and **Leaderboard XP** are capped independently; the same formula is applied to both columns.

| Cap dimension | Ceiling rule |
| --- | --- |
| Activity | The direct policy above, with the normal one accepted Activity Claim per User across every code, delivery form, and reissue. |
| Related group | A booth group is its highest enabled outcome policy, up to 35/25. A one-code event group is 30/25; a two-code event group is 40/30. A one-code Community Partner programme is its highest enabled outcome policy, up to 30/25; an approved two-code community programme is 40/30. |
| Partner | All sponsor booth groups linked to one sponsor share the highest active booth-group ceiling, up to 35/25. All Community Partner programmes linked to one Community Partner share the highest active community-group ceiling, up to 30/25 or 40/30 for an approved two-code programme. A workshop-host relation is attribution only; its event-group ceiling still applies per event. |
| Category | Sum the active standalone Activity ceilings and distinct related-group/partner ceilings in that category. The category therefore grows only with configured one-off sources, not scans, attempts, codes, or consent actions. |
| Conference day | Sum the distinct group and standalone Activity ceilings assigned to that calendar day in the active schedule. Each score-bearing Activity has one configured score day; a multi-day Activity belongs to only one day bucket. Static easter eggs have no day bucket unless organizers deliberately assign one. |
| Conference | Sum the active category ceilings, including the active meta policies. This is the dynamic September maximum, not a hard-coded number. |

For an accepted claim, the evaluator first unlocks direct Badge eligibility and evaluates affected metas, then calculates the remaining amount in every applicable Activity, related-group, partner, category, day, and conference cap. It writes only the remaining total XP and **Leaderboard XP**, which may differ or be zero. A zero-result cap outcome is retained on the Activity Claim and admin audit trail rather than being presented as a failed redemption; no zero-value XP Event is needed when both amounts are zero.

Every configured Activity remains normally one claim per User. Repeated scans, code attempts, external clicks/forms, reissues, raw-code distribution, consent actions, and support interactions cannot add claims, Badge eligibility, total XP, or **Leaderboard XP**. Partner contact consent always has zero gameplay value.

### Evidence, Badge, and XP treatment

- Legitimate evidence is accepted before score caps are evaluated. A cap never invalidates an **Activity Claim**.
- An accepted Activity Claim evaluates its direct **Achievement** and may unlock the Badge even when the resulting total XP and **Leaderboard XP** are both zero.
- An accepted, cap-exhausted claim remains eligible for the configured Meta Achievements. Meta source selection counts one designated Activity per source entity, not every outcome tier at a booth or programme.
- A **Gamification Profile** sums only non-voided XP Events. It can therefore show total XP and access level progress from capped awards while retaining Badges whose related score was zero.
- Ticket-present, static easter eggs, Badge-only manual awards, and every policy configured as total-only have `Leaderboard XP = 0`. Ticket price, tier, product metadata, partner contact consent, external activity, raw-code handling, and support operations have no score at all.

### Access levels

The access-level ladder uses total XP, not **Leaderboard XP**, so private or nonranking participation still progresses the owning User. The activated September schedule calculates the conference total-XP ceiling; level thresholds are rounded up from that ceiling and recorded with the schedule:

| Access level | Threshold |
| --- | ---: |
| Access Level 1 | 0% |
| Access Level 2 | 5% |
| Access Level 3 | 15% |
| Access Level 4 | 30% |
| Access Level 5 | 50% |
| Access Level 6 | 75% |
| Access Level 7 | 100% |

This preserves the PRD's fast early progress and requires broad participation for later levels. September uses the ordinal `Access Level 1` through `Access Level 7` labels; themed level names remain catalog copy, not a scoring decision. The first score-bearing schedule fixes the ladder for the conference. A later successor Activity can award prospectively under its own versioned policy and expand future cap capacity, but it never lowers a User's earned level or recalculates historic XP.

### Ops-board ranking

- Individual ops-board visibility remains opt-out by default. A public row contains only the already-decided safe display name, access level, **Leaderboard XP**, rank, and allowed public Badge snippets. It never exposes total XP, ticket data, Activity Claims, source history, partner or Community Partner activity, consent, code material, or private evidence.
- Sort visible Users by non-voided **Leaderboard XP** descending. Equal totals share a competition rank (`1, 1, 3`); no private activity, total XP, time reached, Badge count, or other secondary criterion breaks a tie. A stable internal record ID may order equal rows only for pagination and is never displayed as a tie-break.
- Award, void, correction, and cache-rebuild actions rebuild the affected **Gamification Profile** before returning. `/ops-board` reads the profile cache on the next request; it needs no push channel, and may refresh at most once per minute plus a User-requested refresh.
- Excluded ranking value is zero rather than hidden arithmetic: ticket-present, static easter eggs, all total-only policies, manual awards and corrections by default, voided XP, and XP removed by any Leaderboard XP cap do not affect rank. Opting out removes the row and its rank without changing any Claim, Badge, XP Event, or access level.

### Admin exceptions and later changes

- Admin manual awards are exceptional, single-User accounting actions. A Badge-only award defaults to 0/0. A supported missed-evidence remediation may use the missed Activity's total-XP policy but still defaults to zero **Leaderboard XP**. Signed positive or negative corrections also default to zero **Leaderboard XP**.
- A nonzero ranking change is permitted only to correct an identified WTS automation, source-sync, or prior-accounting error for a concrete configured Activity. It must match the original Activity's leaderboard policy/cap outcome, identify the source/support reference, carry a required reason, and receive the existing separate high-impact confirmation. Honorary, goodwill, partner/staff-requested, consent, contact, or routine support awards cannot change rank.
- Once a score-bearing Activity has accepted evidence, its policy, cap membership, source relationship, and Badge rule are not edited in place. Admins retire it and create a successor with an audited effective date and reason. A scoring-policy change affects only future claims under the successor; it does not reprice, backfill, void, or strip existing accepted Activity Claims, Badges, or XP Events.
- Retiring or disabling a definition stops future evidence but leaves prior records intact. A void or source correction removes only the explicitly voided XP from totals and rank and revokes a Badge only if the underlying Achievement no longer has accepted supporting evidence. It does not automatically reflow capacity into earlier cap-exhausted claims. An exceptional accounting mistake is corrected through the audited manual correction path.
- A **Gamification Profile** rebuild reads the recorded non-voided XP Events and non-revoked Badges; it does not rerun historic policy calculations. It preserves ops-board visibility, display name, Badge privacy, and access level progress derived from the fixed schedule thresholds.
