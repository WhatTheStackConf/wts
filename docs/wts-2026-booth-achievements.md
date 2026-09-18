# WTS 2026 booth achievements

## Catalogue

The organizer-only **2026 booth achievements** tab in `/admin/gamification` prepares twelve draft Achievements, Missions, QR Activities, scoring policies and private questionnaires. Each question has exactly three choices and one correct answer. The programme references are checked against `scripts/main-day-agenda.manifest.json`.

| Booth | Printed label (literal) | Lookup prefix | Achievement |
|---|---|---|---|
| Уни банка | 0x48 | D0XXB6TD | Neon Cred |
| Машински факултет | 0x28 | BD219GBF | More Human Than Hardware |
| Symphony | 0x02 | 9490XQCF | Electric Dreams |
| Sorsix | 0x22 | 2V4G5VWX | Signal in the Rain |
| Avenga | 0x30 | CWX271AC | Legacy Runner |
| Loka | 0x20 | J3ZX2CAE | Context Is Reality |
| Codechem | 0x26 | PD4CZJJC | Synthetic Alchemist |
| RLDatix | 0x24 | 0JSB41Q0 | The Empathy Protocol |
| JETBRAINS | 0x32 | MGVGM22F | Nexus Coder |
| ФИНКИ (везилка) | 0x01 | GNW9EHBJ | Threads of Tomorrow |
| Робот тим | 0x18 | CS1FN64K | Replicant Handshake |
| Ракета тим | 0x34 | YZS50F7J | Off-World Bound |

**Preserve printed labels literally.** Despite the `0x` decoration, these correspond to the original batch's decimal filenames: `0x48` is original entry 48, not entry 72. Resolve by the exact lookup prefix, not numerical conversion. No full bearer values belong in Git or this document.

The source for prompts, choices and private accepted answers is `src/lib/wts-2026-booth-achievements.ts`. Do not import it into attendee/client modules. Only the authenticated admin server action returns the full catalogue. Attendee challenges use `publicQuestions`, which omits answer keys.

## Scoring and defaults

- Policy: `correct_or_half`.
- Proposed default full award: **20 total XP and 20 leaderboard XP**; wrong answer: **10 and 10**. The organizer may choose a different even full amount before creating drafts. This absolute default is an implementation choice; the requested rule is the full/half ratio.
- Either valid answer unlocks that booth's Badge. Missing answers or choices not offered earn nothing.
- First completion is final. Rescans, replacement codes and answer retries cannot award again or upgrade a half award.
- Existing event caps still apply after scaling. Review the complete schedule rather than activating a small one-booth test schedule.
- Window: **2026-09-19 00:00 through 2026-09-20 00:00 Europe/Skopje**.
- Shared Activity limit: 10,000 participants, once each. Registration should use a matching shared-code capacity, not a globally single-use code.
- These are generic `qr` Activities in category `booth`, not the legacy fixed-band multi-outcome booth workflow. No partner contact-sharing is enabled.

## Organizer launch

1. Deploy the application and PocketBase question hook together with additive migration `1786000014_question_half_credit.js` under the normal approved release procedure.
2. Create/review the full-event draft in **Score schedules**, effective no later than the booth window's start.
3. Open **2026 booth achievements**, review all questions and names, select that draft schedule and the full XP amount, then **Prepare 12 achievement drafts**.
4. This is resumable, not an all-or-nothing transaction. A failed request can leave some drafts. Retry the same request; matching records are reused, conflicts are rejected, and published definitions are never edited. No codes, participant awards or live scoring are created by setup.
5. In **Catalog**, activate each Achievement, then its Mission, then its Activity. Review and activate the score schedule only after all intended policies are included.
6. Use **Printed codes** to register each *original* raw code against its matching Activity. Check the lookup prefix above. Do not generate replacements. The source manifest is the authority for exact values, not screenshot OCR.
7. Read back registration receipts and code→Activity mappings. Rehearse a physical QR on the authorized deployed build and confirm score, Badge and duplicate behavior.

## Verify the original printed batch

```sh
node --experimental-strip-types scripts/verify-booth-code-manifest.mjs /path/to/original/manifest.json
```

The verifier checks the manifest count, unique exact prefixes, parser validity, original URL, SVG SHA-256 and independent QR decoding for all twelve. It performs **zero production writes**. An optional second argument writes a new organizer-only JSON export (mode 0600, refuses overwrite) containing the original codes and questionnaire mapping. Keep that output outside the repository and public assets.

Digital decoding is not proof that paper was printed correctly or that live registration exists.

## Verification

- `pnpm test:booth-achievements`: complete draft preparation, lost-response replay, conflicts, activation, synthetic registered equivalents for all twelve prefixes, each question's full/half XP and Badge, duplicate prevention.
- `pnpm test:gamification`: adjacent accounting, question, import, catalogue and transport contracts.
- `pnpm test:gamification-browser`: built application organizer setup and attendee full/half workflows on disposable PocketBase, including mobile screenshots without bearer values.
- `pnpm typecheck`

If nested local worktrees exist under `.hermes/`, the existing broad Vitest filters can collect their duplicate tests. Use `--exclude '**/.hermes/**'` for direct Vitest/full-suite runs; do not treat failures from a second worktree's Vitest instance as failures of this checkout.

Nothing in this catalogue, its tests or the verifier changes production. Activation and exact printed-code registration are separate operational steps.

### Local verification, 2026-09-19

- Original batch verification: all 12 prefixes matched once; all 12 original SVG checksums and independent QR decodes matched their exact URLs. Zero production writes.
- `pnpm test:gamification`: 248 tests passed, plus the bundled browser RPC transport regression.
- `pnpm test:gamification-browser`: production build succeeded; all 9 browser tests passed, including catalogue setup and the 20/10 three-choice workflow on mobile.
- `pnpm typecheck` and `git diff --check`: passed.
- Review regressions cover activation held behind draft setup, no rewrite of unrelated metadata/policies, audit repair after each lost create response, retained half credit after challenge expiry, and delayed Badge repair after its window.
- The broader suite is not fully green: `src/lib/checkin-agent-protocol.integration.test.ts` fails with `AgentError: authorization_expired` outside this change. Vitest also reports an existing shutdown-timeout warning after successful targeted runs.
- Changes remain uncommitted and undeployed. Real QR registration and physical production redemption remain unverified.

### Release candidate validation, 2026-09-19

The isolated candidate is based on `aca0266` (current production source), preserving its lifecycle warning, booth-consent test, registration fixes and Satori runtime packaging. The earlier dirty-checkout check-in failure does not reproduce here: the complete suite passes **1,500 tests**, with one skipped. Gamification passes **248 tests** on both PocketBase 0.30.4 and the deployed 0.34.0 binary; all **9** gamification browser scenarios, typecheck, production build and check pass (check reports warnings only). Supplemental MC, usability and authentication gates also pass.

The operator explicitly accepted the required backend restart and deferred check-in recovery until event setup in the morning. Do not clear that recovery lock or alter printer history as part of this achievement release.
