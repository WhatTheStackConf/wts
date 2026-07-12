# Admin Gamification Configuration And Code Operations

Status: ready-for-agent
Type: AFK
Created: 2026-06-06

## Parent

`.scratch/wts-2026-gamification/PRD.md`

The closed decisions in `.scratch/wts-2026-gamification/wayfinder/MAP.md` supersede conflicting PRD text.

## What to build

Give admins the configuration and code-operations surface for the September gamification release. `/admin/gamification` is the single protected operations route; `/admin/partners` remains an organization-record surface only. Admins manage draft/active/retired **Achievements**, **Missions**, and Activities; activate the versioned score schedule; generate code batches; inspect compact operational status; invalidate leaked/incorrect codes; and reissue replacements without exposing stored secrets.

This slice should make QR mission preparation operational before event day while keeping all privileged operations behind admin authorization.

## Acceptance criteria

- [ ] Admins can create and edit draft **Achievements**, **Missions**, and Activities with their configured category, Badge presentation/rules, Activity-owned XP/**Leaderboard XP** policy, source/evidence mode, windows, limits, cap membership, and lifecycle state.
- [ ] Draft validation rejects missing source references, invalid claim-set rules, incompatible score/cap groups, missing windows/limits, and inactive/retired dependencies before activation.
- [ ] Activating, retiring, or changing an accounting-affecting live definition is confirmed and audited; used definitions are retired/replaced rather than retroactively changing historical accounting.
- [ ] Score-bearing activation records a versioned policy/cap schedule calculated from active September policies. Draft, retired, disabled, total-only, and historic policies cannot enlarge **Leaderboard XP** capacity; successor policies apply only to future claims.
- [ ] Admins can generate up to 100 raw Mission codes for a configured Activity with required label, evidence role, active window, max redemptions, and per-**User** limits.
- [ ] Raw codes, QR/link URLs, and export are available only in the one-time generation response; later views expose only safe batch label, prefix, status, counts, and record links.
- [ ] Support can look up a code by safe batch ID, label, prefix, related Activity/Mission, redemption support reference, or server-side raw-code verification without storing or returning the raw input.
- [ ] Admins can invalidate one code with confirmation and reason without deleting redemption history, and can reissue a fresh replacement linked to the same Activity without allowing a second per-User award.
- [ ] One-time code-generation retries use a stable operation ID and return the committed result when available; a lost secret response is never regenerated or recovered and is resolved by invalidation/reissue.
- [ ] Every configuration mutation, generation, invalidation, and reissue writes an admin audit action without raw code/hash/token data.
- [ ] Non-admin **Users** cannot create or alter definitions, codes, or audit records; the admin workflow produces codes redeemable only through the secure server-side Mission flow.
- [ ] The protected operations route provides compact code/activity/cache status: active/disabled state, accepted/rejected counts, last attempt/success, related Activity/Mission, and profile-cache state without raw secrets or partner/private User data.
- [ ] Tests cover `requireAdmin()` authorization, draft validation, no-delete/successor lifecycle, one-time code generation/retry, invalidation/reissue, and safe admin DTOs.
- [ ] The build completes successfully.

## Blocked by

- `.scratch/wts-2026-gamification/issues/01-september-gamification-accounting-foundation-and-profile-read-model.md`
- `.scratch/wts-2026-gamification/issues/02-secure-mission-code-redemption.md`
