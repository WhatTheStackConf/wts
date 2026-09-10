# Main-day agenda publication

Publishes the reviewed `2026-09-19` manifest: 27 linked talks, five tracks, and 39 slots (including seven consistently labelled TBD placeholders). Speaker/session identities and public event membership are pinned in `main-day-agenda.manifest.json`; drift or collisions fail closed.

## Main-day revision 2

Revision 2 preserves record IDs, immutable Track keys and Session links. Public numbering/order changes from old 2 → new 1, old 3 → new 2, old 1 → new 3; stages 4 and 5 are unchanged. The new Stage 1 starts with Alexander Lichter (10:10), Alem Tuzlak (10:55), Sam Vloeberghs (11:50), and Kiril Zafirov (12:35), all Europe/Skopje. Remaining talks, breaks and TBDs retain their windows.

For an already-published revision-1 database, do **not** use stage/publish to rewrite it. After verifying a native backup, run `python3 -B scripts/main-day-agenda.revise.py` for a read-only preflight, then `python3 -B scripts/main-day-agenda.revise.py --execute --backup-dir PRIVATE_DIRECTORY`. This requires the existing enabled PocketBase batch API and applies the timing moves and stage labels in one transaction. A temporary holding track resolves overlap constraints and is deleted in the same transaction. No public Session or Slot is unpublished. Unexpected drift fails closed; a completed rerun is a no-op. Verify with `python3 -B scripts/main-day-agenda.py verify --expect published`.

`pnpm run test:agenda-revision` exercises the production-pinned real hooks, successful migration, no-op rerun, overlap rejection and full rollback after a deliberately injected late-batch failure. Select the binary with `WTS_FIXTURE_PB_BINARY` as described below.

## Announced weekday lineups

The requested Monday–Friday TBA views are a separate, explicitly announced marketing lineup in `src/lib/conference-week-agenda.ts`, not publication of draft Event Programmes or Slots. They reuse the public homepage announcements and only expose published Appearance Events, Sessions, and Speakers. They intentionally remain visible while the corresponding timed Conference Day is still a draft (including the existing Monday draft). Publishing a timed programme replaces its TBA fallback. Hiding a timed day alone does not withdraw the public announcement: unpublish the Appearance Event or remove its explicit announcement to withdraw that lineup.

Angular Day's organizer-confirmed `2026-09-18` timetable is projected by `src/lib/angular-day-agenda.ts` through the same announcement layer. Doors open at 10:00; six 30-minute presentation slots start at 10:30, with breaks at 12:00–12:15 and 13:45–14:00 (Europe/Skopje). It reuses the five selected public Angular sessions; Kiril Zafirov has a timed speaker placeholder until an Angular topic is explicitly assigned. No PocketBase records are created or published by this projection. A published PocketBase programme still takes precedence. Source changes require a frontend release.

## Preflight and backup

- Read-only default: `python3 -B scripts/main-day-agenda.py dry-run`.
- Credentials are `WTS_PB_URL` and `WTS_PB_API_KEY`, read from the environment or literal assignments in `~/.zshrc`. To use a refreshed file rather than stale inherited variables, prefix commands with `env -u WTS_PB_URL -u WTS_PB_API_KEY`. Values are never printed; the shell file is not executed.
- Before production writes, obtain and verify a restorable native PocketBase backup, including files. The script's private JSON snapshots are audit/recovery evidence, **not a complete database backup**.
- Pause other agenda editors. The lock only excludes another publisher on this machine; it is not a distributed lock.

## Stage, publish, verify

Use a private, mode-0700 backup directory in place of `PRIVATE_DIRECTORY`:

```sh
python3 -B scripts/main-day-agenda.py stage --execute --exclusive-writer --backup-dir PRIVATE_DIRECTORY
python3 -B scripts/main-day-agenda.py verify --expect staged
python3 -B scripts/main-day-agenda.py publish --execute --exclusive-writer --accept-partial-publication --backup-dir PRIVATE_DIRECTORY
python3 -B scripts/main-day-agenda.py verify --expect published
```

Staging creates an unpublished day and unpublished slots. Publishing first opens the day, then uses the existing authenticated `/api/wts/programme/agenda-slots/{id}/publication` operation for each slot. That endpoint is transactional per slot/session, **not for the whole day**: readers can temporarily see a partial programme. Each write is read back; repeated completed publication is a no-op.

If a write fails or its response is uncertain, the script stops without automatic retry or rollback. Run the read-only preflight to inspect the phase, then explicitly resume `stage` or `publish`. Missing records under a published day and unexpected record/source changes block automatic repair.

Do not manually unpublish a session slot as a rollback: the coordinated endpoint also unpublishes its linked session, which was already publicly listed before scheduling. The publisher refuses that operation. Its guarded `rollback` mode can only return to staged state before any session slot is public; once one is public, resume publication or plan a separately reviewed recovery.

## Verification fixture

```sh
pnpm run test:agenda-publication
python3 -B scripts/main-day-agenda.fixture.py exercise --directory /tmp/NEW_ISOLATED_DIRECTORY
```

The fixture runs actual repository migrations and the programme public-field, appearance-event, and agenda validation hooks. It copies no production credentials or private database. Its marker records hook hashes and the binary version. Tests cover interrupted staging, interrupted publication, idempotent resume, blocked unsafe rollback, real hook rejection, and unrelated-data preservation.

For release verification, match the binary to `pocketbase/Dockerfile`; the repository's local binary/download script can be older. Supply an independently downloaded binary with `WTS_FIXTURE_PB_BINARY=/absolute/path/to/pocketbase`. Never replace the developer's local database or weaken production hooks for a fixture.
