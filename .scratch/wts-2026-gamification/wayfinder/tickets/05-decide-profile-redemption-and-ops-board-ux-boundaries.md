# Decide Profile, Redemption, And Ops Board UX Boundaries

Status: closed
Assignee: OpenCode
Labels: wayfinder:prototype
Type: HITL
Created: 2026-07-09
Closed: 2026-07-09
Part of: `.scratch/wts-2026-gamification/wayfinder/MAP.md`

## Question

What should the first user-facing gamification surfaces show, and where should they live in the app?

Produce a low-fidelity outline for profile gamification summary, mission redemption success/failure/already-redeemed states using the secure redemption result states, hidden/locked badge treatment, mobile venue behavior, accessibility expectations, and the opt-out individual ops board. Decide how much of XP, level, badges, recent unlocks, next mission, display name, and privacy controls are included in the September conference release.

## Blocked by

- `.scratch/wts-2026-gamification/wayfinder/tickets/01-define-gamification-language-and-destination.md`
- `.scratch/wts-2026-gamification/wayfinder/tickets/02-decide-september-conference-release-scope.md`
- `.scratch/wts-2026-gamification/wayfinder/tickets/03-decide-core-accounting-and-data-model.md`
- `.scratch/wts-2026-gamification/wayfinder/tickets/04-decide-secure-mission-redemption-model.md`

## Resolution

Use the smallest September UX surface set that still supports the full conference release:

- Authenticated **Gamification Profile** summary on the existing `/user/profile` route.
- Canonical Mission redemption on `/missions/redeem`.
- Public individual ops board on `/ops-board`.

Do not add a separate public User profile route, in-app QR scanner, staff/partner verifier scanner route, team/faction board, full Mission catalog route, or venue-screen ops board for September. Admin/support history and correction surfaces remain in `Decide Admin Operations And Audit Model`.

### Profile summary location

The **Gamification Profile** summary lives inside the existing authenticated `/user/profile` page as a first-class panel near the identity and ticket sections. It should feel like part of the current agent/profile language, not a separate product area. Deep links such as `/user/profile#gamification` are fine, but September does not need a new `/user/gamification` route.

### Profile summary content

The authenticated profile summary should show the current **User**:

- Total XP as the primary personal progress number.
- Current level/access level from the **Gamification Profile** cache, using the configured level name once scoring rules are decided.
- Progress to the next access level with `xpIntoLevel`, `xpToNextLevel`, and a textual progress label.
- **Leaderboard XP** as a secondary explanation only where ranking/privacy controls are shown, because the public ops board ranks by **Leaderboard XP**, not necessarily total XP.
- Unlocked **Badges** in a compact grid, with name, icon/art, category, rarity, and safe XP/reason copy when available.
- Recent unlocks, limited to the latest few non-revoked **Badges** or user-facing XP reasons.
- Suggested next **Missions**, limited to active public Missions the **User** has not completed, safe teasers for locked-teaser Achievements, and contextual links such as agenda, sponsor/community page, or manual code entry where available.
- Ops-board privacy controls: public visibility toggle, ops-board display name, and Badge snippet visibility controls.

The summary should not expose raw **Activity Claims**, raw **XP Events**, raw redemption codes, code prefixes, admin notes, request fingerprints, Hi.Events private metadata, or other Users' data.

### Badge state treatment

Authenticated profile surfaces should distinguish Badge states without revealing hidden surprises:

- Unlocked active **Badges** appear in the main Badge grid and count toward Badge totals unless the underlying User Achievement was revoked.
- Locked public or locked-teaser **Achievements** can appear as locked Badge cards with safe teaser copy, category, rarity, and optional reward/progress copy. They should not imply the **User** has earned the Badge.
- Hidden-until-unlocked **Achievements** do not appear in locked Badge lists, suggested Missions, ops-board snippets, or public DTOs until unlocked. After unlock, they may appear to the **User** like any other Badge and may appear publicly only if the Achievement allows it and the **User** has not hidden public Badge snippets.
- Retired **Achievements** are not suggested as next Missions and should not appear as chaseable locked cards. Already-unlocked retired **Badges** remain visible to the owning **User** with a `Retired` label and can remain in public snippets if still marked public.
- Revoked User Achievements do not count toward totals, do not appear on the public ops board, and do not appear in the main unlocked Badge grid. The owning **User** may see a neutral correction row such as `Badge removed by event support`; full revocation reason and audit history are admin-only.

### Mission redemption route and component model

`/missions/redeem` is the only September user-facing redemption route. It should live as a SolidStart file-system route at `src/routes/missions/redeem.tsx` and use browser-only logic only for fragment/pending-code handling. The actual award operation remains a server function that derives the **User** from authentication.

The route owns these user-facing states:

- Reading a fragment code from `/missions/redeem#code=<rawCode>`.
- Manual code entry for typed codes.
- Auth redirect/resume.
- Loading and retry states.
- Rendering the public redemption result DTO.

Implementation agents should plan reusable gamification components under a `src/components/gamification/` boundary or equivalent local module, with seams like profile summary, Badge grid/card, recent unlocks, suggested Missions, redemption form/result card, ops-board table/cards, and ops-board privacy controls. Exact file names can change, but the route boundaries above should not.

Server-function contracts should stay DTO-based and serializable, roughly:

- `getMyGamificationProfileSummary()` for `/user/profile`.
- `redeemMissionCode(rawCode, sourceHint?)` for `/missions/redeem`.
- `getPublicOpsBoard()` for `/ops-board`.
- `updateGamificationVisibility(settings)` for profile privacy/display-name controls.

### Redemption result UX

Use the secure result states from `Decide Secure Mission Redemption Model` and keep public copy deliberately coarse:

- `accepted`: success state. Show the Mission outcome, any newly unlocked **Badges**, XP delta, updated access-level progress, and links to profile or suggested next Missions. If no Badge unlocked yet, say the field evidence was recorded.
- `already_redeemed`: success-like state. Say the Mission was already recorded, show the original safe outcome when available, and make clear no extra XP was added.
- `rejected_invalid`: error state. Say the Mission code could not be verified, offer manual re-entry and support fallback, and reveal nothing about prefixes, labels, or near matches.
- `rejected_not_yet_active`: blocked state. Say the Mission opens later. Show only safe public timing copy if configured for the Mission; otherwise suggest trying again at the venue.
- `rejected_expired`: closed state. Say the Mission window has closed and offer support fallback.
- `rejected_disabled`: closed state. Say the Mission code is no longer active and suggest event support. Do not expose leak, abuse, invalidation, or admin reason text.
- `rejected_global_limit`: closed state. Say the Mission reached its redemption limit. Do not expose redemption counts or other Users.
- `rejected_user_limit`: completion state. Say the Mission is already complete or the personal limit has been reached. Link to the profile summary rather than presenting it as a failure.
- `rejected_rate_limited`: retry-later state. Say there were too many attempts, tell the **User** to wait before trying again or ask event support, and reveal nothing about code validity.

Every non-success state should keep the manual entry form reachable unless the **User** is rate-limited. Every recognized failure should include safe support copy; admin/support tooling decides the actual manual award or correction flow later.

### Auth redirect and resume UX

Use the fragment-safe resume model from `Decide Secure Mission Redemption Model`:

- On `/missions/redeem#code=<rawCode>`, browser code reads the fragment, stores one pending code per tab in session storage with a short TTL, strips the fragment from the visible URL, and never sends the raw code through a query string, path segment, `redirect_url`, OAuth state, or Referer.
- If unauthenticated, the route stores only the same-origin resume target `/missions/redeem` in the existing login redirect mechanism and sends the visitor to `/login`.
- After login, `/missions/redeem` reads the pending code and calls the server redemption function. If the pending code is absent or expired, it shows manual entry and asks the **User** to scan again or type the code.
- The browser never validates a code before login and never submits a **User** ID, **Achievement** ID, **Activity Claim** ID, XP amount, or **Leaderboard XP** amount.
- One pending code per tab is enough for September; the newest scan can replace an older unredeemed pending code.

Implementation should ensure all login methods honor the same resume behavior before shipping the redemption route.

### Mobile venue behavior

September should rely on the device camera/OS QR scanner opening a normal web URL; there is no in-app QR scanner route. `/missions/redeem` must be mobile-first:

- A scanned QR/link should auto-attempt redemption after authentication with a clear loading state such as `Verifying mission evidence...`.
- Manual code entry should be prominent, tolerate lowercase, spaces, and hyphen differences according to the normalized code rules, and remain usable on small screens.
- The submit button should be disabled while a redemption request is in flight to avoid duplicate taps; duplicate scans still rely on server idempotency.
- If the browser is offline or the server is unavailable, do not award locally. Keep the pending code in tab storage, show a retry button, and tell the **User** to ask event support if they cannot reconnect.
- If Hi.Events or another non-code source is unavailable, local code redemption should still work; source-specific unavailable states belong to their own server functions and support copy.
- Support fallback copy should tell the **User** to show event support their logged-in profile email/display name and the visible support reference or Mission label when one is provided. It should not ask them to expose raw code internals beyond the human-readable code they scanned or typed.

### Accessibility expectations

Redemption, profile, and ops-board surfaces are September scope and must meet baseline accessible interaction expectations:

- Result changes move focus to a result heading or announce through an `aria-live` region; errors use `role="alert"` or equivalent assertive announcement.
- Manual code input has a visible label, clear hint text, error text connected with `aria-describedby`, and a keyboard-submittable form.
- Progress bars include textual progress and accessible values; progress is not conveyed by color alone.
- Badge cards expose state text such as `locked`, `unlocked`, `hidden`, `retired`, or `private`, and do not rely only on icon/color/hover.
- Interactive Badge visibility controls and ops-board privacy controls are keyboard reachable and have clear names.
- Motion, confetti, scan-line effects, or celebratory animation must respect reduced-motion preferences and cannot be required to understand the result.
- Public ops-board rank and **Leaderboard XP** are readable as text in table/card layouts, not only as visual position.
- Mobile touch targets for redemption actions and privacy toggles should be large enough for venue use.

### Public ops-board UX

The individual ops board lives at `/ops-board` and is public. It is opt-out by default for September: a new **Gamification Profile** is public on the ops board unless the **User** turns visibility off.

Public rows/cards should include only:

- Visible rank among public rows.
- Safe `opsBoardDisplayName`.
- Access level/level name.
- **Leaderboard XP**.
- Public Badge count and a small number of public Badge snippets.

Public rows/cards should not include email, auth identity, full legal name unless the **User** chooses it as their display name, total XP, raw recent activity, timestamps, Activity Claim details, XP Event ledger rows, partner consent state, Hi.Events metadata, admin/support notes, request metadata, or hidden/private Badge details.

Display-name handling:

- Default display name should be derived from `users.name` when safe, otherwise a generated handle such as `Agent <short-id>`; never default to email.
- The profile summary lets the **User** set `opsBoardDisplayName` with length and content validation.
- Duplicate display names are acceptable for September; rank and level provide context without requiring globally unique handles.
- Admin override/moderation, if needed, belongs to `Decide Admin Operations And Audit Model`.

Opt-out behavior:

- Turning off `opsBoardVisible` removes the **User** from public ops-board DTOs and public rank numbering.
- The authenticated profile still shows the **User** their own total XP, **Leaderboard XP**, access level, and Badge progress.
- Admin-only history may still include the **User** for support, audit, and fairness operations.

Badge snippets:

- Show only snippets from non-revoked User Achievements whose **Achievement** visibility permits public display and whose User Achievement is public-visible.
- A global `publicBadgesVisible` off switch hides all Badge snippets from the public row while leaving the row visible.
- Per-Badge public/private toggles can live on Badge cards; no separate Badge settings route is needed for September.
- Snippets should contain Badge name, icon/art, category or rarity, and no source Mission/partner timestamp unless a later decision explicitly allows it.

### Privacy boundaries

Authenticated profile DTOs may include the current **User**'s **Gamification Profile**, total XP, **Leaderboard XP**, access-level progress, unlocked/locked/retired Badge presentation, recent user-facing unlock reasons, suggested Missions, and visibility settings.

Public ops-board DTOs may include only public opted-in **Gamification Profile** rows, safe display names, level/access level, **Leaderboard XP**, rank among visible rows, and public Badge snippets.

Admin-only DTOs may include raw **Activity Claims**, **XP Events**, Code Redemptions, invalidation/rejection history, admin action history, support metadata, non-whitelisted Hi.Events metadata, and profile rebuild/debug data. Partner contact consent remains separate from **Partner Activity** evidence and is not implied by earning XP.

### September scope versus deferred

September scope:

- Profile gamification panel inside `/user/profile`.
- `/missions/redeem` with fragment handling, auth resume, manual entry, all secure redemption result states, mobile loading/offline/unavailable UX, and support fallback copy.
- Badge state presentation for unlocked, locked/teaser, hidden-until-unlocked, retired, revoked, and public/private snippet visibility.
- Public `/ops-board` with opt-out default, display-name handling, **Leaderboard XP**, access level, public Badge snippets, and profile privacy controls.
- Baseline accessibility for all three surfaces.

Deferred or out of September scope:

- Separate full Mission catalog, public User profile pages, share cards, in-app QR scanner, staff/partner verifier scanner UI, attendee-to-attendee scan UI, team/faction board, venue-screen board, native app behavior, server-side puzzle-answer validation, and real-time anti-fraud dashboards.
- Detailed admin/support routes, moderation tools, correction workflows, and analytics are not decided here; they remain in `Decide Admin Operations And Audit Model`.
