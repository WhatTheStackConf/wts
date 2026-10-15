# Final MC: Marijana Ilovska Zlatanovska

Published on `2026-09-17` from organizer-supplied name, biography and portrait. Bio wording is preserved verbatim as four HTML paragraphs. Affiliation is derived from the explicitly supplied role: Head of Partnerships — Women in Tech Macedonia. LinkedIn is cleaned to `https://www.linkedin.com/in/ilovska/` with tracking parameters removed.

Public profile: https://wts.sh/speakers/marijana-ilovska-zlatanovska

The profile is published, `is_mc=true`, invited, and belongs only to the main-day Appearance Event. No user/CFP linkage, Session or stage assignment was inferred. The original 400×400 JPEG is retained byte-for-byte; its SHA-256 is pinned in `marijana-2026.manifest.json`.

## Verification

- Four isolated integration tests passed against PocketBase 0.34.0 and the real programme hooks: original-photo readback, exact publication/no-op, lost committed upload/publication responses, backup and identity-collision refusal, unrelated-field preservation.
- Fresh native backup verified by ZIP and SQLite integrity checks, with a supplemental checksum-verified archive of all 108 pre-existing referenced originals. Recovery/audit material is private and outside this repository.
- Production staging and publication each wrote exactly one record; readback matched every supplied field and the original photo hash. Replay performed zero writes.
- Full agenda/source delta comparison found no changes beyond the new MC profile. `main-day-transfer-gaps.py --verify` still passed with zero writes.
- Public API matches the supplied biography/name, MC flag, cleaned LinkedIn URL and zero sessions. Hydrated profile at 390px/1440px shows decoded photo, full name, MC designation and LinkedIn link without horizontal overflow. Speaker listing displays her as MC.

```sh
python3 -B scripts/marijana-2026.py verify
WTS_FIXTURE_PB_BINARY=/path/to/pocketbase-0.34.0 python3 -B scripts/marijana-2026.test.py
```

Re-execution supports `stage` / `publish` with the established `--execute --exclusive-writer --native-backup-verified --backup-dir PRIVATE_DIRECTORY` gates. Source credentials use the existing importer loader and are never printed. No frontend deployment is needed.
