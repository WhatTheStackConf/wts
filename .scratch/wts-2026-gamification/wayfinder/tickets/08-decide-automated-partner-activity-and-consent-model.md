# Decide Automated Partner Activity And Consent Model

Status: closed
Assignee: OpenCode
Labels: wayfinder:grilling
Type: HITL
Created: 2026-07-09
Closed: 2026-07-09
Part of: `.scratch/wts-2026-gamification/wayfinder/MAP.md`

## Question

How should booth, workshop, sponsor, and community activity use automated evidence while preserving privacy and limiting abuse now that September has one admin-only support surface?

September has no partner/staff/community verifier accounts, routine scanner awards, or delegated support role. Decide the QR/link/code/check-in/static-evidence patterns for partner and community activity; consent separation; source metadata; duplicate award behavior; and which distinct automated codes, Hi.Events/static evidence, or audited admin manual awards replace the originally proposed verifier behavior. Reuse the established code lifecycle, one-time secret display, support lookup, audit, and correction boundaries rather than reopening them.

## Blocked by

- `.scratch/wts-2026-gamification/wayfinder/tickets/02-decide-september-conference-release-scope.md`
- `.scratch/wts-2026-gamification/wayfinder/tickets/03-decide-core-accounting-and-data-model.md`
- `.scratch/wts-2026-gamification/wayfinder/tickets/07-decide-admin-operations-and-audit-model.md`

## Resolution

September **Partner Activities** use WTS-controlled automated evidence and admin-only exceptions. A sponsor booth, workshop, warmup, satellite event, social, or **Community Partner** activity may be configured and attributed to an existing `partners` record where there is an operating organization; WTS-run events need only their event reference. The existing `partners` collection remains an admin-managed organization directory, not an identity or permission system. A non-public existing partner record may be used for a host that needs internal attribution without appearing on public sponsor pages.

Partners, booth staff, workshop hosts, and **Community Partners** receive no gamification account, scanner, award, lookup, support, code-management, User-history, or raw-code access. Their only event-day role is to direct a User to a WTS-controlled evidence artifact or normal event support. Every privileged gamification write stays in a SolidStart server function using server-side PocketBase admin access; admin actions also call `requireAdmin()`.

### Automated evidence model

- QR, link, and manually entered code are delivery forms for the same WTS-generated opaque bearer code. A QR contains `/missions/redeem#code=<rawCode>`; a WTS-controlled link carries the same fragment; a manual code uses the typed entry form on that route. None proves physical presence beyond the User encountering the artifact.
- Use QR for physical signs, screens, or cards; use a WTS-controlled link for official WTS pages or community announcements; use a manual code only for a WTS-run display or announcement that needs a typing fallback. An external partner URL, form completion, game page visit, or click is never evidence and never awards a claim.
- Static evidence means a WTS-deployed QR, link, or code artifact attached to one configured Activity. It is not a partner screenshot, upload, browser signal, webhook, or server-side puzzle answer. Static evidence can be time-boxed, disabled, reissued, and audited through the existing code lifecycle.
- Raw code material is generated and displayed/exported once only to an admin. It is not stored recoverably, supplied to a partner/host/staff member, or exposed through a partner-facing surface. WTS organizers deploy any printed QR/link artifact or WTS-controlled result display; a partner can point a User to it but cannot retrieve, distribute, or manage a secret inventory.
- One-code attendance uses one `single_code` Activity and one evidence artifact in the configured time window. It is suitable for a workshop, warmup, satellite event, social, or community meetup where a single attendance checkpoint is enough.
- Two-code completion uses distinct `two_code_start` and `two_code_finish` Activities/Codes. The start code records the entrance/check-in **Activity Claim**; the finish code records the end claim. A completion **Achievement** requires the configured claim set. The flow does not infer completion from either claim alone and does not use code-ordering as a hidden verifier rule. A start Activity may separately unlock a configured attendance Badge, but completion requires both claims.
- Hi.Events remains limited to the already-decided main-conference ticket-present and checked-in evidence. Its unavailable, stale, partial, or ambiguous states never block local QR/link/code redemption for any Partner Activity.

### Booth outcomes without scanners

Each booth outcome is a separate `gamification_activities` definition linked to the booth's **Mission** and partner record: `visit`, `participation`, `completion`, `win`, or `high_score`. Each has its own key, optional **Achievement**, windows, limits, code batch/artifact, and source metadata. A claim for one outcome does not silently create another outcome; progressive Badges require their own evidence or an explicit configured unlock rule.

- `visit`, `participation`, and `completion` may use separate WTS-controlled static QR/link/code artifacts at the relevant user journey point. They are automated bearer evidence, with the residual sharing risk accepted under the existing rate-limit, window, limit, invalidation, and audit controls.
- `win` and `high_score` can be automated only when WTS controls an outcome-specific display or other artifact that is exposed to the qualifying User without giving the partner code access. A generic booth staff assertion, a score shown to staff, or a partner-operated form is not evidence.
- If that WTS-controlled outcome artifact cannot be operated fairly, do not configure the high tier as an automatic Activity. The User must use event support, and an admin may make an exceptional audited manual award after review. This is not a routine partner/staff award path.
- There is no scanner route, User lookup, tier-selection UI, or result-submission endpoint for booth staff or partners. A staff member cannot choose an outcome in WTS or use a scan to award it.

### Duplicate, limit, and cap behavior

- An accepted code redemption is idempotent by `User + code`; the resulting accepted **Activity Claim** is idempotent by `User + Activity + source/evidence fingerprint`. Repeated scans, taps, and retries return the prior safe result and never create another Badge or **XP Event**.
- A standard Partner Activity has `perUserClaimLimit = 1`. That limit applies across every code/reissue for the same Activity, so a replacement code cannot award a duplicate tier. A different outcome is a different Activity and may be earned only under its own configured limit.
- `maxRedemptions` on a code and `maxClaims` on an Activity are separate global safeguards. Rejected attempts do not consume a User limit, Activity cap, or global accepted-redemption count.
- Fairness caps are evaluated after an Activity Claim is accepted and before its XP is written. The configured `capKey` groups an Activity into an activity, partner, category, day, or conference window; scoring configuration supplies total-XP and **Leaderboard XP** ceilings independently. The later scoring decision sets the actual values, not this ticket.
- Reaching an XP cap does not erase legitimate field evidence or revoke a Badge. The claim remains accepted and rules may unlock the Badge; the evaluator records the cap outcome in safe claim/audit metadata and awards only the remaining total XP and **Leaderboard XP**, possibly zero. The user-facing result says that the evidence was recorded and must not imply a failed redemption. Exact cap messaging and numeric bands belong to `Decide Scoring, Fairness, Caps, And Leaderboard Rules`.

### Admin configuration and audit metadata

The existing `/admin/partners` surface continues to manage organization identity, publication, and logo data. The single `/admin/gamification` surface configures Partner Activities; it must not create a partner login or extend public partner DTOs with gamification controls.

Before activation, an admin configures each Partner Activity with:

- A stable Activity and Mission key, user-facing title/summary, category/kind, status, and public/hidden presentation state.
- Required partner relation and partner kind for sponsor booth or community activity; required event reference for workshop, warmup, satellite, or social activity; optional host partner relation for a WTS-run event.
- Outcome key, evidence mode/role, code delivery channel, active window, enabled state, `perUserClaimLimit`, code-level `maxRedemptions`, Activity-level `maxClaims`, and cap key/scope.
- Related **Achievement** rule(s), total-XP/**Leaderboard XP** policy reference, and any two-code start/finish or claim-set relationship.
- A required human-readable code-batch label and deployment note, but never a raw code in the persisted definition. Generation, invalidation, and reissue retain the established one-time-secret lifecycle.
- Whether optional partner-contact consent is allowed, its fixed purpose, notice/version, and the only approved contact fields: name and email. It defaults off and is unavailable for an Activity with no partner relation.

Once accepted evidence exists, identifiers, partner/event relation, outcome, evidence mode, claim-set rule, caps, and XP/Leaderboard policy cannot be changed in place. Admins retire or disable the definition and create a successor with an audited reason.

Accepted claim/source metadata is admin-only and limited to the Activity/Mission/partner or event references, outcome, code and batch IDs, evidence role/channel, safe support reference, active-config version, claimed/occurred timestamps, idempotency key, applied-cap result, and server-derived sanitized request context. It never includes raw codes, hashes, raw request fingerprints, free-form partner assertions, raw Hi.Events data, payment data, or contact-consent data. Consent has its own records and audit trail.

### Optional partner contact consent

Earning gamification progress and sharing contact details are separate actions. A User may complete every Partner Activity, decline every consent prompt, or later withdraw consent without changing any **Activity Claim**, **Achievement**, **Badge**, **XP Event**, **Leaderboard XP**, or **Gamification Profile** result.

- The only September purpose is a one-time `partner_follow_up` handoff to the named partner for the named Partner Activity. Consent is specific to the User, partner, Activity, purpose, and rendered notice version. It is never preselected, bundled into code redemption, or treated as a condition of a Badge, XP, completion, or event entry.
- The separate opt-in is shown as an unchecked post-redemption/profile action that plainly identifies the partner, purpose, privacy-notice version, and the exact data: the User's current name and email. No public profile fields, profile avatar, ticket data, badge/XP activity, attendance timestamps, consent history, raw code, or User history may be shared.
- `partner_contact_consents` or an equivalent separate consent ledger stores the User and partner/activity relations, purpose, approved field names, notice version, grant/withdraw timestamps, current state, and a minimal disclosure reference. It does not duplicate the name or email in gamification evidence or audit metadata.
- There is no automatic CRM push, email, export, or partner portal. An admin alone may make a one-time, auditable handoff of currently granted name/email to that named partner. The disclosure audit records the consent reference, partner, actor, time, and fields transferred, not the raw contact values.
- The User can see their own consent state, partner/activity label, fields, grant time, disclosure state, and a withdraw action in the authenticated profile. Withdrawal immediately prevents any future WTS handoff, records the withdrawal, and leaves gamification untouched. It cannot retract data already delivered to an external partner; the User must use the partner's stated privacy/contact route for that copy.
- Partners have no WTS account or consent query endpoint. They can receive only the explicit one-time name/email handoff. They never receive a User's gamification history, raw claims, code data, ops-board settings, Hi.Events metadata, or another User's data.

### Privacy and support boundaries

- Authenticated profile DTOs expose only the current User's Gamification Profile, safe Badge/Mission progress, redemption result, and that User's contact-consent summaries/withdrawal controls. They do not expose raw claims, XP ledger rows, code material, partner lead disclosures, or other Users.
- Public `/ops-board` keeps its established opt-out-by-default individual visibility and may show only display name, rank, level, **Leaderboard XP**, and allowed Badge snippets. It never shows Partner Activity names, partner identity, contact-consent state, attendance/activity timestamps, ticket data, or raw evidence.
- Admin support DTOs behind `requireAdmin()` may join a single User's source claims, code status, configured partner/event, cap result, and correction audit with separate consent/disclosure status when necessary. Support search and lead handoff remain distinct panels; no generic partner analytics, raw-code recovery, or broad contact export is added.
- Legitimate failures follow the established fallback: the User re-enters/scans the evidence or brings the safe Mission/support reference to WTS event support; an admin inspects the limited history and, if justified, performs an audited single-User manual award/correction. A partner, staff member, workshop host, or Community Partner may describe the situation to organizers outside the system but cannot verify, look up, or mutate it in WTS.

### Implementation boundaries for delivery briefs

- Keep user redemption on `src/routes/missions/redeem.tsx`, current-User consent/Badge summaries on `/user/profile`, and public ranking on `/ops-board`. Do not add a partner, staff, scanner, or verifier route.
- Add Partner Activity configuration, source status, support, and exceptional manual-correction controls only under protected `/admin/gamification`; keep `/admin/partners` limited to the existing organization record lifecycle.
- The authenticated server-function boundary validates a raw code and derives the User before calling a server-only evidence/accounting service. Separate current-User consent grant/withdraw functions derive the User and validate an active consent-enabled Partner Activity; they never call the award evaluator.
- The admin server-function boundary uses `requireAdmin()` and `getAdminPB()` for Partner Activity lifecycle, code generation/invalidation/reissue, support lookup, exceptional manual award, and consent disclosure logging. DTOs remain serializable and browser clients never write PocketBase gamification or consent collections directly.
- Delivery briefs 06 through 09 must implement the evidence/configuration/consent rules above; `Decide Scoring, Fairness, Caps, And Leaderboard Rules` supplies cap values and `Decide September Mission Inventory` supplies the actual activity catalog. No new Wayfinder ticket is needed.
