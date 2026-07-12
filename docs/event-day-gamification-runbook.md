# Event-Day Gamification Runbook

Use this checklist for `[EVENT_NAME]` on `[EVENT_DATE: YYYY-MM-DD]`. Primary owner: `[PRIMARY ON-CALL]`. Backup: `[BACKUP ON-CALL]`. Incident channel: `[CHANNEL]`.

## Pre-Event Readiness

Complete by `[READINESS_DATE: YYYY-MM-DD]`:

1. Confirm all web replicas use one PocketBase database, one `GAMIFICATION_CODE_PEPPER`, and the expected `PUBLIC_POCKETBASE_URL`/`POCKETBASE_URL` pair. Confirm `HIEVENTS_API_URL`, `HIEVENTS_EVENT_ID`, credentials, timeout, and retry settings without posting values in chat or logs.
2. Deploy and verify PocketBase migration `1786000011_harden_event_day_operations.js`. Confirm the operation-lock and rate-limit collections are private and the profile, accounting, reconciliation, and agenda indexes exist.
3. Run `pnpm test`, `pnpm typecheck`, and `pnpm build` against the release revision. Record revision `[REVISION]` and results in `[CHANGE RECORD]`.
4. In `/admin/gamification`, confirm `[CATALOG VERSION]`: active Achievements, Missions, Activities, windows, one-per-User limits, global limits, source references, cap memberships, and Badge privacy.
5. Test one sacrificial User `[TEST USER ID]`: valid redemption, duplicate redemption, disabled code, profile refresh, opt-out, private Badge, ops-board read, and audited cleanup. Never paste the raw code into a ticket or log.
6. Confirm `/agenda`, `/ops-board`, `/missions/redeem`, `/user/profile`, and `/admin/gamification` on a phone and desktop. Local Mission redemption must work while Hi.Events is deliberately unavailable.

## Score Schedule Activation

1. Freeze the source inventory and have `[SCORING OWNER]` review total-XP and Leaderboard-XP values independently.
2. Preview `[SCHEDULE KEY]`; verify Activity, related-group, partner, category, day, and conference ceilings, plus Access Levels 1 through 7.
3. Activate once with operation reference `[SCHEDULE OPERATION ID]` and reason `[REASON]`. If the response is uncertain, retry with the same operation reference. Do not create a second schedule operation.
4. Confirm the prior schedule is superseded and a test Activity receives the expected capped total and Leaderboard amounts.

## Code Export And Deployment

1. Generate batch `[BATCH LABEL]` with operation reference `[BATCH OPERATION ID]`. Download the one-time CSV/QR response immediately to approved encrypted storage `[LOCATION]`.
2. Verify quantity, Activity, evidence role, window, and limits against `[DEPLOYMENT MANIFEST]`. Scan a sacrificial artifact before distribution.
3. Record only batch ID, label, lookup prefix, artifact location, and deployment owner. Never record raw codes, hashes, or the pepper in support systems.
4. If the request committed but the one-time response was lost, secrets are unrecoverable. Mark the batch unusable, invalidate every affected code with one audited reason, then reissue with a new operation reference. Never retry generation under a new operation reference to guess whether the first batch committed.

## Hi.Events Complete Sync

1. In the Hi.Events sync tab, preview `[HIEVENTS EVENT ID]`.
2. Proceed only when state is `complete`, completed pages equal the declared traversal, and source timestamps are plausible. Review matched, ambiguous, proposed-create, and correction counts.
3. Apply using operation reference `[SYNC OPERATION ID]`. If the source changes after preview, preview again. If apply is interrupted, retry the same operation reference after a fresh preview; do not manually repeat proposed mutations.
4. Record page count, snapshot fingerprint reference, counts, and outcome in `[CHANGE RECORD]`. Do not export attendee, payment, ticket URL, or check-in details.

## Redemption Support

1. Ask for the logged-in User ID/email and visible support reference only. Do not ask the attendee to send a raw code electronically.
2. Search exact User ID/email, support reference, Mission/Activity key, safe batch label/prefix, redemption ID, or Hi.Events stable source ID in User support.
3. `already_redeemed` is success: verify one accepted Code Redemption, Activity Claim, Badge state, XP Event, and current profile cache.
4. For `rebuild_pending`, rebuild only that User's profile using the displayed support reference and a new audited rebuild operation. Do not repeat the award.
5. For a legitimate missed Activity, use the manual missed-evidence flow below. Never edit claims, Badges, XP, or cached totals directly in PocketBase.

## Invalidation And Reissue

1. Locate `[CODE ID]` by safe label/prefix or server-side verification. Confirm the Activity and prior redemption history.
2. Invalidate with reason `[INCIDENT REASON]`. Existing evidence remains; invalidation only stops new redemption.
3. Reissue from the disabled code with operation reference `[REISSUE OPERATION ID]`. Export the one-time replacement immediately. The Activity-wide per-User limit prevents a second award.
4. If an active replacement already exists, invalidate it before another reissue. Never recover or reconstruct a raw code from its hash.

## Manual Missed Evidence

1. Confirm the configured Activity, evidence time, attendee identity, and support reference `[SUPPORT REFERENCE]`.
2. Choose `missed_evidence`, target User `[USER ID]`, Achievement `[ACHIEVEMENT ID]`, Activity `[ACTIVITY ID]`, and operation reference `[MANUAL OPERATION ID]`.
3. Leaderboard XP defaults to zero. A ranking correction is allowed only for a documented WTS automation/source/accounting error and requires high-impact confirmation matching the original policy/cap result.
4. Retry only with the same operation reference. If status is `rebuild_pending`, repair the profile cache instead of repeating the award.

## Badge And XP Corrections

1. Badge revoke: revoke `[USER ACHIEVEMENT ID]` with reason and operation reference. This does not void XP.
2. XP void: void `[XP EVENT ID]` with reason and operation reference. This does not revoke the Badge or source claim.
3. Source evidence correction: void `[ACTIVITY CLAIM ID]` only when the evidence itself is unsupported. This reconciles sourced XP and automatic derived/Meta outcomes while retaining history.
4. Signed correction: create a new positive/negative XP Event. Never edit or delete an existing XP Event. Confirm total and Leaderboard deltas separately.
5. Verify the affected User's authoritative history, rebuilt profile, Badge privacy, and ops-board visibility after every correction.

## Hi.Events Outage Or Partial Sync

1. Treat `unavailable`, `partial`, malformed pagination, timeout, authentication failure, and stale data as unknown, never as no ticket.
2. Do not apply absence corrections, void claims, or communicate “no ticket” from an incomplete traversal. Preserve the last successful evidence and timestamp.
3. Keep local QR/link/manual Mission redemption open; it has no Hi.Events dependency.
4. Check credentials/configuration without exposing tokens. Respect bounded automatic retries; do not create a manual retry loop. Escalate after `[RETRY WINDOW]` to `[HIEVENTS OWNER]`.
5. When service returns, preview and verify a complete traversal before apply.

## Ops Privacy

1. Public rows may contain only rank, chosen display name, Access Level, Leaderboard XP, public Badge count, and permitted Badge snippets.
2. Never expose total XP, email, ticket/check-in state, Activity history, partner identity, consent, timestamps, code data, or admin notes.
3. Honor opt-out and global/per-Badge privacy immediately. A profile rebuild must preserve these settings.
4. If a public DTO appears unsafe, disable the public route at `[EDGE/ROUTER CONTROL]`, preserve accounting, and escalate to `[PRIVACY OWNER]`.

## Partner Consent Boundaries

1. Mission completion never grants contact consent. Consent is an unchecked, separate action for one named partner/activity, notice version, and name/email only.
2. Withdrawal blocks future WTS handoff and never changes Claims, Badges, XP, or rank.
3. A prior external handoff cannot be retracted by WTS. Direct the User to `[PARTNER PRIVACY CONTACT]` for the partner-held copy.
4. Only an admin may perform the one-time handoff. Record consent/disclosure IDs and approved field names, not copied contact values.

## Escalation

1. Severity 1: duplicate authoritative accounting, privacy exposure, broad redemption failure, database unavailability, or evidence voiding from an incomplete source. Page `[PRIMARY ON-CALL]` and `[ENGINEERING OWNER]`; freeze affected mutations, not read-only history.
2. Severity 2: one User `rebuild_pending`, isolated code loss, ambiguous ticket match, or single-Activity configuration issue. Use audited support operations and record `[INCIDENT ID]`.
3. Preserve safe evidence: operation/support references, record IDs, timestamps, app revision, source state, and sanitized error type. Never capture raw codes, hashes, tokens, emails beyond the exact support case, fingerprints, consent payloads, payment data, or ticket URLs.

## Post-Event Reconciliation

Complete by `[RECONCILIATION_DATE: YYYY-MM-DD]`:

1. Run and apply one final complete Hi.Events reconciliation. Resolve ambiguities manually; never fuzzy-link identities.
2. Review all `rebuild_pending`/failed admin actions, profile cache flags, disabled/reissued codes, cap outcomes, manual awards, voids, corrections, and partner disclosures.
3. Rebuild only affected profiles and verify ledger totals independently from Leaderboard XP. Confirm ops-board and Badge privacy remain unchanged.
4. Disable or expire event codes and retire definitions prospectively. Do not delete retained accounting or reprice historical XP.
5. Store the final schedule key, reconciliation reference, incident list, and organizer sign-off `[SIGN-OFF OWNER]` in `[EVENT ARCHIVE]`.
