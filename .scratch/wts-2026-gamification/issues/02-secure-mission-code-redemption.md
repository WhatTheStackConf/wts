# Secure Mission Code Redemption

Status: ready-for-agent
Type: AFK
Created: 2026-06-06

## Parent

`.scratch/wts-2026-gamification/PRD.md`

## What to build

Build secure mission code redemption for authenticated Users. A User should be able to follow a mission link from a QR code, authenticate if needed, redeem the code, and receive a clear success, already-redeemed, invalid, disabled, or expired result. Successful redemption should create an activity claim, unlock the configured achievement when appropriate, write XP events idempotently, and update the User's gamification summary.

This slice should replace the previous edition's public unlock-hash pattern with server-authenticated redemption and hashed code storage.

## Acceptance criteria

- [ ] Mission codes are stored in a way that does not expose raw redeemable secrets in public achievement data.
- [ ] A mission link can be opened by a User and redeemed through a server-side action.
- [ ] Redemption derives the User from authentication and never accepts an arbitrary User ID from the client.
- [ ] Unauthenticated Users are redirected or prompted to log in, then can resume redemption.
- [ ] Redeeming a valid active code creates an activity claim and awards the configured achievement and XP.
- [ ] Redeeming the same code twice by the same User is idempotent and returns an already-redeemed result.
- [ ] Invalid, disabled, expired, not-yet-active, max-redemption, and per-User-limit states return clear user-facing messages.
- [ ] Successful and unsuccessful redemption screens are usable on mobile.
- [ ] Awarded XP is reflected in the User's profile summary after redemption.
- [ ] The build completes successfully.

## Blocked by

- `.scratch/wts-2026-gamification/issues/01-gamification-foundation-and-profile-mvp.md`
