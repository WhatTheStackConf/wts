# Admin Achievement And Code Management

Status: ready-for-agent
Type: AFK
Created: 2026-06-06

## Parent

`.scratch/wts-2026-gamification/PRD.md`

## What to build

Give admins enough management surface to configure gamification without code changes for each mission. Admins should be able to create and edit achievements, generate mission codes, set active windows and redemption limits, associate codes with achievements or activities, and invalidate leaked or incorrect codes.

This slice should make QR mission preparation operational before event day while keeping all privileged operations behind admin authorization.

## Acceptance criteria

- [ ] Admins can create and edit achievements with category, XP, rarity, icon, visibility, and active state.
- [ ] Admins can generate one or more mission codes for an achievement or configured activity.
- [ ] Generated codes support labels, active windows, max redemptions, per-User limits, and enabled/disabled state.
- [ ] Admins can invalidate a code without deleting redemption history.
- [ ] Admins can see enough code metadata to prepare QR signage without exposing unrelated secrets to regular Users.
- [ ] Non-admin Users cannot create achievements or mission codes.
- [ ] The admin workflow can produce a code that the secure mission redemption flow can redeem.
- [ ] The build completes successfully.

## Blocked by

- `.scratch/wts-2026-gamification/issues/01-gamification-foundation-and-profile-mvp.md`
- `.scratch/wts-2026-gamification/issues/02-secure-mission-code-redemption.md`
