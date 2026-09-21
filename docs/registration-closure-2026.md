# WTS 2026 registration closure

Closed on 2026-09-21 after the conference.

## Policy

- PocketBase `users.createRule = null`: only superusers can provision new accounts. Both public password signup and first-time OAuth account creation are denied. Existing password/OAuth sign-in, verification recovery, profile updates, and historical records remain available.
- Hi.Events event `5` (`WhatTheStack 2026`) is `ARCHIVED`. Public checkout is no longer available, including promo/hidden products. Existing tickets/orders are not cancelled; already-reserved checkouts can finish until their original reservation expiry. Authenticated organizers retain administrative access.
- `/register`, `/tickets`, and the seven printed promotional QR routes show the closure notice. Weekday, navigation, hero and secondary ticket links no longer advertise registration.
- External partner systems (GDG/Eventbrite) are not administered by this change; their booking CTAs on WTS now point to the local notice.

## Persistence and release

`1791000000_close_public_registration.js` persists the account policy in future PocketBase deployments. For this release the exact rule was applied through the authenticated collection API and read back without restarting PocketBase or supervised check-in workers. Other authentication/rules configuration, user count, and all 13 Hi.Events catalogue product identities/configuration were compared before/after and unchanged.

A consistent SQLite online backup of both databases plus local storage was taken before the rule change, integrity-checked and checksummed. Private backup/operation receipts are on the production host at `/root/wts-backups/registration-closure-20260921-105513/`. Externally stored uploads were not modified.

The web component release preserves the already-deployed crew raffle and PocketBase authentication timeout fix. Those live source deltas are recorded separately in commit `a2d6ff0`; building the prior Git tip alone would have removed them. Existing raffle configuration is preserved, not rotated or extended.

Coolify auto-deploy was already disabled and remains unchanged. Publish through a verified web-only component build from the exact source revision; do not use a whole-stack restart for this closure.

## Verification

- `pnpm test`, `pnpm test:auth`, `pnpm test:crew-raffle`, `pnpm typecheck`, `pnpm check`, `pnpm build`.
- `WTS_AUTH_TEST_PB_BINARY=<PocketBase 0.34.0 binary> pnpm test:auth-browser`: real built app and disposable OAuth provider; new account denial, existing password/OAuth login, HttpOnly session, and verification recovery.
- `node scripts/registration-closed-smoke.mjs <base URL>`: desktop/mobile closure pages, every printed QR route, no checkout/signup controls, existing login and no horizontal overflow.
- Live readback: locked collection create rule, password and OAuth still enabled, event archived, public event unavailable, public user create returns 403. No live accounts or orders are created by the probes.

## Reopening

Reopening is a separate organizer decision, not part of rollback of a web presentation fix. Restore the reviewed previous create rule and event status only with explicit authorization. Do not delete registrations, revoke existing accounts, alter ticket inventory or invalidate in-flight reservations just to close new intake.
