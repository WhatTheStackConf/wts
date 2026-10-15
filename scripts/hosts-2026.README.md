# WTS 2026 hosts

**Current programme verification:** the `2026-09-17` [transfer-gap revision](main-day-transfer-gaps.README.md) supersedes the host-era timing baseline. Use `python3 -B scripts/main-day-transfer-gaps.py --verify`, not the historical standalone host verifier below. Profiles and host assignments are unchanged.

Adds Darko Bozhinovski and Miodrag Cekikj as public speaker/MC profiles for the main conference, with original photos. Darko's profile is adapted from [darko.io](https://darko.io/about), with socials/photo from its homepage. Miodrag's spelling, affiliation, bio, socials and photo are copied from [his public 2025 profile](https://2025.wts.sh/speakers/h9h0gx78e9npo81); no old Session or private contact data is imported. Sources checked on `2026-09-17`.

## Approved credits

- **Darko:** Who owes open source what?; Is the way into this industry broken?; Why don’t we build more of our own products?; opening and closing.
- **Miodrag:** What does being a good developer mean now?; Have we made software development too complicated?; Would you choose a different framework if AI wrote most of the code?

Each fireside retains every guest in its original order, adds its host to the speaker relation, and gets an explicit “Hosted by …” paragraph. Opening and closing retain their shared, non-Session Slot kinds and receive a plain-text host credit in their existing summaries (the schema deliberately forbids Session relations for these kinds). This does not invent separate talks, stages or times.

## Execution and verification

`hosts-2026.manifest.json` is additive. **After publication, use `hosts-2026.py verify` instead of the frozen Stage 5/main-day verifiers.** It checks the full prior programme after reversing only these approved host-credit deltas in memory. Do not rewrite the older manifests to erase their historical baseline.

```sh
python3 -B scripts/hosts-2026.py
python3 -B scripts/hosts-2026.py stage --execute --exclusive-writer --native-backup-verified --backup-dir PRIVATE_DIRECTORY
python3 -B scripts/hosts-2026.py publish --execute --exclusive-writer --native-backup-verified --backup-dir PRIVATE_DIRECTORY
python3 -B scripts/hosts-2026.py verify
```

Before any production write, take and verify a fresh native PocketBase backup and supplemental originals archive when uploads live externally. `--native-backup-verified` acknowledges that separate operation; the script's JSON audit alone is not a full backup. Keep all recovery files outside the repository, mode 0700 directories/0600 files. Pause concurrent programme editors. Credentials use the established main-day importer loader; never print them.

Draft photo uploads are individually resumable and hash-verified. Publication is one existing-enabled PocketBase batch containing two publication flags, six Session updates and two shared Slot updates. Do not enable batch settings silently. Exact full-graph readback rejects unrelated changes. Identity collisions, content drift, partial publication and unexpected Session assignments fail closed. Both staging and publication reruns are no-ops.

```sh
WTS_FIXTURE_PB_BINARY=/path/to/pocketbase-0.34.0 python3 -B scripts/hosts-2026.test.py
```

The suite uses production-pinned PocketBase, real migrations and programme hooks. It covers original-photo readback, exact assignments, preserved guests/timings/records, missing-backup refusal, duplicate identity refusal, interrupted upload, late batch rollback, lost committed response and no-op resume. Public acceptance must also check both hydrated profile pages, six Session pages, speaker list and main-day agenda at desktop/mobile widths; images must decode. Database publication needs no frontend deployment.

## Publication receipt — 2026-09-17

Both profiles and all eight credits were published and exact readback verified. Publication replay performed zero writes. A native database backup passed ZIP and SQLite integrity checks; a separate archive verified all 106 referenced originals. Private backup/audit material remains outside this repository.

- Five importer tests passed against PocketBase 0.34.0 and real programme hooks.
- `pnpm typecheck` passed.
- The configured JS suite passed 1,444 tests (one skipped) after excluding `.hermes/**` nested worktrees. The unfiltered command incorrectly collected nested worktree suites; the filtered run still emitted the existing Vite shutdown timeout warning.
- Both public profiles show their three assigned firesides, bios/socials and decoded photos at desktop/mobile widths. Both appear in the speaker list.
- All six hydrated Session pages show the correct explicit host credit and profile link.
- Mobile Stage 5 selection works; opening/closing credits render, with no horizontal overflow. Screenshot inspection confirmed readable opening/fireside presentation.
- Public API comparison found exactly six additional host relations and two shared summary credits across the unchanged 47 public slots. All other public agenda fields match the pre-publication snapshot.

Live profiles: [Darko Bozhinovski](https://wts.sh/speakers/darko-bozhinovski) and [Miodrag Cekikj](https://wts.sh/speakers/miodrag-cekikj).

## Host presentation follow-up — released in PR #77

The public projection reads explicit host assignments from this manifest, not from global MC status or free-text biographies. Names and photos still come from published PocketBase profiles. Opening/closing receive avatar-and-name participants; the legacy text credit is suppressed in the projection. Firesides expose an additive `hosts` subset while preserving existing API `speakers` compatibility. Agenda and Session detail render hosts once, below guests with a divider and Host heading; the Session page suppresses the duplicate legacy abstract credit.

No additional production data writes are needed. Ship `hosts-2026.manifest.json` with the frontend source; the runtime role projection imports it. The data importer/verifier remains unchanged.

Released on `2026-09-17` through [PR #77](https://github.com/WhatTheStackConf/wts/pull/77), merge `6745ad53db7038e1baf9902d703fa6a13284fe54`, Coolify deployment `ctdz8ylnsaaovf72p1bcuul4`. Exact-SHA deployment finished successfully; web/PocketBase containers are healthy. Both PR and post-merge CI passed. Live browser verification confirmed opening/closing photos at mobile/desktop widths and separated, decoded host profiles on all six firesides. The original dirty checkout remains intentionally unsynchronized; release scope was isolated from unrelated work.

Verification: production build and typecheck passed; 1,452 tests passed and one skipped with nested worktrees excluded and the two new test files included. Vite still reports its pre-existing shutdown timeout warning. Mounted component checks using a read-only live public-field snapshot and production CSS passed at 390px and 1440px, covering opening/closing photos, all six agenda host sections, all six Session participant sections, image decoding, stage selection, zero horizontal overflow and zero page errors. These are local component checks, not full-route or deployed acceptance.

## Public-page retirement — 2026-09-30

The current site no longer serves the 2026 agenda, speaker profiles, or session pages. We removed their components and `verify-hosts-ui.mjs`. The release receipt above describes historical verification, not the current route contract. The data importer, host projection, and API checks remain available.

```sh
pnpm exec vp test run --exclude='.hermes/**' src/lib/programme-hosts.test.ts src/lib/conference-public.test.ts
```
