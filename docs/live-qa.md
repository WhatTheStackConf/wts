# Live Q&A

## Attendee and MC workflow

- Open a talk from `/agenda` or `/sessions`. The **Live Q&A** section is on the talk detail page at `/sessions/{slug}#live-qa`.
- Any logged-in WTS user can submit. WTS's existing login policy requires a verified email; no ticket/check-in requirement is added.
- Questions are private to their author and all MCs/admins. Other attendees cannot read them. Author names, emails and account identifiers are not shown to MCs.
- New questions open automatically during the published canonical Agenda Slot: start is inclusive, end is exclusive, using the backend clock. Legacy Session schedule fields are ignored. The slot, Session, Day and Appearance Event must be published.
- Questions stay readable after the slot ends. Each page shows up to 50 questions, oldest first, with next/previous controls. Visible pages refresh every 5 seconds and can be refreshed manually.
- Admins grant the **MC** role under `/admin/users`. MCs get `/mc` and the **MC Q&A** navigation link, but no admin, reviewer or check-in privileges. Existing admins can moderate too. The current role system is single-role: assigning MC replaces another role.
- In `/mc`, search for a published talk and follow its question link. **Mark answered** and **Reopen question** explicitly change its answer state; questions are not deleted.
- **Open questions**, **Close questions**, and **Use agenda timing** select a persistent per-talk override. Open/closed remain in force until changed; return to agenda timing when finished. Opening cannot bypass the publication gate or create a missing published slot.

## Input and recovery

Questions contain 1–1000 Unicode code points after trimming. A 10-second, per-account cooldown on new questions limits accidental floods across talks. There is no lifetime question-count limit.

Submission retries use an author-scoped UUID. The backend transaction commits the question and its original acknowledgement together; exact retry returns the original result even after closure, answer-state changes or a PocketBase restart. Changed payloads under the same UUID are rejected. A failed read cannot discard a draft; an ambiguous submission freezes its text and offers **Retry exact question**. Keep that page open until confirmed: draft/retry state is in memory, not saved across navigation or reload.

## Security and deployment

`1790000018_create_live_qa.js` adds the `mc` role plus locked `live_qa_questions` and `live_qa_controls` collections. Manual record types are in `src/lib/pocketbase-types.ts`; client DTOs are in `src/lib/live-qa-contract.ts`. There are no public raw collection rules or public question feeds.

The browser calls same-origin `POST /api/live-qa` with its HttpOnly session cookie and the mounted panel's expected user ID. The adapter rejects cross-origin requests, limits request size, refreshes the real user session, rejects account mismatches caused by cross-tab login, and forwards user authority—not superuser authority—to `POST /api/wts/live-qa`. The expected user ID can only reject a request, never grant authority. The PocketBase hook reloads the user and applies timing, ownership, moderation, validation and deduplication transactionally. Private responses use `Cache-Control: private, no-store`.

Deploy the migration, `pocketbase/pb_hooks/live-qa.js`, `pocketbase/pb_hooks/live-qa.pb.js`, and the application together using the existing release workflow. Back up PocketBase first. No production migration or role assignment is performed by the test commands. Rollback removes the Q&A collections/data and refuses while MC users still exist: reassign roles and export questions before considering rollback.

No automatic retention/deletion policy is added. Questions persist with the conference database. Treat their text as private attendee content in backups and exports.

## Verification

- `pnpm test:live-qa` — disposable PocketBase 0.30.4 plus real relevant migrations, role guards, and publication validation hooks; tests API privacy, canonical timing, manual overrides, answers, role revocation, pagination, input validation, direct collection denial, and UUID replay.
- `pnpm test:live-qa-browser` — builds an isolated copy of the current app, runs a disposable PocketBase, and exercises real login, mobile attendee submission, MC reading after session end, overrides, catalogue search, lost-response replay, and authority/read-failure recovery. No `.env`, live data, or live credentials are read/copied; external browser requests are blocked. Screenshots/traces land under `test-results/live-qa`.
- New API tests are included in `pnpm test`. Browser verification is included in the verification workflow alongside the existing disposable browser gates.
- Run `pnpm typecheck`, `pnpm check`, and `pnpm test` before release. Browser verification includes the production `pnpm build` and emitted-server runtime, not just a development server.
