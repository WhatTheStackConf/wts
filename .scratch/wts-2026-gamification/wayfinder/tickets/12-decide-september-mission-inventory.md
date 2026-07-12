# Decide September Mission Inventory

Status: closed
Assignee: OpenCode
Labels: wayfinder:grilling
Type: HITL
Created: 2026-07-09
Closed: 2026-07-09
Part of: `.scratch/wts-2026-gamification/wayfinder/MAP.md`

## Question

What concrete Mission inventory should the September conference release plan around now that all event and Partner Activity types are in scope?

Decide the known or expected Mission inventory across main conference attendance, Session QR Missions, the already-decided Hi.Events ticket-present and checked-in evidence, sponsor booths, booth tiers, workshops, warmups, satellite events, community meetups, social/afterparty events, community partner Achievements, static easter eggs, and admin/manual correction cases. The answer should produce enough inventory shape for implementation agents to configure activity types and for later scoring/catalog tickets to assign XP bands, caps, names, copy, icons, and rarity without reopening release scope or adding paid ticket tier Achievements.

## Blocked by

- `.scratch/wts-2026-gamification/wayfinder/tickets/06-decide-hievents-awarding-semantics.md`

## Resolution

September uses a configuration-ready inventory of slots, not a guessed conference programme. Braced values below are immutable organizer-supplied configuration keys, never real partner, event, or Session names. A **Mission** is the User-facing grouping and progress copy; an **Activity** is one atomic evidence/outcome record. QR, WTS-controlled link, and manually typed code are three delivery forms for the same generated bearer evidence. They do not create separate Activities.

Every active Activity has one evidence mode, one per-User claim limit, active window, cap key, Badge rule, and source reference. Once it has accepted **Activity Claims**, its key, evidence mode, outcome, source relation, cap group, and accounting policy are retired and replaced rather than edited. Raw codes remain WTS-admin generated and one-time exported; partners, hosts, staff, and Community Partners receive no raw-code, scanner, User lookup, support, or award capability.

### Reference boundaries

- Session Activities relate to an existing published `sessions` record. The Activity key is an immutable admin key, not a mutable Session slug. Existing Session records do not provide an end time or attendance window, so organizers must configure the redemption window and deployment point separately.
- Sponsor booth and Community Partner Activities relate to an existing `partners` record where an organization needs attribution. `partnerKind` is gamification configuration (`sponsor`, `community_partner`, or `workshop_host`), not a permission grant and not inferred from public partner presentation or tier.
- Workshops, warmups, satellite events, and socials require an organizer-configured event reference with an immutable `eventKey`, event kind, display title, and operating window. It is not a relation to `timeline_events` and must not rely on the unused generic `events` helpers because neither is a public-event inventory.
- Main-conference Hi.Events evidence relates only to the configured September Hi.Events event ID. Session, booth, workshop, Community Partner, and easter-egg Activities never use Hi.Events evidence.

### Main Conference Attendance

- Configure one passive `conference.main` Mission for profile progress, not manual redemption or a suggested Mission. It groups exactly two Activities: `conference.main.ticket_present` with outcome `ticket_present` and `hievents_ticket` evidence; and `conference.main.checked_in` with outcome `checked_in` and `hievents_checkin` evidence.
- Both Activities point at the configured main-conference event ID. Eligible ticket states, normalized-email matching, pagination, correction, and outage behavior remain exactly those in [Decide Hi.Events Awarding Semantics](06-decide-hievents-awarding-semantics.md). Product, price, and ticket tier are support metadata only; no paid-tier Activity or Achievement exists.
- Configure direct Badge rules for each Activity. A meta rule may use `checked_in`, never ticket purchase or tier, as the main-conference attendance prerequisite.
- The Mission is visible only as coarse current-User attendance progress. The individual Badge presentation may be public only under normal Badge and User visibility controls; no public surface exposes ticket state, ticket type, check-in time, or Hi.Events metadata.
- Organizers must supply the September event ID, eligible source statuses, ticket/check-in Badge presentation, and safe user-facing status copy. Ticket 09 must preserve one ticket-present and one checked-in award per User, keep ticket-present out of **Leaderboard XP**, and score checked-in as a bounded attendance signal without blocking any local Mission when Hi.Events is unavailable.

### Session Attendance

- Configure one public `session.{sessionKey}` Mission for each selected published **Session**, with one `session.{sessionKey}.attendance` Activity, `attendance` outcome, and `single_code` evidence. QR, link, and manual entry all redeem that same Activity.
- The Activity relates to that Session record and retains a display snapshot only for support-safe historic presentation. It does not derive eligibility, time window, room, or completion from the public Session DTO.
- A direct Session-attendance Badge is optional per configured Session. Session-explorer meta Badges use selected Session-attendance Activity keys rather than an unbounded generic scan count.
- The Mission may be suggested after its configured public window begins and must not reveal bearer evidence. Accepted claims, deployment details, code labels, and any Session-specific redemption analytics are admin-only.
- Organizers must choose which published Sessions participate, provide immutable Session keys, the redemption window and artifact placement, direct Badge copy/visibility, and whether the Activity qualifies for a Session meta selector. Ticket 09 must bound total Session-derived ranking value and ensure one Session can yield one Activity Claim per User despite reissues or repeated scans.

### Sponsor Booth Partner Activities

- Configure one public `booth.{partnerKey}.{activityKey}` Mission for each selected sponsor booth experience. It can contain zero or more independently enabled Activity slots: `.visit`, `.participation`, `.completion`, `.win`, and `.high_score`, with matching outcome keys and `single_code` evidence.
- Each enabled outcome has a distinct WTS-controlled artifact, window, per-User limit, cap key, direct Badge rule, and optional consent setting. A claim for one outcome never implies another outcome. `win` and `high_score` are enabled only if WTS can operate a qualifying outcome-specific artifact; a partner assertion, external form, or staff-visible score is not evidence.
- The Mission and every Activity relate to the sponsor's `partners` record with `partnerKind = sponsor`. Optional `partner_follow_up` consent remains a separate post-redemption/profile action and never changes Activity Claims, Achievements, Badges, XP Events, or **Leaderboard XP**.
- Public Mission/Badge copy may name a published sponsor and describe the activity at the organizer's discretion. Codes, outcome evidence, claim history, cap application, consent/disclosure state, and support notes are admin-only; the ops board never identifies a partner Activity.
- Organizers must select the partner record, the actual enabled outcome slots, WTS-controlled artifact/deployment location for each slot, operating windows, direct Badge configuration, consent eligibility, and the partner/category cap group. Ticket 09 must score a booth as a bounded group so several outcomes from one sponsor cannot dominate broad participation, while preserving every valid claim and Badge when XP is capped.

### Workshops And Surrounding Events

- Configure one Mission per workshop or surrounding event: `workshop.{eventKey}`, `warmup.{eventKey}`, `satellite.{eventKey}`, or `social.{eventKey}`. Social includes an afterparty only when organizers configure one; the inventory does not assume one exists.
- A one-code attendance flow has one `.attendance` Activity with outcome `attendance` and `single_code` evidence. A two-code workshop completion flow has `.start` with outcome `attendance` and `two_code_start` evidence plus `.finish` with outcome `completion` and `two_code_finish` evidence. The optional attendance Badge may unlock from `.start`; a completion Badge unlocks only from the exact configured start-and-finish claim set.
- Two-code completion is available for workshops and may be chosen for another event only when organizers explicitly need it. Code order is not a hidden verifier rule: only the presence of both accepted Activity Claims satisfies completion.
- Every Activity requires the configured event reference and may carry an optional host partner relation. WTS-run events need no partner relation. Hi.Events is never an alternate source for these Activities.
- Mission visibility follows the organizer's public event availability; internal or not-yet-announced events may be active without becoming a public suggested Mission. Codes, claims, host attribution, deployment notes, and operating data are admin-only.
- Organizers must provide the event kind/key/title, public visibility, timing, location/deployment plan, chosen one- or two-code model, optional host relation, direct attendance/completion Badge configuration, and cap group. Ticket 09 must prevent a start claim plus finish claim from being scored as two full completions, bound surrounding-event contribution, and keep completion value dependent on both claims.

### Community Partner Activities

- Configure one `community.{partnerKey}.{activityKey}` Mission for each selected **Community Partner** programme or meetup. Its enabled Activity slots use `attendance`, `participation`, or `completion` outcomes with `single_code` evidence; a specifically approved event may instead use the established two-code start/finish pattern.
- Each Activity requires a `partners` relation and `partnerKind = community_partner`, keeping it administratively and user-facingly distinct from a sponsor booth. External community URLs, RSVP forms, screenshots, and partner assertions are not evidence.
- The Mission and its direct Badge are public or locked-teaser only when the organizers approve the associated programme for that visibility. Codes, claims, partner contact-consent state, disclosures, and support data remain admin-only; no Community Partner receives a WTS account.
- Organizers must supply the internal partner attribution, one immutable activity key per qualifying programme, delivery window/artifact, direct Badge configuration, any optional separate consent notice, and community meta eligibility. Ticket 09 must score selected one-per-programme qualifying Activities so repeated participation with one Community Partner cannot crowd out cross-community participation; consent always contributes zero gameplay value.

### Static Easter Eggs

- Configure one hidden `easter_egg.{eggKey}` Mission per safe discovery, containing `easter_egg.{eggKey}.discovery` with outcome `static_discovery` and `static_puzzle_code` evidence. A discovered static QR, WTS link, or manually entered code is the only September evidence.
- Each Activity has no partner, Session, or event requirement unless an organizer deliberately links it for attribution; puzzle answers, browser telemetry, external requests, and destructive behaviour are never validated as evidence. The code may be time-boxed, disabled, invalidated, or reissued like every other code.
- The Mission and Achievement are `hidden_until_unlocked` by default. After unlock, the Badge follows the owning User's normal public-Badge setting; discovery location, code, and support metadata never become public.
- Organizers must supply a safe static discovery surface, spoiler-safe post-unlock copy, active window, direct Badge configuration, and a separate easter-egg cap group. Ticket 09 must make this optional curiosity value bounded and resistant to one leaked set of codes deciding the ops board.

### Meta Achievements

- Meta Achievements have no redeemable Mission. The evaluator creates a `meta.{metaKey}` Activity Claim with outcome `meta` and `meta_rule` evidence only after its source claims are accepted; it reevaluates after relevant claims are voided or corrected.
- Use the existing configurable rule shapes only: an exact `claim_set` for a defined circuit such as selected warmup, `conference.main.checked_in`, and selected social Activities; or a `claim_count` over an organizer-selected qualifying Activity set or category. A cross-Session, cross-booth, or cross-community count selects at most one qualifying Activity per Session, partner, or Community Partner programme so a single entity cannot satisfy a diversity rule through multiple outcome tiers.
- Configuration-ready meta families are: conference circuit across selected event Activities; Session explorer across selected Session attendance Activities; booth explorer across selected booth visit Activities; booth depth across selected booth completion Activities; Community Partner explorer across selected community Activities; and cross-category engagement across an explicit claim set. None needs real names, thresholds, or content before organizers configure the programme.
- Meta Badges may be public, locked-teaser, or hidden-until-unlocked according to spoiler risk. Their rule composition, underlying claims, cap application, and diagnostic progress remain current-User/admin-only, not public ops-board data.
- Organizers must select the qualifying Activity keys, rule kind, count or exact set, Badge presentation, active range, and meta cap group. Ticket 09 must ensure every meta awards at most once, counts only accepted non-voided evidence, treats source cap exhaustion as completed evidence where the Badge rule is satisfied, and prevents a narrow single-partner or repeat-scan path from satisfying an exploration meta.

### Admin Exceptions

- Manual awards are not public Missions and do not have ordinary redemption codes. An admin exception creates an admin-only `admin_manual` Activity Claim linked to the selected Achievement and audited admin action; it may reference the failed Activity or Hi.Events case for support.
- The ordinary catalog, suggested Mission list, and public ops board never expose manual-award Activities, reasons, or support evidence. Partners, hosts, staff, and Community Partners cannot request, inspect, or perform the award in WTS.
- Each exception requires the target **User**, Achievement, reason, accounting choice, confirmation, and audit correlation. Ticket 09 must retain zero **Leaderboard XP** as the default and require its separate high-impact confirmation for any ranking adjustment.

### Scoring Inputs

Ticket 09 must score this inventory without changing its evidence boundaries or selecting numeric values here:

- Keep ticket-present total-only, use checked-in rather than ticket purchase for main-conference ranking eligibility, and make neither source a paid-tier signal.
- Apply Activity, partner, category, day, and conference cap keys as appropriate to the configured family. A cap can reduce XP only after evidence is accepted; it never deletes an Activity Claim or Badge.
- Treat each configured Activity as one per User across every generated, reissued, or delivery-form variant. Count selected qualifying Activities, not scans, external clicks, consent actions, or code attempts.
- Bound Session, booth, surrounding-event, Community Partner, and easter-egg contribution independently so broad participation wins over harvesting one source. Score booth outcome slots and two-code start/finish as bounded related groups, not an assumption that every intermediate outcome is a full independent ranking award.
- Keep partner contact consent, raw-code distribution, ticket metadata, external form completion, and admin support interaction outside total XP, Badge eligibility, and **Leaderboard XP**.
- Score meta only once from accepted non-voided source claims, including claims whose XP was capped, and preserve opt-out-by-default individual ops-board visibility, safe display names, and Badge privacy throughout.
