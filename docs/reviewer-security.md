# Reviewer Security Policy

## Submission Visibility

Reviewers may list only pending CFP Submissions they are eligible to review. Queue responses contain only the submission id and title; detail responses add the abstract, key takeaways, and technical requirements. Reviewers can read and update only their own reviews while the related submission remains pending. Admins retain full submission and review access for support and oversight.

Reviewers receive only their own criteria-weight vote. Aggregate averages and vote counts are admin-only. Admins cannot cast or modify reviewer votes.

## PocketBase Rules

Public user registration may omit `role` or set it only to `user`. Self-service user updates must preserve the current role; admin role assignment continues through authenticated admin server actions. Name updates use an allowlisted server action. Avatar updates remain direct PocketBase self-updates under the role-preserving collection rule. A dedicated OAuth hook assigns `user` to newly created OAuth accounts.

The hardening migration removes duplicate reviews deterministically before adding the unique submission/reviewer index: it keeps the most recently updated record, using record id as the tie-breaker. Review and vote ownership is enforced both by PocketBase rules and server actions.

## Session Deployment

The `pb_auth` cookie is server-managed with `HttpOnly`, `SameSite=Lax`, and `Path=/`; production also sets `Secure`, so production deployments require HTTPS. Password login uses a server action so authenticated session tokens never enter browser-accessible storage. Registration and password-reset credentials continue to go directly to PocketBase without creating a durable browser session. OAuth and legacy browser tokens are validated once, rotated into the HttpOnly cookie, and then removed from browser-accessible storage.
