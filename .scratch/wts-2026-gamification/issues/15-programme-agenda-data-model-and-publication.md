# Programme Agenda Data Model And Publication

Status: ready-for-agent
Type: AFK
Created: 2026-07-09

## Parent

`.scratch/wts-2026-gamification/PRD.md`

The resolved programme-agenda decision in `.scratch/wts-2026-gamification/wayfinder/tickets/15-decide-programme-agenda-data-model-and-editorial-operations.md` is canonical for this prerequisite slice.

## What to build

Build the canonical programme schedule used to publish `/agenda` and to supply schedule context to Session configuration. The model has **Conference Days**, day-specific **Tracks**, and **Agenda Slots**; an agenda is the ordered public read model derived from those records, not a separate mutable collection.

An **Agenda Slot** represents either one scheduled published **Session** or a non-Session programme entry. Non-Session slot kinds are `break`, `meal`, `networking`, `opening`, `closing`, and `other`; coffee breaks and lunch are ordinary published slots, not marketing timeline events. All times use the `Europe/Skopje` conference timezone.

## Acceptance criteria

- [ ] A Conference Day has an immutable key, local conference date, title, display order, and publication state.
- [ ] A Track belongs to exactly one Conference Day and has an immutable day-local key, name, optional location label, and display order. Tracks do not exist globally or across Days.
- [ ] An Agenda Slot has a Conference Day, optional Track from that same Day, required start/end instants, kind, publication state, order, optional location label, and either a Session relation or a non-Session title/summary according to its kind.
- [ ] A `session` slot requires exactly one Session. A published session slot requires a published Session; draft slots may prepare a draft Session. A non-Session slot requires title/summary content and cannot carry a Session relation. A published Session appears in exactly one published Agenda Slot.
- [ ] A Slot starts on its Conference Day in `Europe/Skopje` and ends after it starts. A late Slot may end after midnight while remaining grouped with its start Day. Slots in the same Track cannot overlap. An untracked slot is an all-attendee slot and cannot overlap any tracked or untracked slot with an overlapping time range, including a following Day; slots in different Tracks may otherwise overlap.
- [ ] Public agenda output includes only Slots whose Day and Slot are published, ordered by Day, time, all-attendee slot, and Track. Tracks with no visible Slots are omitted. Session slots link to their public Session page; non-Session slots render their configured programme content.
- [ ] A public Session page derives its canonical schedule context from its Agenda Slot. It no longer reads the legacy optional `sessions.starts_at`, free-text `sessions.track`, or `sessions.room` fields as a source of truth.
- [ ] Existing schedule fields remain read-only migration data until administrators map or clear them. Because `starts_at` has no end time, migration must not fabricate a complete Agenda Slot; cleanup/removal happens only after schedule records are verified.
- [ ] Admin-only agenda editing lives under a protected programme/agenda surface, validates all relation and conflict rules server-side, and supports Day/Track/Slot drafts and publication without browser-direct writes.
- [ ] `timeline_events` remains marketing chronology and is not reused for agenda slots. Agenda data is schedule context only: it never creates a gamification **Activity Claim**, Badge, total XP, or **Leaderboard XP**.
- [ ] Tests cover timezone/day boundaries, Track ownership, slot kind/session constraints, overlap rules, day/slot visibility, public DTO allowlisting, legacy-field non-authority, and server-side admin authorization.

## Blocked by

None - this is a programme prerequisite that can proceed alongside the gamification accounting foundation.
