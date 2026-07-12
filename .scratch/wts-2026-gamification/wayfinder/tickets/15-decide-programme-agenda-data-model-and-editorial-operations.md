# Decide Programme Agenda Data Model And Editorial Operations

Status: closed
Assignee: OpenCode
Labels: wayfinder:grilling
Type: HITL
Created: 2026-07-09
Closed: 2026-07-09
Part of: `.scratch/wts-2026-gamification/wayfinder/MAP.md`

## Question

What normalized programme data model and editorial workflow should publish the complete WTS 2026 agenda while supplying safe schedule context to configured Session Missions?

Resolve **Conference Day**, **Track**, and agenda-slot terminology and relationships; whether Tracks are reusable across Days or day-scoped; how a slot represents a Session versus coffee breaks, lunch, opening/closing, and other non-Session content; required timing, room, visibility, ordering, and schedule-conflict constraints; public agenda and Session-page behavior; admin editing/publishing; migration of the existing optional `sessions.starts_at`, free-text `sessions.track`, and `sessions.room` fields; and the boundary that schedule data can inform Mission configuration but never itself proves attendance or awards a Badge/XP.

## Settled Inputs

- The public agenda must publish the complete programme, including Sessions, coffee breaks, lunch, and other operational entries, rather than only pairs of Sessions and time slots.
- Every agenda entry needs a Day and a time range. A Track is optional because only some Days, especially the main conference day, have concurrent tracks.
- A scheduled Session should relate to its agenda entry rather than duplicate mutable timing or Track text on the Session record.
- The existing `timeline_events` collection is marketing chronology, not an agenda source; it must not be repurposed for the programme.
- The agenda is a data/display model. Session Mission redemption still requires the established configured WTS-controlled evidence and active window; an agenda entry never creates an **Activity Claim**, Badge, total XP, or **Leaderboard XP**.

## Blocked by

None - the existing Session and Mission inventory decisions provide the relevant constraints.

## Resolution

The agenda is an ordered public read model over **Conference Days**, day-specific **Tracks**, and **Agenda Slots**. It is not a separate mutable agenda collection, and `timeline_events` remains marketing chronology.

### Conference Days and Tracks

- A **Conference Day** has an immutable key, local date in `Europe/Skopje`, title, display order, and published state.
- A **Track** belongs to exactly one Conference Day. It has an immutable key unique within that Day, name, optional location label, and display order. Tracks are intentionally day-specific rather than reusable across Days.
- A Day may have no Tracks. A Track appears publicly only when it has a visible Agenda Slot.

### Agenda Slots

- An **Agenda Slot** belongs to one Day and has required start/end instants, kind, publication state, display order, and optional location label. Its optional Track must belong to the same Day.
- Slot kinds are `session`, `break`, `meal`, `networking`, `opening`, `closing`, and `other`. A non-Session slot requires a title and summary; it cannot point to a Session. A `session` slot requires one Session and uses that Session's public presentation when published.
- A published Session has exactly one published Agenda Slot. Moving it edits that slot rather than creating a duplicate scheduled occurrence. A draft Session may be linked to a draft Slot so organisers can prepare the programme before public publication.
- All times are validated in the `Europe/Skopje` conference timezone: a Slot starts on its assigned Day and its end follows its start. A late Slot may end after midnight while remaining grouped with its start Day. Slots in one Track cannot overlap. An untracked Slot is an all-attendee entry, so it cannot overlap any tracked or untracked Slot with an overlapping time range, including a following Day; Slots in different Tracks may otherwise overlap.

### Publication and migration

- The public `/agenda` includes only Slots whose Day and Slot are both published. It groups Day, time, untracked all-attendee entries, and Tracks; Session Slots link to the public Session page, while non-Session Slots render their own content.
- A Session page gets its canonical date/time/Track/location context from its Agenda Slot. The existing optional `sessions.starts_at`, free-text `sessions.track`, and `sessions.room` fields become legacy migration data and are not a second source of truth.
- Existing data is not fabricated into Slots: `starts_at` has no end time. Admins map or clear legacy schedule values, then a later cleanup migration can remove obsolete fields after verification.
- Admin editing and publication are server-authorized. Slot/Day/Track constraints are validated server-side, not only by the schedule UI.

### Gamification boundary

An Agenda Slot may provide schedule context when an admin configures a Session Mission and may prefill a proposed redemption window. The Activity retains its own configured evidence/window. Viewing, publishing, or moving a Slot never creates an **Activity Claim**, Badge, total XP, or **Leaderboard XP**; attendance still requires the established WTS-controlled evidence.
