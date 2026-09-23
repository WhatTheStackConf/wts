# Feedback organizer operations

## Scope and launch gates

`scripts/feedback-ops.mjs` is an organizer-only, dry-run-first CLI. It does **not** fetch Hi.Events exports, send email, open a survey, install cron, publish results, or load any `.env` file. Run it with Node >=22.13.0. All examples below describe operations to review; they are not launch/send authorization.

```sh
node scripts/feedback-ops.mjs --help
node --test scripts/feedback-ops.test.mjs
```

The offline test file uses clearly synthetic fixtures and disposable loopback HTTP protocol doubles. A second integration test runs the actual operations adapter against disposable PocketBase 0.30.4 with the real feedback migration/hooks: `node --experimental-strip-types --test scripts/feedback-ops.integration.test.mjs`. It verifies issuance/resume, public submission, same-token reminder preparation, private export, and survey-scoped invitation/answer retention. Neither test establishes actual email delivery or actual Hi.Events export completeness. `pnpm test:feedback` runs both along with the backend/client tests.

Before production:

- Verify the exact main-day source, event, admission list, product membership, pagination totals, suppression source, and session snapshot. No actual source list has been verified by this CLI implementation.
- Approve questionnaire/version, explicit launch time, exact cohort exceptions, privacy wording, organizers allowed raw-text access, and retention/backup policy.
- Confirm backend migration `1790100000_create_feedback.js`, unique `(survey, source_key)` and token hash indexes, locked collection rules, unlinked responses, and transactional submission tests. The adapter maps the three exact collection names in `PB_SCHEMA`; it also normalizes PocketBase date wire strings.
- Verify deployment/logging/proxy/backup privacy separately. Practical anonymity is not cryptographic unlinkability; free text can identify respondents.
- Pin the independently verified exact HTTPS PocketBase origin in `APPROVED_PRODUCTION_ORIGINS`. This list is deliberately **empty**: all non-loopback operations currently fail closed. Never infer a production origin from environment files. Once pinned, remote writes additionally require both `--apply` and `--production-apply`.
- Confirm a future untracked delivery integration separately. This implementation has **no send capability** and exports always say `sent: false`. A prepared export is not evidence of sending or delivery.

## Private workspace and credentials

Use a dedicated directory outside the checkout, owned by the current user, mode `0700`; all JSON inputs/outputs must be owned regular files mode `0600`. Output directories are created privately if absent; existing permissive directories are rejected. Symlink input files and symlink output directories are rejected. Do not put secrets in argv, console output, tickets, chat, git, or shell tracing.

Supply these using an approved secret-management/session mechanism, not literal values in command history:

- `FEEDBACK_PB_TOKEN`: the dedicated privileged PocketBase credential. No fallback to application credentials.
- `FEEDBACK_MANIFEST_KEY`: a **separate**, cryptographically generated 32-byte key encoded as canonical standard base64. Keep it in a password manager/secret store, separately from the manifest; retain access through reminder and cleanup. Losing it means losing recoverable delivery tokens. Never rotate it by changing the environment and starting a new issuance.

Manifests are AES-256-GCM encrypted with a fresh 96-bit nonce and authenticated versioned context on every write. They contain the only durable token source and are fsynced before remote writes; remote invitation records receive SHA-256 hashes only. Files remain `0600` inside `0700` directories. Do not copy decrypted manifests to files or logs.

Plaintext audience files and deliberate delivery/results exports remain sensitive. Mode bits are not encryption. Use encrypted storage and bounded backups. Deleting a file does not guarantee secure erasure from SSD snapshots/backups.

## 1. Prepare a complete exact-list export

The CLI consumes a normalized **organizer-verified export envelope**, not an event-wide roster. It never treats `checkedIn: true`, a ticket purchase, name-label printing, or a WTS account as attendance. Exporter operators must verify deterministic pagination and stable totals upstream before setting `complete: true`; the CLI verifies the supplied page evidence/counts/uniqueness, not the truth of an arbitrary assertion.

Example envelope (all identities/addresses below are synthetic; no sends):

```json
{
  "version": 1,
  "source": "synthetic-hi-events",
  "eventId": "synthetic-event",
  "listId": "synthetic-main",
  "mainDay": "2026-09-19",
  "admissionProductIds": ["synthetic-entry"],
  "provenance": {
    "endpoint": "/events/synthetic-event/check-in-lists/synthetic-main/attendees",
    "exportedAt": "2026-09-20T12:00:00Z",
    "sort": "id:asc",
    "complete": true,
    "total": 1,
    "pages": [{ "page": 1, "total": 1, "ids": ["1"] }]
  },
  "suppressions": {
    "source": "synthetic-suppression-review",
    "reviewedAt": "2026-09-20T12:00:00Z",
    "emails": [],
    "attendeeIds": []
  },
  "records": [{
    "id": "1",
    "name": "Synthetic Person",
    "email": "person-1@synthetic-fixture.net",
    "eventId": "synthetic-event",
    "productId": "synthetic-entry",
    "ticketStatus": "ACTIVE",
    "orderStatus": "COMPLETED",
    "checkIn": {
      "id": "synthetic-checkin-1",
      "eventId": "synthetic-event",
      "listId": "synthetic-main",
      "attendeeId": "1",
      "checkedInAt": "2026-09-19T10:00:00Z"
    }
  }]
}
```

The endpoint is the canonical exact-list provenance identifier required by this input contract, **not** a promise about the deployed Hi.Events URL shape. The upstream exporter must bind its actual verified request/list to this canonical scope. IDs must be preserved as strings, not guessed or name-derived. Each page records its original total and ordered attendee IDs; the concatenation must exactly match the records, with no duplicated attendees. An empty complete export uses one page with zero total and an empty IDs array.

`checkIn: null` means the exact list explicitly reports no check-in. Absent/mismatched relationships are `unknownAttendance`, never eligible. A valid relationship must identify the exact event, list and attendee, an admission product, a check-in ID and an explicit timestamp. Use original attendee email only; no buyer substitution, WTS account lookup, or name-based inference.

```sh
node scripts/feedback-ops.mjs prepare --input "$PRIVATE/snapshot.json" --out "$PRIVATE/plan.json"
# Only after reviewing the counts:
node scripts/feedback-ops.mjs prepare --input "$PRIVATE/snapshot.json" --out "$PRIVATE/plan.json" --apply
```

The private plan counts every source row in exactly one of: `eligible`, `held`, `suppressed`, `invalidEmail`, `notCheckedIn`, `unknownAttendance`. `distinctEligibleEmails` and `sharedEmailRecords` are additional metrics, not categories to sum. Same-email attendees retain separate allowances. Possible duplicate names are only suspicion flags, never automatic merges. Demonstrated attendees with non-`ACTIVE` tickets or non-`COMPLETED` orders are **held for review**, not silently excluded. Name normalization only produces suspicion flags.

Email validation is deliberately conservative (ASCII dot-atom/domain syntax, reserved placeholder domains, common placeholder locals). Invalid/missing addresses and suppressions cannot be overridden by review. Unusual legitimate addresses require verified source correction, not invention. Suppression matching is case-insensitive; original inputs/addresses are preserved.

## 2. Review exceptions and freeze

Create a private review file containing the exact digest printed by `prepare`:

```json
{
  "approved": true,
  "snapshotDigest": "COPY_EXACT_PREPARED_DIGEST",
  "decisions": { "SYNTHETIC_HELD_ATTENDEE_ID": "include" }
}
```

Every held record requires exactly one `include` or `exclude` decision; if none are held, use `{}`. Review cannot include a suppressed/invalid/unknown-attendance record. If a duplicate person really has multiple attendee records, explicitly exclude the extra records. Do not exclude distinct people merely because they share an address. Fix missing provenance/contact data upstream and regenerate/review **before** issuance.

```sh
node scripts/feedback-ops.mjs freeze --input "$PRIVATE/snapshot.json" --review "$PRIVATE/review.json" --out "$PRIVATE/frozen.json"
node scripts/feedback-ops.mjs freeze --input "$PRIVATE/snapshot.json" --review "$PRIVATE/review.json" --out "$PRIVATE/frozen.json" --apply
```

Freeze retains the original snapshot/suppressions, review, all category counts, approved attendee identities and distinct approved email count. It never overwrites an existing artifact. Issuance recomputes approval and binds the entire frozen document to the encrypted manifest. These digests are drift guards, not signatures establishing who approved a file.

## 3. Prepare survey setup from approved main-day sessions

A separate input must have `approved: true`, authoritative `source`, `key`, `title`, questionnaire `version`, explicit timezone-qualified `launchAt`, `mainDay`, and `sessions: [{id,title,mainDay}]`. Every session must be from that exact main day; duplicate session IDs are rejected. Do not feed all sessions in the database or infer approval from publication status.

```json
{
  "approved": true,
  "source": "synthetic-approved-main-day-programme",
  "key": "synthetic-feedback",
  "title": "Synthetic feedback",
  "version": "1",
  "launchAt": "2026-09-23T12:00:00Z",
  "mainDay": "2026-09-19",
  "sessions": [{"id":"synthetic-talk","title":"Synthetic talk","mainDay":"2026-09-19"}]
}
```

```sh
node scripts/feedback-ops.mjs setup --input "$PRIVATE/approved-sessions.json" --out "$PRIVATE/setup.json"
node scripts/feedback-ops.mjs setup --input "$PRIVATE/approved-sessions.json" --out "$PRIVATE/setup.json" --apply
```

The setup contains an explicit `survey` creation payload: `key/title/version/open/opens_at/closes_at/sessions`. It starts with `open: false`; closing is exactly ten elapsed days after launch and the reminder is six elapsed days after launch (UTC arithmetic, unaffected by DST). This command **only writes the local payload**, never creates/changes a remote survey. A separately authorized operator must apply that payload and explicitly open the survey; keep the returned 15-character PocketBase ID. Issuance/delivery/results/retention all verify the exact remote survey against this approved setup. Do not change sessions, version or dates after freezing.

## 4. Issue, reconcile, and prepare delivery

The following commands need an explicit approved `PB_ORIGIN`, dedicated credential, `SURVEY_ID` and private encryption key. Without `--apply` they read/validate and report only counts; they create neither secrets nor remote records.

```sh
node scripts/feedback-ops.mjs issue --pb-url "$PB_ORIGIN" --survey "$SURVEY_ID" --setup "$PRIVATE/setup.json" --audience "$PRIVATE/frozen.json" --manifest "$PRIVATE/manifest.json"
# Review, then repeat with --apply (and --production-apply for a pinned production origin).
```

On apply:

1. Persist the encrypted planned token for **every** approved attendee before any remote create.
2. Use stable source identity `source:event:attendee` and deterministic PocketBase record IDs. Do not derive bearer tokens from identity; tokens are 32 random bytes, base64url encoded to 43 characters.
3. Persist an `attempted` marker before POST. Verify a created/recovered record by exact survey/source/email/hash/expiry/ID readback, never just HTTP success.
4. Rerun against the **same** manifest and unchanged inputs. A committed create with a lost response is reconciled by readback without another allowance. Used/revoked state does not authorize a replacement.
5. If an attempted invitation remains absent or the remote service remains unavailable, stop for manual reconciliation; do not automatically replay an uncertain POST. A different manifest path cannot override existing invitation hashes. Backend uniqueness remains essential for concurrent runs.

Locks use exclusive private files. After a hard process kill a lock may remain; verify no process is operating and reconcile the saved manifest before manually removing only that lock. Never remove/replace a manifest to clear an error. A hash mismatch, missing verified invitation, changed frozen input, or missing encryption key is a recovery blocker, not permission to issue another link. Issuance after close is rejected.

For a deliberate plaintext export suitable for a **future separately authorized** transport:

```sh
node scripts/feedback-ops.mjs delivery --pb-url "$PB_ORIGIN" --survey "$SURVEY_ID" --manifest "$PRIVATE/manifest.json" --suppressions "$PRIVATE/current-suppressions.json" --public-origin "$PUBLIC_ORIGIN" --out "$PRIVATE/initial-delivery.json"
# Add --apply only to write the private export; it still sends nothing.
```

`current-suppressions.json` uses the `source/reviewedAt/emails/attendeeIds` shape above. Initial preparation and reminder preparation exclude used/revoked/expired/suppressed entries and require an open survey. Each exported record contains only an email and direct HTTPS `/feedback#token=...` URL; no tracked redirects. Shared emails may occur more than once. No contacts/links/tokens are printed to the console.

Delete plaintext delivery exports promptly after the separately authorized delivery/reconciliation, retaining only the encrypted source until cleanup. Prepared files are not automatically regenerated after deletion. Re-running the same prepared operation reports `alreadyPrepared`, never another send. Export status reflects **preparation**, not mail state. Recheck live usage/suppressions immediately before any future send; a file is a snapshot, not a live authorization to contact everyone indefinitely.

## 5. One day-six reminder, same tokens

```sh
node scripts/feedback-ops.mjs reminder --pb-url "$PB_ORIGIN" --survey "$SURVEY_ID" --manifest "$PRIVATE/manifest.json" --suppressions "$PRIVATE/current-suppressions.json" --public-origin "$PUBLIC_ORIGIN" --out "$PRIVATE/reminder.json"
```

Review then add `--apply` to prepare one private reminder export. The allowed window is `[launch + 6 days, launch + 7 days)`. Only unused, unrevoked, unexpired, unsuppressed invitations are eligible. The original token/allowance is reused. Previously applied delivery suppressions are additive; a refresh cannot silently unsuppress a contact. A different reminder output path is rejected once preparation is recorded. There is **no scheduler and no send routine**.

CLI clocks default to actual execution time. `--now` is accepted only for disposable loopback tests, not production.

## 6. Results: organizer-private, never automatic publication

```sh
node scripts/feedback-ops.mjs export --pb-url "$PB_ORIGIN" --survey "$SURVEY_ID" --setup "$PRIVATE/setup.json" --out "$PRIVATE/aggregate.json"
# Add --apply to persist. Add --include-raw only for approved raw-text organizers.
```

Exports query response records only, never invitation/contact records. They allowlist questionnaire fields, reject mixed versions/invalid sessions, discard database IDs and metadata, and shuffle optional raw records cryptographically to remove database traversal order. No response-to-invitation join, timestamp, source identity or insertion order is exported. Raw answers remain independent records; free text may still identify people.

Aggregates include response count, overall rating, optional-part rated/NA/skipped denominators, optional text answered/total denominators, and multi-select counts/answered/total. Each per-session numeric summary needs **at least five numeric ratings**; smaller samples are withheld, not presented as zero. Below-threshold session details can still exist in deliberately requested **organizer-private raw** answers; never publish that file. Even aggregate exports are labelled organizer-only. Publication, speaker sharing, comment redaction and small-group disclosure review are separate human decisions; the CLI cannot make a file safe merely by omitting email.

## 7. Retention, verified deletion, and remaining manual obligations

```sh
node scripts/feedback-ops.mjs retain --pb-url "$PB_ORIGIN" --survey "$SURVEY_ID" --setup "$PRIVATE/setup.json" --target invitations --manifest "$PRIVATE/manifest.json"
node scripts/feedback-ops.mjs retain --pb-url "$PB_ORIGIN" --survey "$SURVEY_ID" --setup "$PRIVATE/setup.json" --target responses
```

- Invitations: due **30 elapsed days after the approved close**. Apply deletes only exact-survey invitations, reads back each deletion, verifies the scoped collection is empty, then deletes tracked initial/reminder plaintext exports and the encrypted manifest. Tracked exports are content/scope-verified before deletion; missing exports are allowed because they should already have been removed after delivery. If remote verification fails, keep the manifest for recovery.
- Answers: due **12 calendar months after close**, clamped to February 28 for leap-day closes. Apply deletes only exact-survey response records and verifies absence; it never queries/join invitations. `--target` is mandatory, so invitation cleanup cannot accidentally become answer cleanup.
- Dry-runs report the deadline, whether it is due, and target counts; early apply is rejected. Every remote deletion checks the exact record's survey immediately before deleting.
- These commands are manual. **No cron or automatic retention job has been installed.** Assign an owner and calendar dates before launch.
- Also delete the original source export, private plan, frozen audience, review/contact copies and temporary failure files at invitation retention; these upstream copies are **not discovered or automatically deleted** by the CLI. Preserve the canonical suppression history in its original system under its own policy, not an indefinite survey copy.
- At answer retention, also delete private raw/aggregate exports and organizer working copies; these exports are **not automatically discovered**. Review encrypted storage snapshots, service/proxy diagnostics, deleted-file recovery, and backup expiry. The CLI cannot prove erasure of external copies or backups.
- Retain non-identifying completion counts/deadlines separately if needed, never token/contact/answer bodies. Retrying after the manifest has already been removed requires confirming cleanup is complete; do not generate a new manifest.

## Verification coverage and boundaries

Offline public-module/CLI tests cover exact-list/shared-email/suppression cohorts, duplicate-person/status review, count completeness and uniqueness, approved sessions/deadlines, encrypted issuance with uncertain-response resume and no duplicate allowances, one reminder/same tokens, additive suppressions, retention dates/exact target/secret cleanup, private result field allowlists/denominators/minimum-five threshold, conservative contact rejection, PocketBase date normalization, redirect rejection, and redacted dry-run CLI behavior. They use local HTTP protocol doubles so no real credential is required. Run the separate backend disposable-PocketBase tests before claiming database guarantees. No production reads/writes, sends, commits, pushes, or deployment are implied by passing these tests.
