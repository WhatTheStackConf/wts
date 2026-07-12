# Admin Manual Awards And Audit History

Status: ready-for-agent
Type: AFK
Created: 2026-06-06

## Parent

`.scratch/wts-2026-gamification/PRD.md`

The closed decisions in `.scratch/wts-2026-gamification/wayfinder/MAP.md` supersede conflicting PRD text.

## What to build

Add the single-User support and audit tools required for event day as protected tabs within `/admin/gamification`. Admins should be able to manually award a **Badge**, revoke a **Badge**, void an **XP Event**, apply a signed positive/negative XP correction, rebuild a **Gamification Profile** cache, and inspect a **User**'s gamification history without deleting authoritative evidence.

This slice should make the system operable under real event-day support conditions without deleting historical records.

## Acceptance criteria

- [ ] Admins can manually award an **Achievement** to one target **User** with a required reason and confirmation, creating an audited `admin_manual` **Activity Claim**, **Badge**, and any configured **XP Event** idempotently.
- [ ] Manual awards default to zero **Leaderboard XP**; a nonzero ranking adjustment requires an explicit separate confirmation.
- [ ] Admins can revoke a **Badge** without deleting its User Achievement record, void an **XP Event** without deleting it, and choose those corrections independently.
- [ ] Admins can add a signed positive or negative `admin_correction` **XP Event** instead of editing existing accounting, deliberately choosing total-XP and **Leaderboard XP** deltas.
- [ ] Every correction/audit action has server-derived actor, target **User** when relevant, required reason, timestamp, correlation/idempotency ID, affected record links, safe before/after or delta summary, and sanitized failure/retry state.
- [ ] Voided XP no longer counts toward total XP or **Leaderboard XP**; revoking a Badge does not silently void XP, and voiding XP does not silently revoke a Badge.
- [ ] Each completed manual action rebuilds the target **Gamification Profile** from authoritative non-voided/non-revoked history while preserving the User's ops-board visibility, display name, and Badge privacy settings.
- [ ] A failed cache rebuild leaves authoritative history intact, is visible as `rebuild_pending`, and can be repaired by an idempotent single-User rebuild without repeating the award/correction.
- [ ] Admins can search case history by exact WTS User ID/email/display name, support reference, Mission/Activity/Achievement key, code label/prefix, redemption ID, or Hi.Events stable source ID and view relevant claims, XP, corrections, cache, and audit history.
- [ ] Support/debug DTOs exclude raw Mission codes/hashes, API tokens, raw request fingerprints, payment data, ticket URLs, and unrelated Users; regular **Users**, partners, staff, and community accounts cannot manually award, revoke, void, correct, rebuild, or inspect history.
- [ ] There is no generic bulk manual award/correction operation for September; retries and duplicate submissions resolve to existing action results rather than duplicate accounting.
- [ ] A Badge-only manual award defaults to 0/0. A missed-evidence remediation may use the concrete Activity's total-XP policy but still has zero **Leaderboard XP** by default; a nonzero ranking delta is limited to correcting an identified WTS automation, source-sync, or prior-accounting error, must match that Activity's policy/cap outcome, identify the source reference, and receive high-impact confirmation.
- [ ] Retiring, disabling, or replacing a score policy never reprices, backfills, or strips prior accepted Claims, Badges, or XP Events. A void does not reflow released cap capacity into earlier capped claims; an exceptional accounting error uses a new audited correction.
- [ ] Every privileged server-function contract calls `requireAdmin()`. The support surface also exposes compact case-relevant code/activity counts, last attempt/success, profile-cache state, and Hi.Events reconciliation links without becoming a partner analytics or raw-attendee export surface.
- [ ] Tests cover authorization, one-User idempotency, independent Badge/XP corrections, high-impact leaderboard confirmation, failed rebuild recovery, audit redaction, and history search boundaries.
- [ ] The build completes successfully.

## Blocked by

- `.scratch/wts-2026-gamification/issues/01-september-gamification-accounting-foundation-and-profile-read-model.md`
- `.scratch/wts-2026-gamification/issues/03-admin-gamification-configuration-and-code-operations.md`
