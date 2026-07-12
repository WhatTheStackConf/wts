# Decide Secure Mission Redemption Model

Status: closed
Assignee: OpenCode
Labels: wayfinder:research
Type: AFK
Created: 2026-07-09
Closed: 2026-07-09
Part of: `.scratch/wts-2026-gamification/wayfinder/MAP.md`

## Question

What threat model and server flow should govern mission code redemption?

Decide code format, hashing/storage, route shape, auth redirect/resume behavior, rate limiting expectations, expired/disabled/max-redemption/per-User-limit states, replay/idempotency behavior, public error copy boundaries, and how redemption writes claims, achievements, XP events, and profile totals without trusting client-supplied User IDs.

## Blocked by

- `.scratch/wts-2026-gamification/wayfinder/tickets/03-decide-core-accounting-and-data-model.md`

## Resolution

Use a bearer-code redemption model: a raw Mission code is automated evidence that an authenticated **User** encountered WTS-controlled evidence, not proof of physical presence. The September threat model should handle curious attendees sharing codes, accidental duplicate scans, brute-force guessing, leaked posters or links, early/late scans, disabled or reissued codes, and client-side spoofing attempts. It should not try to solve location attestation, real-time anti-fraud operations, partner/staff verifier accounts, attendee-to-attendee scans, or server-side puzzle answer validation for WTS 2026.

### Route shape and auth resume

- Canonical user-facing route: `/missions/redeem`.
- Generated QR/link URLs should use a URL fragment so the raw bearer code is not sent in the initial HTTP request, server access logs, Referer headers, or the login redirect URL: `/missions/redeem#code=<rawCode>`.
- Manual code entry lives on the same route. A **User** who types a code submits it to the same server function as a QR/link scan.
- The browser may pass only the raw code and an untrusted `sourceHint` such as `qr`, `link`, `manual`, or `static_puzzle`. The client never submits a **User** ID, Achievement ID, Activity ID, or XP amount for redemption.
- If the route is opened while unauthenticated, it should store the pending raw code in tab-scoped storage with a short timestamped TTL, set the existing same-origin login resume target to `/missions/redeem`, and send the visitor to `/login`.
- After login, `/missions/redeem` reads the pending code and calls the server redemption function. If no pending code exists, it shows manual entry and a clear fallback prompt.
- Do not put raw codes into `redirect_url`, OAuth state, query strings, or path segments by default. If an event-day emergency fallback ever accepts a path or query code, it should immediately normalize into the same pending-code flow and replace the URL before redemption.

### Raw code format

- Raw codes are opaque, high-entropy bearer secrets. They must not encode a **User** ID, Achievement key, Mission key, Activity key, partner ID, XP amount, or admin identity.
- Use a versioned, human-typeable format such as `WTS26-<lookupPrefix>-<secret>`, normalized case-insensitively with spaces and hyphens ignored where safe.
- `lookupPrefix` is a random non-secret prefix used only to find a small candidate set. It should not carry business meaning.
- `secret` should be generated with a cryptographically secure random source and contain at least 128 bits of entropy. Use an alphabet suitable for mobile typing, such as Crockford-style uppercase base32 without ambiguous characters.
- Static easter eggs, QR codes, link Missions, one-code attendance, two-code start/finish flows, and partner/community codes all use the same raw format. Their meaning comes from the matched `gamification_codes` record, not from the raw string.

### Hashing and lookup

- `gamification_codes` stores `lookupPrefix`, `codeHash`, `hashVersion`, code status fields, limits, active windows, and the related Activity. It never stores the raw code after generation.
- Hash the normalized raw code with a server-only pepper using HMAC-SHA-256 or a stronger equivalent. Plain SHA of a code is not enough if shorter operational codes are ever introduced.
- Lookup flow: normalize raw code, extract the version and `lookupPrefix`, fetch candidate code records by prefix and hash version, compute the HMAC on the server, and compare candidate hashes with a timing-safe comparison.
- Invalid raw codes should not be persisted with their raw value. If invalid-attempt telemetry is needed for abuse handling, store only safe metadata such as attempted prefix, normalized length, hash version, authenticated **User** ID, request fingerprint, and result state.
- Code and Activity limit checks count accepted redemptions and accepted **Activity Claims** only. Cached counters can speed admin views, but the server redemption path must not trust a stale counter as the only source of truth.

### Generation and display boundaries

- Code generation is admin-only through server functions using server-side PocketBase admin access.
- The admin generation response may display or download raw codes and QR/link URLs exactly once. After that response, admins can see labels, prefixes, status, related Mission/Activity, limits, counts, and audit history, but not recover the raw code.
- If a generated batch is lost, the supported operation is reissue, not raw-code recovery.
- Public Mission, Achievement, profile, and ops-board DTOs must never include `codeHash`, raw codes, generation metadata, invalidation reasons, lookup-only internals, or non-whitelisted audit metadata.
- QR images can be rendered from the one-time generation response or downloaded export. They should not be regenerated from stored hashes.

### Redemption flow

The server function should be shaped as `redeemMissionCode(rawCode, sourceHint?)` or an equivalent serializable contract.

1. Call `requireAuth()` first and derive the **User** from the authenticated session.
2. Apply rate limits keyed by authenticated **User**, request fingerprint, and, when parseable, lookup prefix. Do not validate unauthenticated codes server-side.
3. Normalize and parse the raw code. Bad format returns the invalid-code state without storing the raw value.
4. Hash and lookup the code definition. No match returns the invalid-code state.
5. If this same **User** already has an accepted `CodeRedemption` for this Code, return the idempotent already-redeemed result before applying current disabled, expired, or max-redemption checks.
6. For a new redemption, validate Code and Activity status, active windows, invalidation state, global limits, and per-**User** limits.
7. Create the accepted `CodeRedemption` using `code-redemption:v1:{userId}:{codeId}` as the accepted idempotency key. If another request wins the race, fetch the existing accepted record and return the already-redeemed result.
8. Create or reuse the accepted **Activity Claim** for the matched Activity. `sourceType` is `code_redemption` for ordinary QR/link/manual codes and `static_puzzle_code` for static easter egg codes, while still linking back to the CodeRedemption.
9. Evaluate Achievement unlock rules affected by the new claim. Two-code flows should use separate start/finish Activity definitions or roles, and completion Achievements unlock only when the configured claim set is present.
10. Create or reuse `UserAchievement` records for newly satisfied Achievements. Existing revoked User Achievements should not be silently un-revoked by automated redemption; re-award is an admin correction.
11. Create `XPEvent` records only for newly earned XP, using stable idempotency keys and the Achievement or Activity policy for total XP and **Leaderboard XP**. A duplicate scan must not create duplicate XP.
12. Upsert or rebuild the **Gamification Profile** cache for the **User** from non-voided XP Events and non-revoked User Achievements.

Recognized but rejected attempts should write non-awarding `CodeRedemption` audit rows with `status = rejected_*` and attempt-scoped idempotency keys. They must not use the accepted `code-redemption:v1:{userId}:{codeId}` key, must not count toward limits, and must not block a later valid redemption if an admin changes the code window or limit. Completely invalid raw codes do not create CodeRedemption records because no Code exists.

### Rate limiting expectations

- Redemption must be rate-limited in the server function before code lookup becomes a brute-force oracle.
- Minimum keys: authenticated **User** ID, IP-derived request fingerprint, user-agent-derived request fingerprint, and lookup prefix when parseable.
- Invalid and bad-format attempts should have stricter limits than accepted or already-redeemed attempts.
- Rate limiting returns a public retry-later state without revealing whether a specific code exists.
- Admin/support manual awards remain the event-day fallback for legitimate attendees affected by a false positive rate limit.

### Result states and public copy

| State | Persistence | Public boundary |
| --- | --- | --- |
| `accepted` | Write accepted CodeRedemption, ActivityClaim, any new UserAchievement, XPEvent, and profile update. | Show the Mission outcome, newly unlocked Badges, XP delta, and updated progress. |
| `already_redeemed` | Reuse existing accepted records; optionally repair missing dependent records if a prior request partially completed. | Treat as success-like: tell the User the Mission was already recorded and show the original outcome where safe. |
| `rejected_invalid` | No CodeRedemption because no Code matched. Store only safe invalid-attempt telemetry if needed. | Say the mission code could not be verified. Do not reveal prefixes, labels, or whether a nearby code exists. |
| `rejected_not_yet_active` | Write a non-awarding audit attempt for a recognized Code. | Say the Mission opens later. Show no internal schedule details beyond safe user-facing copy. |
| `rejected_expired` | Write a non-awarding audit attempt for a recognized Code. | Say the Mission window has closed and offer support fallback copy. |
| `rejected_disabled` | Write a non-awarding audit attempt for a recognized Code. | Say the Mission code is no longer active and suggest event support. Do not expose leak, abuse, or admin reason text. |
| `rejected_global_limit` | Write a non-awarding audit attempt for a recognized Code or Activity cap. | Say the Mission has reached its redemption limit. Do not expose counts or other Users. |
| `rejected_user_limit` | Write a non-awarding audit attempt. Used when the User has already completed the Activity through another Code or has hit the configured per-User limit. | Say the Mission is already complete or the personal limit has been reached. Do not imply an error or award more XP. |
| `rejected_rate_limited` | No accounting writes. Rate-limit store/log only. | Say to wait and try again or ask event support. Do not reveal code validity. |

Public redemption DTOs should include a stable status enum, safe user-facing copy, a support reference when available, safe Mission/Badge snippets for accepted or already-redeemed states, and profile progress deltas. They should not include raw PocketBase records, raw codes, code hashes, lookup prefixes, invalidation reasons, admin notes, private partner metadata, request fingerprints, or other Users' data.

### Request and audit metadata

Accepted and recognized rejected CodeRedemption records should store enough support metadata to debug event-day issues without turning the collection into surveillance data:

- Authenticated **User** ID derived on the server.
- Code ID, Activity ID, status, redeemed timestamp, accepted or attempt-scoped idempotency key, and linked ActivityClaim ID when applicable.
- Source hint from the client marked as untrusted.
- Request fingerprint derived from IP and user agent with a server-side salt or truncation strategy, not raw long-lived tracking data.
- User-agent family or device class if useful for support, request ID, and server timestamp.
- Hash version and matched lookup prefix for admin debugging, but never the raw code.
- Created record IDs for ActivityClaim, UserAchievement, XPEvent, and profile update when applicable.

ActivityClaim metadata should describe the evidence source with code ID, evidence role, Mission or Activity key, and event/partner/session references needed for support. It should not include the raw code. XPEvent metadata should explain the reason shown to the **User** and the source claim/unlock, not the raw redemption secret.

### Server-only write boundaries and DTOs

- All writes to CodeDefinition, CodeRedemption, ActivityClaim, UserAchievement, XPEvent, GamificationProfile totals, and admin audit records go through SolidStart server functions and server-side PocketBase admin access.
- The redemption server function derives the **User** only from `requireAuth()`. Any submitted `userId`, `achievementId`, `activityId`, `xp`, or `leaderboardXp` value from the browser is ignored or rejected.
- Admin manual awards and corrections are separate `requireAdmin()` flows. They may target another **User**, but they must write audited admin actions and cannot share the public redemption endpoint.
- Public reads are DTOs: active Achievement/Mission teasers, authenticated current-User gamification summary, redemption result DTOs, public opt-out ops-board rows, and admin-only history/debug DTOs.
- PocketBase API rules should prevent browser clients from creating or directly reading raw CodeDefinitions, CodeRedemptions, ActivityClaims, XPEvents, admin audit records, partner consent records, and non-whitelisted Hi.Events or request metadata.

### Operational behavior

- Leaked code: admin disables or invalidates the CodeDefinition and records a `GamificationAdminAction` with the reason. New redemptions stop immediately. Existing accepted records remain unless an admin separately voids XP, revokes Badges, or applies corrections.
- Reissued code: admin creates a new CodeDefinition with a new raw code, prefix, and hash, usually linked to the same Activity and marked in metadata as replacing the old Code. The old Code remains disabled for audit. Per-Activity per-User limits prevent double awards across old and new codes.
- Lost raw code: raw codes are not recoverable. Reissue is the supported path.
- Event-day support: staff/admins use admin history by **User**, Mission/Activity, Code label/prefix, and support reference to see accepted and rejected states. Legitimate failures are resolved through audited manual awards or corrections, not partner/staff verifier accounts.
- Static easter eggs: discovered static links/codes redeem through this same flow. September does not add server-side puzzle answer validation; the secret code or link is the evidence.
- Shared codes: sharing a bearer code may let another authenticated **User** redeem it until windows, caps, rate limits, and invalidation stop it. That residual risk is acceptable for September because the release favors automated evidence and event-day support over verifier accounts or invasive checks.
