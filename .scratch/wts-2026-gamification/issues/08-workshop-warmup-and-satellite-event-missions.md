# Workshop, Warmup, And Satellite Event Missions

Status: ready-for-agent
Type: AFK
Created: 2026-06-06

## Parent

`.scratch/wts-2026-gamification/PRD.md`

## What to build

Support event-scoped missions for workshops, warmup events, satellite events, socials, and related WTS activities. Organizers should be able to configure one-code attendance flows and two-code completion flows. Users should earn attendance or completion achievements through authenticated mission redemption or staff verification.

This slice should let WTS connect the main conference day with surrounding events without creating one-off custom code for each event.

## Acceptance criteria

- [ ] Admins can configure an event-scoped mission for a workshop, warmup event, satellite event, or social event.
- [ ] Event missions support at least one-code attendance flows.
- [ ] Event missions support two-code completion flows when both entrance and end evidence are required.
- [ ] Event mission codes can be time-boxed to an active window.
- [ ] A User can redeem an event mission code and receive an attendance achievement and XP idempotently.
- [ ] A User can complete a two-code flow and receive a completion achievement and XP idempotently.
- [ ] A User who only redeems the first code in a two-code flow does not receive the completion achievement.
- [ ] Staff verification can be used as an alternative to public QR redemption where configured.
- [ ] Meta achievements across event types can be represented or evaluated, such as warmup plus main conference plus afterparty.
- [ ] The build completes successfully.

## Blocked by

- `.scratch/wts-2026-gamification/issues/01-gamification-foundation-and-profile-mvp.md`
- `.scratch/wts-2026-gamification/issues/02-secure-mission-code-redemption.md`
- `.scratch/wts-2026-gamification/issues/03-admin-achievement-and-code-management.md`
