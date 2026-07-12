# Session Attendance Missions

Status: ready-for-agent
Type: AFK
Created: 2026-07-09

## Parent

`.scratch/wts-2026-gamification/PRD.md`

The closed decisions in `.scratch/wts-2026-gamification/wayfinder/MAP.md` supersede conflicting PRD text.

## What to build

Support selected published **Session** attendance as configured one-code **Missions**. Each selected Session has one immutable `session.{sessionKey}.attendance` Activity with WTS-controlled single-code evidence, an independently configured deployment point/window, optional direct Badge, 20 total XP / 15 **Leaderboard XP** policy, and optional eligibility for the shared Meta Achievement evaluator.

This slice may use the Session's canonical agenda slot as schedule context and to prefill a proposed redemption window, but it stores its own Activity window and WTS-controlled evidence. Moving, publishing, or viewing an agenda slot never proves attendance or awards a Badge/XP. It does not add a Session scanner, partner/staff verification, or code distribution surface.

## Acceptance criteria

- [ ] Admins select an existing published Session and configure an immutable Activity key, Mission presentation, public/internal visibility, one-code evidence artifact, active window, per-User/global limits, cap membership, optional direct Badge, and Meta eligibility under `/admin/gamification`.
- [ ] QR, WTS link, and manual entry redeem the same single-code Activity. Repeated scans and reissued codes cannot create more than one accepted Activity Claim, Badge, or direct score result for a User.
- [ ] An accepted attendance claim applies the 20/15 total-XP/**Leaderboard XP** policy and the schedule's Activity/category/day/conference caps independently. Cap exhaustion preserves the claim and Badge and remains Meta-eligible.
- [ ] The Session Activity uses the configured display snapshot only for safe historic presentation; public Session records are not a gamification attendance source or schedule authority.
- [ ] Admin configuration can read the Session's agenda slot for schedule context, but changing that slot never changes an active Activity's evidence window, creates a Claim, or awards a Badge/XP without an explicit Activity successor/configuration action.
- [ ] Session meta eligibility registers with issue 13, which selects at most one attendance Activity per Session.
- [ ] Profile and redemption DTOs provide only safe Mission/Badge/result data. Public ops-board output never exposes Session attendance or source activity.
- [ ] Tests cover configured source reference, one-claim/reissue limits, active windows, scoring/caps, Meta registration, and DTO privacy.

## Blocked by

- `.scratch/wts-2026-gamification/issues/01-september-gamification-accounting-foundation-and-profile-read-model.md`
- `.scratch/wts-2026-gamification/issues/02-secure-mission-code-redemption.md`
- `.scratch/wts-2026-gamification/issues/03-admin-gamification-configuration-and-code-operations.md`
- `.scratch/wts-2026-gamification/issues/13-shared-meta-achievement-evaluator.md`
- `.scratch/wts-2026-gamification/issues/15-programme-agenda-data-model-and-publication.md`
