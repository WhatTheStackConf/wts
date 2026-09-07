# Main-day agenda publication

Publishes the reviewed `2026-09-19` manifest: 27 linked talks, five tracks, and 39 slots (including seven consistently labelled TBD placeholders). Speaker/session identities and public event membership are pinned in `main-day-agenda.manifest.json`; drift or collisions fail closed.

## Announced weekday lineups

The requested Monday–Friday TBA views are a separate, explicitly announced marketing lineup in `src/lib/conference-week-agenda.ts`, not publication of draft Event Programmes or Slots. They reuse the public homepage announcements and only expose published Appearance Events, Sessions, and Speakers. They intentionally remain visible while the corresponding timed Conference Day is still a draft (including the existing Monday draft). Publishing a timed programme replaces its TBA fallback. Hiding a timed day alone does not withdraw the public announcement: unpublish the Appearance Event or remove its explicit announcement to withdraw that lineup.

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
