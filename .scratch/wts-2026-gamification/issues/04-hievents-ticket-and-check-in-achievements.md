# Hi.Events Ticket And Check-In Achievements

Status: ready-for-agent
Type: AFK
Created: 2026-06-06

## Parent

`.scratch/wts-2026-gamification/PRD.md`

The closed decisions in `.scratch/wts-2026-gamification/wayfinder/MAP.md` supersede conflicting PRD text.

## What to build

Award gamification progress from existing Hi.Events ticket data using the semantics from `.scratch/wts-2026-gamification/wayfinder/tickets/06-decide-hievents-awarding-semantics.md`. A **User** whose normalized email matches an eligible Hi.Events attendee should be able to earn a ticket-present Badge, and a **User** whose matched attendee has a check-in should be able to earn a checked-in Badge. Hi.Events outages, stale data, no-ticket, not-checked-in, and ambiguous-match states must stay distinct.

This slice connects the gamification foundation to an existing real conference system without requiring QR mission codes. It must not add paid ticket tier Achievements, product-price scoring, fuzzy matching, self-service ticket linking, or any dependency that blocks local QR/code **Mission** redemption when Hi.Events is unavailable.

Inventory constraint: configure this as the passive `conference.main` Mission with exactly `conference.main.ticket_present` and `conference.main.checked_in` Activities. It is profile progress, not a redeemable QR/link/code Mission, and it is the only September use of Hi.Events evidence.

## Acceptance criteria

- [ ] A **User** can trigger current-user evaluation from `/user/profile` using only their authenticated WTS email.
- [ ] `/user/profile` shows coarse Hi.Events status, an explicit refresh action, and safe support copy. A valid check-in repairs missing ticket-present evidence without exposing ticket data.
- [ ] `src/lib/hievents.ts` remains a read-only low-level adapter that returns typed paginated success, unavailable, and partial results; only the server-side gamification evidence service writes accounting.
- [ ] An admin can inspect typed Hi.Events status/debug data and run a paginated all-attendee reconciliation for the configured September event ID from the admin gamification operations surface.
- [ ] Reconciliation displays event ID, page/completeness state, source timestamps, match/ambiguity counts, and proposed creates/corrections before an explicit `Sync and apply` confirmation.
- [ ] A **User** with a matching eligible Hi.Events attendee record receives a `hievents_ticket` **Activity Claim**, ticket-present Badge, and 10 total XP idempotently, with `Leaderboard XP = 0`.
- [ ] A **User** with a checked-in matching attendee record receives a `hievents_checkin` **Activity Claim**, checked-in Badge, and 20 total XP / 10 **Leaderboard XP** idempotently.
- [ ] Multiple matching attendee rows do not duplicate the same September ticket-present or checked-in Badge/XP.
- [ ] A **User** without a matching attendee record receives a clear no-ticket state and no XP after a fresh successful lookup.
- [ ] A **User** with a ticket but no check-in receives a not-checked-in state, not an error.
- [ ] Hi.Events API failure returns an unavailable state, preserves existing cached progress, and does not break the profile.
- [ ] Stale data shows last successful sync time and a refresh path without creating or voiding claims solely because data is stale.
- [ ] Ambiguous matches create no automatic claim and route the **User** to support with admin-only debug detail.
- [ ] Refunded, cancelled, transferred-away, deleted, or no-longer-eligible Hi.Events attendees are handled only after a fresh complete sync, with source claims/XP voided and sourced Badges recomputed or revoked if unsupported by remaining accepted claims.
- [ ] A failed page, malformed pagination state, source authentication error, or interrupted traversal is `partial`/`unavailable`, not an empty attendee list: it creates no source evidence and performs no absence-based correction.
- [ ] Paid ticket tier/product-specific Achievements are not added for September.
- [ ] Ticket and check-in Badges appear in the profile gamification summary without exposing raw Hi.Events metadata, ticket price, public ticket URL, check-in timestamp, or private support fields.
- [ ] Public ops-board output exposes no Hi.Events metadata; only allowed Badge snippets and **Leaderboard XP** can be visible.
- [ ] Hi.Events API failure does not block local QR/link/code **Mission** redemption.
- [ ] Admin/support views can distinguish no ticket, not checked in, unavailable, stale, ambiguous, and source-corrected states.
- [ ] Admin support views expose only case-relevant **User**, source status, safe source IDs, and audit links; they do not expose raw codes, API credentials, payment data, ticket URLs, request fingerprints, or unrelated attendee data.
- [ ] Tests cover normalized-email matching, source statuses, pagination/partial isolation, check-in ticket repair, source-driven correction, fixed scoring, and safe profile/admin/public DTOs.
- [ ] The build completes successfully.

## Blocked by

- `.scratch/wts-2026-gamification/issues/01-september-gamification-accounting-foundation-and-profile-read-model.md`
- `.scratch/wts-2026-gamification/issues/03-admin-gamification-configuration-and-code-operations.md`
- `.scratch/wts-2026-gamification/issues/11-admin-manual-awards-and-audit-history.md`
