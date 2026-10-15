# Main-day transfer gaps and early Stage 5 — published 2026-09-17

**Later persona correction:** Darko/Miodrag are now speakers and fireside hosts, not stage MCs. Use `python3 -B scripts/fireside-host-roles.py --verify` for the current full programme; see [the correction receipt](fireside-host-roles.README.md). The times documented here remain current.

Organizer-approved data-only revision for `2026-09-19`, Europe/Skopje. Opening remains 10:00–10:10. All 27 regular talks and the existing shared coffee/lunch breaks move exactly ten minutes later. Closing moves to 16:25–16:35. Two explicit programme-wide **Stage changeover** Slots reserve 10:10–10:20 and 16:15–16:25.

## Stage 5

| Local time | Fireside | Host |
| --- | --- | --- |
| 10:20–10:55 | What does being a good developer mean now? | Miodrag Cekikj |
| 11:05–11:30 | Why don’t we build more of our own products? | Darko Bozhinovski |
| 12:00–12:35 | Who owes open source what? | Darko Bozhinovski |
| 12:45–13:10 | Would you choose a different framework if AI wrote most of the code? | Miodrag Cekikj |
| 14:00–14:35 | Have we made software development too complicated? | Miodrag Cekikj |
| 14:55–15:15 | Is the way into this industry broken? | Darko Bozhinovski |

Shared breaks are now 11:40–12:00, 13:20–14:00 (lunch), and 14:35–14:55. Gerald's regular talk is 10:20–10:55, leaving ten minutes before his 11:05 fireside; his last scheduled appearance finishes at 11:30. Darko's last fireside ends at 15:15, seventy minutes before closing. These are programme gaps, not a guarantee about airport transfer or airline deadlines.

All existing Session/Slot/Track identities, publication flags, durations, guest/host relations, photos and weekday programmes are unchanged. There are 40 main-day Slots: the previous 38 plus two changeovers, still 33 linked Sessions.

## Current verifier

**Use `python3 -B scripts/main-day-transfer-gaps.py --verify`.** This supersedes the frozen main-day, Stage 5 and hosts verifiers. It restores only the approved timing deltas/new gaps in memory before invoking the old host/Stage 5 baseline checks. Do not rewrite historical manifests or replay their publication operations to undo expected baseline differences.

```sh
# Read-only plan; after publication returns zero requests/writes.
python3 -B scripts/main-day-transfer-gaps.py
python3 -B scripts/main-day-transfer-gaps.py --verify

# Only after a fresh verified native database + external-upload backup:
python3 -B scripts/main-day-transfer-gaps.py --execute --exclusive-writer --native-backup-verified --backup-dir PRIVATE_DIRECTORY

WTS_FIXTURE_PB_BINARY=/path/to/pocketbase-0.34.0 python3 -B scripts/main-day-transfer-gaps.test.py
```

The executor requires exclusive agenda editing, preserves the existing PocketBase batch settings, and applies 37 timing PATCHes followed by two Slot creations in one 39-request transaction. Each next timing move is selected only when it is legal against every intermediate programme-wide/track Slot. No temporary tracks, publication toggles, Session writes or frontend deployment are needed.

## Verification receipt

- Five integration tests passed on PocketBase 0.34.0 with real programme hooks, including late-request rollback of all moves and the first inserted gap, lost committed response/no-op resume, exact unrelated-record preservation, insufficient batch capacity, backup/drift refusal and participant transfer checks.
- Fresh native backup passed ZIP and SQLite integrity checks; a separate archive checksum-verified all 108 referenced originals. Private recovery files and complete before-state audit remain outside the repository.
- Production transaction: 39 successful requests, exact readback verified; read-only verification and an execution replay both returned zero writes.
- Public API comparison verified all 27 regular talks shifted exactly +10 minutes, all six approved fireside clocks, the two new gaps and closing; all other public fields and weekdays match the pre-publication snapshot.
- Live mobile Stage 5 and desktop all-stage timetable verified all 40 Slots, all five stages starting 10:20, explicit transfer gaps, unchanged host presentation and closing at 16:25. Gerald's live Session page shows 11:05–11:30.

Live agenda: https://wts.sh/agenda?day=2026-09-19
