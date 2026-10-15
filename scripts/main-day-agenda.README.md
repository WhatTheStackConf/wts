# Main-day agenda publication

**Current live revision:** [Transfer gaps and early Stage 5](main-day-transfer-gaps.README.md), published `2026-09-17`. Use `python3 -B scripts/main-day-transfer-gaps.py --verify`. It supersedes all historical verifier commands below; regular talks/breaks are ten minutes later, Stage 5 is reordered, and closing is 16:25–16:35.

Publishes the reviewed `2026-09-19` revision-4 baseline: 27 linked talks (25 full-length, two short), five tracks, and 36 slots (including four Stage 5 TBD blocks). Speaker/session identities and public event membership are pinned in `main-day-agenda.manifest.json`; drift or collisions fail closed. Verification resolves the pinned main-day Session IDs, allowing speakers to have separate weekday talks without selecting those talks accidentally.

## Stage 5 publication — 2026-09-16

The approved `stage5-agenda.manifest.json` supersedes the baseline's four unlinked Stage 5 placeholders with six fireside Sessions and Slots, starting at 11:50. All 15 interested guests are included. Revision 2 adds Santosh Yadav as the fourth guest on “Who owes open source what?”, retaining his complexity fireside: Santosh appears twice and everyone else once (16 appearances). Nicolas Frizzarin and Michael Egger-Zikes retain Angular Day membership and gain organizer-confirmed main-day membership. The 27 original talks, other stages, shared breaks and weekday programme are unchanged. There are now 38 main-day Slots, including 33 linked Sessions.

Use `python3 -B scripts/stage5-agenda.py` for current read-only verification: a completed publication returns zero requests/writes. The old revision-4 verifier intentionally rejects the superseded Stage 5 state; do not regenerate or republish the baseline to repair that expected difference.

Publication uses the already-enabled PocketBase batch API for one atomic transaction: two speaker membership updates, unpublish/delete four unlinked placeholders, create six published fireside Sessions, and create their six published Slots. No existing linked Session is unpublished. Exact readback checks every agenda/source record against the allowed delta, and reruns perform no writes. The executor requires `--execute --exclusive-writer --backup-dir PRIVATE_DIRECTORY`, containing a fresh successful `independent-verification-receipt.json` for native database and referenced-upload recovery coverage.

Revision 1 → 2 uses one atomic PATCH to the existing open-source Session's `speakers` relation; it does not recreate Slots or change publication or timings. It rejects any other drift, verifies the exact allowed delta, and reruns with zero writes.

Run `WTS_FIXTURE_PB_BINARY=/path/to/pocketbase-0.34.0 python3 -B scripts/stage5-agenda.test.py`. Seven real-hook tests cover exact publication/no-op, late-failure transaction rollback, missing event membership rejection, committed-response loss, drift/missing-audit refusal, and the one-record amendment with exact preservation and lost-response recovery. This is data-only publication; no frontend release is required.

## Main-day revision 4

Approved on `2026-09-12`: Andjelina moves from Stage 4 15:30–15:50 to **Stage 3 15:05–15:25**, directly after Dragan (14:45–15:05). Stage 4 now ends with Domagoj at 15:20; Stage 3 ends at 15:25. Her title, abstract and 15+5 format are unchanged; no AI classification is added. Everything else from revision 3 is preserved.

`python3 -B scripts/main-day-agenda.revise4.py` performs a read-only preflight. With a fresh verified native backup and uploaded-file recovery coverage, apply using `--execute --exclusive-writer --native-backup-verified --backup-dir PRIVATE_DIRECTORY`. One atomic record PATCH changes only her existing Slot's track, start/end and display order; no batch API, holding track, deletion, Session write or publication toggle is needed. Exact readback compares all agenda/source records. Verify using `python3 -B scripts/main-day-agenda.py verify --expect published`; rerunning `main-day-agenda.revise4.py` must return zero requests/writes. Real-hook tests cover overlap rejection with unchanged prior state, lost committed response, missing backup, concurrent drift and no-op reruns.

## Main-day revision 3

Approved on `2026-09-12`. Riste Oreshkovski moves to public Stage 2 at 14:45–15:20 as a full-length speaker. Dragan Shahpaski closes Stage 3 at 14:45–15:05. Stage 4 runs Goran, Serena, Faris, Stefan, Bogdan, Domagoj, Andjelina at the aligned starts; Andjelina retains 15+5 and ends at 15:50. Stage 1, Stage 5, public numbering, shared opening/breaks/closing and all linked Session/Slot/Track identities are unchanged. Only the three unlinked regular-stage TBD records are removed.

For an already-published revision-2 database, use `python3 -B scripts/main-day-agenda.revise3.py` for read-only preflight. After verifying a native backup **and uploaded-file recovery coverage**, pause other agenda editors and run:

```sh
python3 -B scripts/main-day-agenda.revise3.py --execute --exclusive-writer --native-backup-verified --backup-dir PRIVATE_DIRECTORY
python3 -B scripts/main-day-agenda.py verify --expect published
python3 -B scripts/main-day-agenda.revise3.py
```

The native-backup flag acknowledges a separately verified backup; the script's private JSON audit is not a full backup. When uploads live in S3, native PocketBase backups do not include those objects: retain a separate verified copy of all original uploads referenced by the backed-up database. Never put these private archives or audit snapshots in the repository.

The existing enabled batch API applies all 16 operations in one transaction. Unlinked placeholders are unpublished then deleted; Andjelina is held on a transaction-local track while Stage 4 rotates. The holding track is removed before commit. No linked Session or Slot is unpublished. Preflight rejects unexpected drift; exact readback checks every collection in the agenda graph, including unchanged weekday/source records. Completed reruns perform zero writes. Stage/publish must not be used to migrate an already-published earlier revision.

`pnpm run test:agenda-revision` exercises all revision migrations with real hooks, including rollback of placeholder deletions after late-batch failure, overlap rejection, lost committed responses and no-op reruns. Pin `WTS_FIXTURE_PB_BINARY` to production PocketBase 0.34.0 as described below. This is a data-only publication; no frontend release is required.

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
