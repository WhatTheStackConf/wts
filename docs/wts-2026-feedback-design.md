# WTS 2026 post-conference feedback

## Status and authority

Accepted design baseline and authorization to implement locally; not authorization to commit, deploy, or send email. The organizer requested feedback for each main-day checked-in person in Hi.Events, anonymous answers, and no dependency on WTS authentication. The organizer explicitly selected practical privacy: answers stored without identity links, while acknowledging that system operators could technically correlate submissions. The organizer subsequently accepted the questionnaire and operating-policy proposal and requested an unlisted site page accessible through individual emailed links.

## Accepted direction

- One shared survey, with a single-use emailed invitation per eligible attendee, independent of a WTS account.
- Eligibility comes from the specific main-day Hi.Events admission list, not generic event-wide check-in status or attendance at another conference-week activity.
- Invitation delivery and redemption records remain separate from answers. Neither side stores a reference joining a particular response to an invitation, attendee, email, or WTS account.
- This is practical privacy, not cryptographic unlinkability against infrastructure operators. Describe that distinction honestly in attendee-facing copy.
- Feedback distribution does not enroll attendees in the general newsletter or authorize overriding existing contact suppressions.
- The route is unlisted, excluded from navigation and indexing, and the form itself requires a valid invitation. Hiding a URL alone is not access control.
- Launch with a ten-day response window and one reminder on day six to unused invitations; actual dates are set at approved launch, not during implementation.
- Remove invitation/contact mappings and survey delivery records within 30 days after closure; retain raw responses for 12 months, then delete. Backups follow the separately verified expiry policy.
- Raw comments remain internal. Speaker summaries are reviewed and detached from the rest of the respondent's answers; numeric session summaries require at least five responses. No automatic public verbatim quotes or raw dataset.

## Audience preparation

Read a complete, validated Hi.Events snapshot using deterministic pagination. Pin the exact source, event, main-day list, and relevant admission products before preparing invitations. The exact list and current production membership have not been verified for this design.

Require validated check-in evidence for the configured main-day list. Missing or ambiguous check-in relationships are unknown, not eligible. Do not infer attendance from a ticket purchase, a printed badge, a WTS account, or another list's check-in.

Prepare an exceptions report for missing/invalid/placeholder addresses, shared addresses, possible duplicate-person records, and conflicting ticket/order states. Do not silently exclude someone who demonstrably attended merely because a later ticket or payment state changed; settle those exceptions with the organizer. Do not substitute buyer addresses or infer contacts by name without approval.

An attendee record is an operational identity, not proof of a unique human. Distinct attendees sharing an email need separate response allowances; multiple ticket records belonging to one person need review. Keep counts of source records, proposed invitations, distinct email recipients, held exceptions, and suppressed contacts separate.

Freeze an approved audience snapshot for issuance. Reconcile source corrections and suppressions before an authorized send; never silently create a second allowance during a retry or refresh.

## Attendee experience

1. Open an invitation link.
2. Complete the survey without registering or logging in.
3. Submit once.
4. See a thank-you page.

Opening or checking a link never consumes it. This protects against email security scanners and accidental visits. Only a successfully committed submission consumes the allowance. Validation failures and rolled-back writes leave it usable. Repeated or concurrent submission cannot create multiple responses.

A used link shows a neutral already-submitted state, never the submitted answers. Expired, revoked, invalid, and closed-survey states need clear non-identifying messages. Network uncertainty is resolved through invitation status without retrieving any answer record.

Links are bearer capabilities: forwarding a link transfers the ability to use it. The enforceable guarantee is one accepted response per invitation, not proof of which human submitted it. Editing or retrieving answers through the invitation link is out of scope.

## Proposed data boundaries

### Survey

Edition, versioned question definition, open/closed state, opening and closing policy. Freeze question semantics once accepting responses; do not mix changed scales under one version.

### Private invitation and delivery records

Survey, source attendee reference, delivery email, random token digest, expiry, revoked/used state, issuance operation identity, and necessary delivery diagnostics. Uniqueness prevents duplicate issuance for the same survey/source attendee. Raw secrets needed for delivery must have an explicitly bounded encrypted delivery lifecycle; storing only a verification digest does not itself solve mail retry or reminder delivery.

No answer data or response ID belongs here. Do not retain a precise redemption timestamp solely for convenience. Delivery state is not proof of inbox delivery.

### Feedback response

Survey/version, independent random response ID, and validated answers. No attendee, email, user, invitation, token, token digest, request correlation ID, or identifying client metadata. Do not deliberately collect IP addresses, user agents, precise timestamps, or submission ordering in the response record.

The survey reference is shared across a cohort; it is not a per-person join. Free text can still identify its author. Warn respondents not to include identifying information and review comments before external sharing.

## Submission and retry contract

A server-owned transaction validates the active survey, token, expiry, and answer schema, then consumes an unused invitation and inserts one unlinked response. Both writes commit together or neither does. Database constraints and transaction behavior, not client button disabling, enforce the invariant.

A retry after a committed submission reports that the invitation has already been used without returning answers or a response identifier. Malformed answers must not consume the allowance. Concurrent submission, close/revoke races, rollback, and response-loss recovery require real-database tests.

Token material must be cryptographically random, scoped to this survey, and never derived from an attendee ID or email. Hashes protect stored bearer secrets but are not themselves anonymity mechanisms.

## Privacy and security requirements

- No WTS account is required. An existing logged-in session must not influence or be copied into feedback processing.
- No analytics, session replay, email open tracking, or tracked redirects in this flow.
- No tokens or answer bodies in application/proxy logs, audit metadata, tracing, analytics, or exception reports.
- Prefer a fragment-bearing invitation URL so the initial request does not expose the token in its path/query. Client submission still sends the secret to the service; fragments alone do not establish anonymity.
- Use restrictive referrer and cache policies; avoid third-party assets/scripts and token-bearing navigation.
- Separate organizer access to delivery operations from access to feedback results where practical. Public collection reads/writes are denied; submission uses a narrow validated endpoint, and organizer operations require authorization.
- Apply bounded validation, anti-abuse controls, and origin protection without building a persistent identity trail in response data.
- Audit existing PocketBase automatic fields, hooks, request logs, reverse proxies, browser auth behavior, and backup retention before promising privacy. Simply omitting a timestamp from a DTO does not remove persisted metadata.
- Results must not expose precise timestamps, insertion order, per-person response status alongside answers, or small-group breakdowns that readily identify someone.
- Define deletion deadlines for contact mappings, delivery secrets, delivery diagnostics, and retained infrastructure metadata, including the effect of backups.

Practical privacy does not protect against an operator deliberately instrumenting the server, correlation through infrastructure observations, or identifying content volunteered by the respondent. Do not claim otherwise.

## Proposed email operations

Use a dedicated survey audience/workflow and untracked direct links. Preserve suppression history and hold exceptions for review. The transport and personalized-link delivery contract are implementation decisions still to verify; the existing mailing setup is not yet proven to support this exact workflow safely.

Reminders may target unused invitations without access to answers. Reuse the same allowance: a reminder or delivery retry must not issue another response opportunity. Define safe recovery for uncertain sends and link reissue/revocation before implementing them. No automatic sending, test mail, audience mutation, or production data writes are authorized by this document.

## Accepted questionnaire

Keep the core short and detail optional, targeting roughly three minutes rather than promising a measured completion time:

- Required: Overall, how was WhatTheStack 2026 for you? Five points from Very poor to Excellent.
- Optional individual ratings with Not applicable: talk selection and relevance; organisation and communication; venue and finding your way around; opportunities to meet and talk with people.
- Optional: What should we absolutely keep next year?
- Optional: What's the most important thing we should change?
- Optional, select up to three: What would you like to see more of next year? Deep technical talks, practical case studies, live demos, discussion and Q&A, beginner-friendly content, workshops, time to meet people, Other with text.
- Optional collapsed session section: select an actual main-day session, rate usefulness on five points and/or leave a comment; allow several sessions without requiring the whole programme.

This release stays main-day-focused; no separate conference-week section was requested. English copy inherits the site. Do not add NPS, employer/email demographics, account linking, or gamification rewards to feedback records. Any follow-up contact request must be a separate flow with no response join.

## Existing-code observations

- The project is a SolidStart application with PocketBase persistence, server-side privileged operations, and protected organizer surfaces.
- `src/lib/hievents.ts` currently computes a generic check-in flag from event-wide check-ins. That flag is not sufficient to establish attendance on the main-day list.
- `src/lib/registrations-source.ts` demonstrates deterministic attendee pagination but intentionally does not infer list-specific arrival. Reuse validated reader patterns rather than treating this roster as feedback eligibility.
- The existing checkout contains substantial unrelated changes. Implementation must preserve them; no reset, cleanup, commit, push, or deployment is implied by this design.

These are local source observations, not verification of deployed eligibility data, delivery capability, or privacy settings.

## Implementation acceptance gates

- Complete exact-list cohort validation, with account-less attendees and shared-email cases covered.
- Stable issuance across reruns; no duplicate allowances from pagination or repeated issuance operations.
- No-login browser flow, including when an unrelated WTS account is already logged in.
- GET/prefetch does not consume tokens; expired/revoked/closed links cannot submit.
- Real-database proof of atomic consume-and-insert, concurrent submit, validation failure, rollback, and lost-response retry behavior.
- No answer retrieval by invitation, even after submission.
- Schema, API, logs, errors, exports, and infrastructure reviewed for identifiers and correlation metadata.
- Mail retries/reminders preserve the same allowance and respect suppressions; delivery uncertainty is reported honestly.
- Mobile and keyboard-accessible form behavior, clear validation, confirmation, and retry states verified in the actual browser UI.
- Organizer access controls and private versus publishable results verified.
- Exact privacy copy, retention policy, questions, audience exceptions, and send timing approved before launch.

## Open product decisions

1. Exact launch timestamp and corresponding closing/reminder dates.
2. Approval of the verified source/list and held duplicate-person, contact, suppression, or post-event-state exceptions.
3. Named organizer access and any individually reviewed speaker/public summaries.
4. Infrastructure logging audit and verified backup expiry, plus activation of retention operations for production.

Implementation is authorized. Commit/push, deployment, and mail dispatch require separate authorization.
