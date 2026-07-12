# Decide Hi.Events Awarding Semantics

Status: closed
Assignee: OpenCode
Labels: wayfinder:research
Type: AFK
Created: 2026-07-09
Closed: 2026-07-09
Part of: `.scratch/wts-2026-gamification/wayfinder/MAP.md`

## Question

How should Hi.Events ticket and check-in data become gamification evidence without causing support, privacy, or fairness issues?

Inspect the existing Hi.Events integration and decide matching keys, trigger timing, API outage behavior, no-ticket versus unavailable states, pagination expectations, paid ticket tier handling, idempotency keys, and whether ticket/check-in badges count toward total XP, leaderboard XP, both, or neither.

## Blocked by

- `.scratch/wts-2026-gamification/wayfinder/tickets/02-decide-september-conference-release-scope.md`
- `.scratch/wts-2026-gamification/wayfinder/tickets/03-decide-core-accounting-and-data-model.md`

## Resolution

Use the smallest Hi.Events model that safely turns ticket and check-in facts into **Activity Claims**: a valid ticket can prove `ticket_present`, and a valid check-in can prove `checked_in`. Hi.Events remains an external evidence source, not the gamification source of truth. Accepted **Activity Claims**, **User Achievements**, **XP Events**, and **Gamification Profile** cache rows are still written only by WTS server-side gamification code.

### Hi.Events facts that become Activity Claims

- A matching eligible Hi.Events attendee/ticket for the configured September conference event creates an accepted `hievents_ticket` **Activity Claim** with `outcomeKey = "ticket_present"`.
- A matching eligible Hi.Events attendee/ticket with a valid check-in creates an accepted `hievents_checkin` **Activity Claim** with `outcomeKey = "checked_in"`.
- If multiple eligible attendee rows match the same **User**, keep evidence per stable attendee where practical, but September **Achievements** and XP must cap to one ticket-present Badge and one checked-in Badge for the main conference event.
- Product ID, ticket title, price, order status, attendee name, public ticket URL, and check-in timestamp are support metadata only. They do not become separate September **Activity Claims** by themselves.
- No **Activity Claim** is created for no-ticket, not-checked-in, API-unavailable, stale-data, or ambiguous-match states. Those are status or support states, not evidence of activity.

### Matching Hi.Events data to a User

- Match automatically only by normalized email: trim and lowercase the authenticated WTS **User** email and the Hi.Events attendee email. Do not strip plus aliases, ignore dots, fuzzy-match names, match by public ticket URL, or let the browser submit an arbitrary email or attendee ID for awards.
- PocketBase `users.email` is the WTS identity anchor. If a **User** bought a ticket with a different email, the automatic state is no ticket; support can use audited admin manual awards or corrections.
- Admin all-attendee sync may build a normalized email to **User** map. If more than one WTS **User** maps to the same normalized email, or if a Hi.Events attendee is already linked to a different **User** through prior accepted evidence, the state is ambiguous and no automatic claim is written.
- Multiple Hi.Events attendee rows for the same normalized email are not ambiguous by themselves. They are multiple evidence candidates for the same **User** and should still unlock at most the configured September ticket/check-in **Achievements**.
- Attendee rows without a valid email, with an unrecognized status, or from an event ID that is not configured as September evidence do not auto-award.

### Claim creation timing

Use a combination of lazy user refresh and admin reconciliation:

- `/user/profile` should show a Hi.Events/gamification status card and trigger a current-**User** refresh when the cached Hi.Events status is missing or stale. The profile should also expose an explicit `Refresh ticket status` action.
- A successful current-**User** refresh may create or repair that **User**'s `hievents_ticket` and `hievents_checkin` claims, affected **User Achievements**, **XP Events**, and **Gamification Profile** totals.
- Login itself does not need a separate Hi.Events sync. Visiting the authenticated profile after login is enough.
- Admin/support needs an all-attendee Hi.Events sync action for event operations. It must paginate through every attendee page before using absence to make no-ticket or correction decisions.
- A scheduled sync may call the same admin reconciliation service if deployment supports it, especially during venue check-in, but scheduled infrastructure is not the only correctness path for September.
- Public `/ops-board` reads never call Hi.Events and never create claims.
- Existing `fetchHiEventsAttendees()` behavior is not a sufficient awarding contract because it returns `[]` for both no data and several failure modes, and currently fetches only the first attendee page. Implementation should split low-level Hi.Events API fetching from typed gamification sync/status functions.

### Ticket-present versus checked-in states

- `ticket_present` means Hi.Events currently has an eligible attendee/ticket for the **User**'s normalized email. It can unlock a ticket-linked Badge before the event.
- `checked_in` means the matched eligible attendee has a check-in record. It can unlock an attendance Badge and can be treated as venue attendance evidence.
- Check-in implies the system should also ensure the corresponding ticket-present evidence exists or is repaired, but the two states remain separate **Activity Claims** and separate **Achievements**.
- A **User** with a ticket but no check-in is not in an error state. They should see `Ticket confirmed` plus clear copy that the check-in Badge unlocks after venue check-in and refresh/sync.

### User-facing states

| State | User-facing behavior | Accounting behavior |
| --- | --- | --- |
| `ticket_present` | Show the ticket-linked Badge/progress as recorded. Keep details coarse, such as `Ticket confirmed`. | Accepted `hievents_ticket` claim; unlock/cap the ticket **Achievement** once. |
| `checked_in` | Show the checked-in Badge/progress as recorded. Do not expose private ticket metadata. | Accepted `hievents_checkin` claim; unlock/cap the check-in **Achievement** once. |
| `not_checked_in` | Show that a ticket is confirmed and check-in is not recorded yet. Offer refresh/support copy. | No check-in claim yet; keep any ticket claim. |
| `no_ticket` | After a fresh successful lookup, say no ticket was found for the current profile email and link to tickets/support. | No Hi.Events claim and no XP. Do not void prior claims from a filtered or partial lookup. |
| `api_unavailable` | Say ticket status is temporarily unavailable, preserve any cached progress, and offer retry/support. | No new claims and no voiding. Local QR/code **Mission** redemption still works. |
| `stale_data` | Show last successful sync time and a refresh action. Existing Badges can remain visible with stale-status copy. | No new correction solely because data is stale. |
| `ambiguous_match` | Say the ticket could not be linked automatically and direct the **User** to support. | No automatic claim. Admin-only support view shows the ambiguity. |

### Support metadata and privacy

Accepted Hi.Events **Activity Claims** should keep only support-safe admin-only metadata:

- Hi.Events event ID.
- Stable attendee identifier, preferring internal attendee ID when returned, then `public_id`, then `short_id`, then a server hash fallback.
- Product ID and ticket title when available.
- Attendee/order eligibility status used for the decision when available.
- Check-in ID and `checkedInAt` when available for check-in evidence.
- `matchedBy = "normalized_email"`, normalized email hash, candidate count, and ambiguity reason when relevant.
- `fetchedAt`, `sourceUpdatedAt` when available, sync batch ID, and adapter/API version.

Do not persist raw ticket URLs, raw admin URLs, raw Hi.Events API tokens, payment details, ticket price as scoring input, first/last name, or raw attendee email in public DTOs. Admin-only support views may still show raw Hi.Events attendee data fetched live or from admin-only debug metadata when needed, but profile and ops-board DTOs must not.

### Idempotency keys

Use stable keys with no raw emails or secrets. Define `attendeeStableId` as the best stable source identifier available from Hi.Events: internal attendee ID, else `public_id`, else `short_id`, else a server-side hash of event ID, normalized email, and product ID.

- Ticket evidence fingerprint: `hievents-ticket:v1:{eventId}:{attendeeStableId}`.
- Check-in evidence fingerprint: `hievents-checkin:v1:{eventId}:{attendeeStableId}:{checkInStableIdOrCheckedInAtHash}`.
- Ticket **Activity Claim** idempotency key: `activity-claim:v1:{userId}:{activityKey}:hievents_ticket:{eventId}:{attendeeStableId}`.
- Check-in **Activity Claim** idempotency key: `activity-claim:v1:{userId}:{activityKey}:hievents_checkin:{eventId}:{attendeeStableId}:{checkInStableIdOrCheckedInAtHash}`.
- Ticket **User Achievement** key remains `user-achievement:v1:{userId}:{achievementKey}` so multiple tickets cannot unlock the same Badge twice.
- Ticket/check-in **XP Event** keys should be derived from the **User Achievement** or accepted source claim and reason, not from product price or ticket tier.

If Hi.Events omits a stable check-in ID, hash the checked-in timestamp for the fingerprint. If a check-in timestamp is corrected but the check-in remains valid, update metadata without awarding additional XP.

### Paid ticket tiers and XP policy

September should not include paid ticket tier **Achievements**. There is no Gold/VIP/early-bird/product-specific Badge and no XP variation by ticket price or paid tier.

- The base ticket-present Badge may award modest total XP, but its **Leaderboard XP** must be `0`.
- The checked-in Badge may award modest total XP and a small fixed amount of **Leaderboard XP**, because it represents attendance rather than purchase tier.
- Exact XP amounts, level bands, and caps remain for `Decide Scoring, Fairness, Caps, And Leaderboard Rules`, but that ticket should not reopen whether paid-tier Achievements exist.
- Public ops-board rows may be affected by the checked-in Badge's **Leaderboard XP**, but must not reveal ticket type, price, check-in timestamp, or Hi.Events status.

### Refunds, transfers, revocations, and corrected check-ins

- Treat a fresh successful complete sync as the source of truth for Hi.Events-derived claims. API failures, stale data, and incomplete pagination must never void existing claims.
- If Hi.Events explicitly reports cancellation, refund, transfer away from the **User**'s email, attendee deletion, or another non-eligible status, void the affected Hi.Events **Activity Claims** and associated **XP Events** with a source-sync reason. Recompute or revoke the sourced Badge only if no remaining accepted claim still satisfies the **Achievement**.
- If a ticket is transferred to another email, the old **User**'s source claims are voided after a complete successful sync; the new **User** gets claims only after their normalized WTS email matches the transferred attendee.
- If a check-in is deleted, void the check-in claim and associated XP while leaving a still-valid ticket-present claim intact.
- If a check-in timestamp is corrected but the attendee remains checked in, update support metadata and do not create duplicate XP.
- If a legitimate attendee cannot be matched automatically, event support uses audited manual admin awards or corrections. Ordinary gameplay still does not add partner/staff verifier accounts.

### Failure isolation

Hi.Events failures must not block local QR/link/code **Mission** redemption. `redeemMissionCode(rawCode, sourceHint?)` should not call Hi.Events. The profile can show `api_unavailable` or `stale_data` for ticket/check-in evidence while code-based Missions continue to award through their own server-side path.

### Privacy boundaries

- Authenticated profile DTOs may include the current **User**'s coarse Hi.Events state, last successful sync time, safe support reference, ticket-present/checked-in Badge state, and user-facing retry/support copy.
- Public ops-board DTOs include only safe display name, rank, level/access level, **Leaderboard XP**, and public Badge snippets allowed by Badge and **User** visibility settings. They do not expose Hi.Events metadata or ticket/check-in states.
- Admin-only DTOs may include raw **Activity Claims**, **XP Events**, source-sync metadata, ambiguity reasons, and Hi.Events support/debug fields behind `requireAdmin()`.

### September scope versus deferred

September includes:

- Main conference Hi.Events ticket-present and checked-in evidence for the configured event ID.
- Current-**User** refresh from `/user/profile` and explicit refresh.
- Admin all-attendee paginated sync/reconciliation with support/debug states.
- Typed no-ticket, not-checked-in, unavailable, stale, and ambiguous states.
- Source-driven voiding/corrections for revoked/refunded/transferred tickets and deleted check-ins.
- No paid-tier Achievements and no product-price scoring.

Deferred or out of scope for September:

- Hi.Events webhooks as the primary awarding path.
- Product/tier-specific ticket Badges.
- Fuzzy matching, user-submitted ticket IDs/public URLs, and self-service ticket linking.
- Modeling every Hi.Events product as a separate **Mission**.
- Partner/staff verifier accounts, routine scanner awarding, attendee-to-attendee scans, team/faction scoring, and server-side puzzle answer validation.

### Implementation boundaries to plan around

- Keep `src/lib/hievents.ts` as the low-level Hi.Events adapter, but extend or wrap it to support pagination, stable attendee identifiers, explicit result states, and status fields. It should not write gamification records directly.
- Add a server-only gamification Hi.Events evidence service that maps adapter DTOs into accepted/voided **Activity Claims**, **User Achievements**, **XP Events**, and **Gamification Profile** updates using PocketBase admin access.
- Plan serializable server-function boundaries such as `refreshMyHiEventsEvidence()`, `getMyHiEventsEvidenceStatus()`, and `adminSyncHiEventsEvidence()`. Exact names can change, but `requireAuth()` and `requireAdmin()` boundaries should not.
- `/user/profile` should consume safe profile/status DTOs and must not directly expose raw Hi.Events attendee records as gamification data.
- Admin support surfaces can live under the existing admin area or the later gamification admin boundary, but they must use admin-only DTOs and show sync status, ambiguity, corrections, and source metadata.
