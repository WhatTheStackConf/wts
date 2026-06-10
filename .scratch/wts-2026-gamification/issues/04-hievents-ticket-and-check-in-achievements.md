# Hi.Events Ticket And Check-In Achievements

Status: ready-for-agent
Type: AFK
Created: 2026-06-06

## Parent

`.scratch/wts-2026-gamification/PRD.md`

## What to build

Award gamification progress from existing Hi.Events ticket data. A User whose email matches a Hi.Events attendee should be able to earn a ticket-linked achievement, and a User whose attendee record has a check-in should be able to earn a checked-in achievement. The system should handle Hi.Events outages gracefully and avoid treating paid ticket tier as a large leaderboard advantage.

This slice connects the gamification foundation to an existing real conference system without requiring QR mission codes.

## Acceptance criteria

- [ ] A User can trigger or receive evaluation for ticket-linked achievements using their authenticated email.
- [ ] A User with a matching Hi.Events attendee record receives a ticket-linked achievement and XP idempotently.
- [ ] A User with a checked-in Hi.Events attendee record receives a checked-in achievement and XP idempotently.
- [ ] A User without a matching attendee record receives a clear no-ticket state and no XP.
- [ ] Hi.Events API failure does not break the User profile and returns a graceful unavailable state.
- [ ] Paid ticket tier badges, if added, do not create a large leaderboard XP advantage.
- [ ] Ticket and check-in achievements appear in the profile gamification summary.
- [ ] Admin or support views can distinguish no ticket from API unavailable where practical.
- [ ] The build completes successfully.

## Blocked by

- `.scratch/wts-2026-gamification/issues/01-gamification-foundation-and-profile-mvp.md`
