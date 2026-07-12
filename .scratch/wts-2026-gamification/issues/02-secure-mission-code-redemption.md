# Secure Mission Code Redemption

Status: ready-for-agent
Type: AFK
Created: 2026-06-06

## Parent

`.scratch/wts-2026-gamification/PRD.md`

The closed decisions in `.scratch/wts-2026-gamification/wayfinder/MAP.md` supersede conflicting PRD text.

## What to build

Build secure Mission-code redemption for authenticated **Users**. A User follows a QR/link to `/missions/redeem#code=<rawCode>`, authenticates if needed, redeems the code, and receives a clear safe result. Successful redemption creates an **Activity Claim**, evaluates the configured Badge rule, applies the Activity-owned score policy once, and updates the **Gamification Profile**.

This slice should replace the previous edition's public unlock-hash pattern with server-authenticated redemption and hashed code storage.

## Acceptance criteria

- [ ] Raw codes are opaque high-entropy bearer secrets with at least 128 bits of entropy and a random non-semantic lookup prefix. Server lookup uses a peppered HMAC and timing-safe comparison; raw code values are never persisted after the one-time admin generation response.
- [ ] A Mission link uses `/missions/redeem#code=<rawCode>`. Browser code stores one TTL-bound pending code in tab-scoped session storage, strips the fragment, and resumes only to `/missions/redeem` after authentication.
- [ ] Redemption derives the User from authentication and never accepts an arbitrary User ID from the client.
- [ ] Unauthenticated Users are redirected or prompted to log in, then can resume redemption.
- [ ] Redemption rate-limits authenticated User, request fingerprint, and parseable prefix before code lookup without becoming a code-existence oracle.
- [ ] Redeeming a valid active code creates an **Activity Claim**, evaluates the configured Badge rule, and writes the Activity policy's idempotent XP result without a second Badge-based direct XP award.
- [ ] An accepted Activity Claim evaluates Badge eligibility before independently applying Activity, related-group, partner, category, day, and conference total-XP/**Leaderboard XP** caps; a fully capped claim remains accepted and is presented as recorded rather than failed.
- [ ] Redeeming the same code twice by the same User is idempotent and returns an already-redeemed result.
- [ ] Invalid, disabled, expired, not-yet-active, max-redemption, and per-User-limit states return clear user-facing messages.
- [ ] Successful and unsuccessful redemption screens are usable on mobile.
- [ ] Awarded XP is reflected in the User's profile summary after redemption.
- [ ] A recognized rejected redemption creates an attempt-scoped non-awarding audit row; a completely invalid raw code creates no redemption record. Neither consumes a code, Activity, or User limit.
- [ ] Public redemption results are serializable safe DTOs that never reveal raw codes, hashes, prefixes, private partner metadata, audit reasons, or another User's data.
- [ ] Tests cover fragment-safe auth resume, valid/already-redeemed/invalid/disabled/window/limit/rate-limit states, idempotent accounting, cap-exhausted success treatment, and public DTO allowlisting.
- [ ] The build completes successfully.

## Blocked by

- `.scratch/wts-2026-gamification/issues/01-september-gamification-accounting-foundation-and-profile-read-model.md`
