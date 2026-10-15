# Invitation-only feedback implementation plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task. No commits, pushes, production writes, or email sends are authorized.

**Goal:** Build and locally verify the accepted WTS main-day feedback survey, accessible only with a private email invitation.

**Architecture:** An unlisted `/feedback#token=...` page exchanges a random bearer token through cookie-free POST `/api/feedback`. PocketBase owns the atomic invitation-consumption/answer-write transaction. Private organizer CLI operations prepare and issue invitations and export results; production activation and email dispatch remain separate approved operations.

**Tech Stack:** Existing Solid 2/Vite application, TypeScript, PocketBase 0.30.4 JS hooks, Vitest, Playwright.

## Accepted product details

The organizer accepted the proposed questionnaire, ten-day response window, one reminder on day six, invitation/delivery cleanup within 30 days after closure, raw-answer cleanup after 12 months, internal raw comments and reviewed speaker summaries (numeric session summaries require at least five responses). Main-day only for this release. No auth, newsletter enrollment, tracking, account rewards, answer retrieval, or response editing. Do not present operational dates as active until launch.

## Test seams

Use the previously approved design acceptance gates: public feedback HTTP endpoint, real PocketBase transaction and access boundaries, invitation issuance/retention operations, and actual no-login browser experience. Verify stored response fields to prove the privacy boundary. Synthetic local data only; no deployed source inspection or email delivery is included.

## Shared contract

`src/lib/feedback-contract.ts` defines the DTO. POST inspect returns ready plus survey metadata only for a usable token. Submit returns submitted; repeated attempts return used without answers. Public states include invalid, expired, closed, unavailable, invalid_answers. Token is 32 random bytes encoded base64url (43 chars). Only overall rating is required; text max 2000 chars each, other max 500, at most three unique more choices, unique session reviews bounded by published snapshot. Optional session feedback references frozen main-day session IDs.

## Task 1: Backend vertical slices

Owned files: `pocketbase/pb_migrations/*_create_feedback.js`, `pocketbase/pb_hooks/feedback*`, `src/lib/feedback-http.ts`, `src/lib/feedback-http.test.ts`, `src/lib/feedback.integration.test.ts`, `src/lib/feedback-pocketbase-test-helper.ts`, `src/routes/api/feedback.ts`, optional dedicated feedback record types.

Start with failing integration tests for inspect versus submit, then implement locked survey/invitation/response collections and a narrow public token endpoint. Omit response/invitation redemption autodates and identity fields. Validate schema, deadlines and frozen version inside one PB transaction. Rollback and concurrent calls must not lose or duplicate answers. Add invalid/revoked/expired/closed tests, public collection denial, stored-field privacy inspection, cookie/header isolation and bounded HTTP/origin handling. Never forward auth cookies. No logs with bodies/tokens.

## Task 2: Form vertical slices

Owned files: `src/routes/feedback.tsx`, `src/components/feedback/*`, `src/lib/feedback-client.ts`, targeted client/UI tests. No shared App/config edits.

Preserve established WTS visual language. Single-column mobile-first form: title/privacy, required overall native radio group, optional four part ratings with N/A, keep/change text, max-three more checkboxes and conditional Other text, collapsed optional session section. Token only from exact fragment; no local/session storage, no auth hooks, credentials omitted for fetch, clear fragment with replaceState while holding in component memory. Render only neutral invitation-required shell without valid token. Handle retry without losing input, duplicate/expired/closed states, pending/confirmation focus and visible errors. No navigation or sitemap inclusion. Use semantic groups, visible labels and adequate targets. Add noindex/referrer metadata. First load needs JavaScript; show a clear noscript note without leaking token into a server query.

## Task 3: Organizer operations

Owned files: `scripts/feedback-ops*`, operational tests and documentation. After backend schema is known, provide explicit dry-run-first commands for configuring survey with frozen published main-day sessions, validating exact-list Hi.Events attendee export, issuing tokens idempotently with private durable receipts, revoking, aggregate/private result exports, reminders using same allowance, and retention cleanup. Do not send mail. Protect shared-email cases and hold duplicate-person/contact/status exceptions. Production action requires explicit apply and correct configured targets; no default .env production reads. Verify all writes. Keep operational records separate from answer exports.

## Task 4: Integration and actual browser verification

Parent owns App/auth-layout privacy isolation, middleware/header configuration, package scripts, docs baseline update, `scripts/run-feedback-browser.mjs`, `playwright.feedback.config.ts`, `tests/feedback.spec.ts`. Preserve pre-existing dirty work. Add dedicated disposable runner with sanitized env, real migrations/hooks, no outbound mail, fresh built app, deterministic invitation fixture. Exercise missing/invalid tokens, complete and minimal submission, account independence, error retry, duplicate use, session feedback, fragment removal, cookie-free API, no auth restoration, no overflow and keyboard/mobile confirmation. Capture desktop/mobile screenshots for inspection.

## Task 5: Review and final checks

Run focused tests and typecheck throughout; run configured full suite once, report unrelated failures faithfully. Perform spec review first, then security/code-quality review; fix material issues and rerun relevant tests. Run mechanical UI detector and visually inspect actual screenshots. Document exact completed versus launch-required evidence. Leave changes uncommitted. Do not deploy or distribute invitations.
