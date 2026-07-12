# Decide Admin Operations And Audit Model

Status: closed
Assignee: OpenCode
Labels: wayfinder:grilling
Type: HITL
Created: 2026-07-09
Closed: 2026-07-09
Part of: `.scratch/wts-2026-gamification/wayfinder/MAP.md`

## Question

What admin and support operations must exist before gamification is safe to run at an event?

Decide the required admin surface for achievements, mission/code generation, invalidation, manual awards, revocations or XP voiding, Hi.Events sync/reconciliation/support debugging, User history, analytics/debugging, and audit events. Clarify which operations are required for September, which require human support workflows, and which can be deferred without making event-day support unsafe.

## Blocked by

- `.scratch/wts-2026-gamification/wayfinder/tickets/02-decide-september-conference-release-scope.md`
- `.scratch/wts-2026-gamification/wayfinder/tickets/03-decide-core-accounting-and-data-model.md`
- `.scratch/wts-2026-gamification/wayfinder/tickets/04-decide-secure-mission-redemption-model.md`
- `.scratch/wts-2026-gamification/wayfinder/tickets/06-decide-hievents-awarding-semantics.md`

## Resolution

September needs one admin-only gamification operations surface and no delegated support or verifier role. It must make configured automated evidence safe to operate, make legitimate event-day exceptions recoverable, and preserve enough history to explain any result. It does not need a general operations analytics product or a staff scanning workflow.

### Authorization and privacy boundary

- Only an authenticated **User** whose persisted role is `admin` may read admin gamification DTOs or invoke privileged gamification server functions. Every such function calls `requireAdmin()` and uses server-side `getAdminPB()` access; a client-side route guard is navigation only, never authorization.
- A regular authenticated **User** may redeem their own **Mission** code, refresh only their own Hi.Events evidence, read their own **Gamification Profile**, and change their own public visibility settings. They cannot submit a target **User**, create or alter an **Achievement**, **Mission**, **Activity Claim**, **XP Event**, code, audit record, or source correction.
- Reviewers have no gamification privilege merely by being reviewers. September adds no event-support role, partner role, staff role, or `Verifier` account. Sponsors, booth staff, workshop hosts, and **Community Partners** receive no award, scan, lookup, or code-management endpoint; their activities use WTS-admin generated automated evidence and exceptional cases go to an admin.
- Authenticated profile DTOs remain current-**User** only. The public ops board remains opt-out by default and exposes only approved display name, rank, level, **Leaderboard XP**, and public **Badge** snippets. Admin-only support/audit DTOs never feed either surface.

### Required September operations

The following are mandatory before event day:

- Configure and safely lifecycle **Achievements**, **Missions**, and Activities.
- Generate, one-time display/export, look up, invalidate, and reissue Mission-code batches.
- Search a **User**'s gamification history and the associated code, **Mission**, Activity, **Activity Claim**, **Badge**, **XP Event**, profile-cache, and audit records.
- Manually award a **Badge**, revoke a **Badge**, void an **XP Event**, apply a signed positive or negative XP correction, and rebuild one **Gamification Profile** cache.
- Refresh and reconcile Hi.Events evidence with typed status/debug views and source-driven corrections.
- Show a compact operational view of active/disabled codes, accepted/rejected redemption counts, per-Activity totals, last attempt/success, profile-cache state, and latest Hi.Events reconciliation state. This is support telemetry, not a public or partner analytics dashboard.

Deferred from September:

- Delegated support, partner, staff, or verifier permissions; routine scanner/manual awarding; attendee-to-attendee scans; bulk manual awards/corrections; a global profile-cache rebuild; raw-code recovery; audit-log editing/deletion; self-service appeals or ticket linking; generic data exports; real-time fraud monitoring; and Hi.Events webhooks as the correctness path.
- Rich analytics, revenue/ticket-tier analysis, partner lead lists, and broad raw-attendee exports are not gamification requirements. Paid ticket tier **Achievements** remain excluded.

### Configuration lifecycle

- Admins create **Achievements**, **Missions**, and Activities as drafts, validate their relationships and limits, then explicitly activate them. The active configuration must identify its source/evidence mode, active window, per-**User** and global limits, associated **Mission** and **Achievement** rules, and **Leaderboard XP** policy where applicable.
- Drafts may be edited. Once accepted evidence exists, accounting-affecting fields such as identifiers, source/evidence mode, unlock rule, XP, **Leaderboard XP**, and activity association are not changed in place. Retire/disable the old definition and create a successor with a recorded reason; historical **Activity Claims**, **Badges**, and **XP Events** continue to point to the original definition.
- Existing live definitions may receive non-accounting presentation edits, but those edits are audited. Deletion is not an admin operation for September; retire/disable is the reversible lifecycle state.
- A code is always associated with an Activity, not directly awarded from browser-supplied Achievement or XP values. A **Mission** can group the Activity for user-facing copy, while the Activity controls evidence, windows, limits, and award evaluation.

### Code lifecycle and support lookup

- Code generation is an admin server function. It accepts the configured Activity, a required human-readable label, quantity, code role, active window, and limits; it generates high-entropy raw codes server-side and persists only their HMAC/hash and non-secret lookup prefix.
- The response may show raw codes, QR/link URLs, and an export exactly once. The client must make that export available before leaving the generation result; later admin reads show only batch ID, label, prefix, Activity/Mission, status, counts, and audit links. QR assets are made from the transient response, not recreated from hashes.
- A lost raw-code result is unrecoverable by design. Support locates the code by batch ID, label, lookup prefix, related Activity/Mission, redemption support reference, or a raw-code verification input that is immediately normalized and HMAC-compared on the server. The raw input is never logged, stored, or returned.
- Invalidation requires a confirmation and a non-empty reason. It disables new redemption immediately, records the actor and affected code, and never deletes history or automatically removes prior **Activity Claims**, **Badges**, or XP. Those are separate audited corrections when justified.
- Reissue requires confirmation and a reason. It creates a distinct code with a fresh prefix/hash, records that it replaces the disabled code, and uses the same Activity/per-**User** limits so the replacement cannot award duplicate XP. Reissue is the sole recovery for a lost or incorrectly distributed raw code.
- A code batch is limited to 100 codes. Code generation retries use one client operation ID: a duplicate request returns the existing result if its one-time raw payload is still available in that response, otherwise it reports that the batch was committed but secrets cannot be recovered and directs the admin to invalidate/reissue. It must never silently create a second secret batch.

### Manual awards, corrections, and profile caches

- A manual **Badge** award creates one audited admin action, an accepted `admin_manual` **Activity Claim**, the **Badge** unlock when absent, and any configured **XP Event**. The form requires an explicit target **User**, Achievement, reason, total-XP and **Leaderboard XP** policy/result, and confirmation. Manual awards default to zero **Leaderboard XP**; a nonzero ranking change requires an explicit separate confirmation.
- Badge revocation marks the existing User Achievement revoked with actor, time, and reason. It does not delete the record or automatically void its XP.
- XP voiding marks one existing **XP Event** voided with actor, time, reason, and audit link. It does not automatically revoke the Badge or void the source **Activity Claim**.
- Positive and negative corrections create new signed `admin_correction` **XP Events** rather than editing a prior event. The admin must choose both total-XP and **Leaderboard XP** deltas deliberately, supply a reason, and confirm. Negative corrections and any nonzero leaderboard adjustment receive the same high-impact confirmation as a void.
- The correction UI may let an admin request Badge revocation, XP voiding, and/or a signed correction together, but each durable mutation has its own audit record and shares an operation/correlation ID. Retrying an operation must return its existing records rather than double-award or double-adjust.
- Each accepted award, revocation, void, correction, source-driven Hi.Events correction, or explicit rebuild immediately recomputes the target **Gamification Profile** from non-voided **XP Events** and non-revoked User Achievements. The rebuild preserves ops-board visibility, display name, and Badge privacy settings; it does not create new XP or change authoritative history. It creates a profile if missing using the September opt-out-default visibility policy.
- Manual award/correction/rebuild actions are single-User operations for September. A global rebuild or generic mass correction is deliberately deferred; the only controlled multi-User operation is Hi.Events reconciliation below.

### Audit records and support-safe metadata

Every privileged gamification mutation writes an append-only admin action: draft/configuration change, activation/retirement, code batch generation, invalidation, reissue, manual award, Badge revocation, XP void, signed correction, profile-cache rebuild, and Hi.Events reconciliation/apply. A `GamificationAdminAction` must include:

- Server-derived actor **User** ID and role, action type/status, timestamp, request/correlation and idempotency IDs, and a required reason for high-impact actions.
- Target **User** ID when applicable; related **Achievement**, **Mission**, Activity, code/batch, Activity Claim, User Achievement, XP Event, Gamification Profile, and Hi.Events sync-batch IDs as applicable.
- Safe before/after summaries and XP deltas, created/voided/revoked record IDs, and a sanitized failure state if an operation is partial or retriable.
- Source links and compact support metadata: code label/prefix and status, Activity/Mission keys, source event ID, stable Hi.Events attendee/check-in IDs, match method, source timestamps, sync batch ID, and decision/ambiguity state.

Audit data must not store or render raw Mission codes, code hashes, API tokens, raw request fingerprints, payment data, raw ticket/admin URLs, or arbitrary browser payloads. Reasons must warn admins not to paste secrets, full payment data, or unnecessary personal data. They are immutable and admin-only; an owning **User** receives only neutral correction copy on their profile, never the audit reason or actor.

Event support searches by exact WTS **User** ID, email, display name, admin-visible support reference, Mission/Activity/Achievement key, code label/prefix, redemption ID, or Hi.Events stable attendee ID. The gamification support result should show only the matched **User** identity, coarse status, record links, timestamps, configured ticket title/status/check-in state when relevant, and the audit trail needed to solve the case. It must not expose raw codes, unrelated Users, full Hi.Events attendee lists, ticket price, payment data, ticket URLs, API credentials, request fingerprints, partner consent, or public/private fields beyond the case. Existing `/admin/tickets` may remain a ticket-management view, but its raw first-page list is not a gamification evidence or support contract.

### Hi.Events reconciliation and source corrections

- The low-level `src/lib/hievents.ts` adapter must return typed success, unavailable, partial, and pagination information rather than treating every failure as `[]`. It stays read-only with respect to gamification accounting.
- A server-only gamification Hi.Events evidence service maps a complete source snapshot into claims and corrections. An admin server function invokes it only after `requireAdmin()`; it must keep user profile refresh, explicit refresh, and admin reconciliation as separate serializable contracts.
- The admin workflow selects the configured September event and fetches every attendee page. It shows event ID, page count, source timestamps, successful/failed/partial state, candidate/matched/unmatched/ambiguous counts, proposed claim creates, and proposed source corrections before the admin confirms `Sync and apply`.
- Pagination completeness is a hard precondition for all-attendee apply and every absence-based decision. A failed page, malformed pagination metadata, source authentication failure, or interrupted traversal is `partial`/`unavailable`: preserve existing claims and profile totals, make no new source writes, and perform no no-ticket, void, revoke, or transfer correction.
- A complete successful sync may create or repair normalized-email ticket/check-in claims idempotently. It may void source claims and XP only when the source explicitly reports an ineligible/refunded/cancelled/transferred/deleted/check-in-removed fact or a complete snapshot proves it absent. It never uses an outage, stale status, or partial list as negative evidence.
- The sync/debug view must distinguish `ticket_present`, `checked_in`, `not_checked_in`, `no_ticket`, `api_unavailable`, `stale_data`, `partial_sync`, `ambiguous_match`, and `source_corrected`. Ambiguous mapping, duplicate WTS Users for one normalized email, missing source email, or a prior source link to a different User produces no automatic claim or correction and requires admin support review.
- Source-driven corrections retain the original source claim/XP records as voided history, link to the reconciliation audit action, and trigger the affected profile rebuild. A manually revoked Badge is never silently un-revoked by a later automated sync; a legitimate restoration is a separate audited manual award/correction.
- Admins can inspect per-User source status and sync batch details, but do not edit Hi.Events evidence fields in place or override matching with a browser-supplied attendee ID. A legitimate unmatched ticket is handled by an audited manual action. Hi.Events failures never enter the QR/link/code redemption path and never block local Mission redemption.

### Component and server boundaries

- Add one protected `src/routes/admin/gamification.tsx` route using the established `useRequireAdmin()` and `AdminPageShell` conventions. It may use tabs or query state for configuration, code batches, support history, corrections/cache, and Hi.Events reconciliation; this is smaller and safer than separate public-like support routes.
- Keep presentation components under `src/components/admin/gamification/`: catalog/configuration forms, code-generation one-time result, code status/invalidation controls, User support lookup/history, correction confirmation form, profile-cache status, and Hi.Events reconciliation/status panels. Components consume safe serializable DTOs only.
- Keep privileged functions in a dedicated server-only gamification admin module, following `src/lib/admin-actions.ts`, `src/lib/server-auth.ts`, and `src/lib/pocketbase-admin-service.ts`: thin `requireAdmin()` server-function contracts delegate to an accounting/admin service and the Hi.Events evidence service. Existing `/admin/tickets` should either link to the gamification reconciliation panel or use the typed paginated adapter later; its current first-page fetch must not be reused for award/correction decisions.
- Required contracts include catalog/code list and mutations; one-time code generation; code lookup/invalidate/reissue; User history lookup; manual award/revoke/void/correction; single-profile rebuild; Hi.Events status/detail; and paginated sync/apply. Exact exported names may change, but clients never receive raw PocketBase records or admin credentials.

### Failure and duplicate-action behavior

- PocketBase authorization or availability errors return a safe admin failure and never report an award, invalidation, correction, or sync as complete without its authoritative record. Privileged operations use stable action/idempotency IDs and record partial/retryable progress so a retry repairs missing dependent records rather than duplicating accounting.
- If an authoritative mutation succeeds but its profile-cache rebuild fails, preserve the authoritative history, mark the admin action `rebuild_pending`, show that state in support, and allow the idempotent single-User rebuild action to repair it. Do not repeat the award/correction or fabricate fresh XP while retrying. Profile and ops-board cache data may remain stale until repaired, but no source record is rolled back or deleted.
- If code generation fails before persistence, no code is issued. If persistence succeeds but the one-time raw-code response/export is lost, mark the batch committed with no recoverable secret; support must invalidate/reissue rather than disclose or regenerate a raw code from storage.
- Hi.Events unavailable/partial/stale results are explicit status states, not empty attendee lists and not proof of no ticket. They preserve existing evidence and isolate local redemption.
- Duplicate submissions, double clicks, concurrent redemption, repeated void/revoke, and retrying an already-applied reconciliation resolve to the existing idempotent record or an explicit no-op outcome. Admin UI disables in-flight destructive actions, requires a confirmation step, and requires a reason for invalidation, reissue, retirement, manual awards, revocations, voids, signed corrections, cache rebuilds, and source corrections.
