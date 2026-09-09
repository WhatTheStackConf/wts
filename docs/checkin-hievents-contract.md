# Hi.Events admission-event discovery contract

Scope: issue #46, WTS 2026 only. This is a separate read-only adapter; `src/lib/hievents.ts` and its ticket/gamification behavior are unchanged. No admission, attendee lookup, checkout edit, email, camera or printing is implemented here.

## Evidence boundary

The adapter is based on inspected upstream source at **`cfbf468bb5b1b4ed3cba18184edc2e1094318f17`**, not an assertion that this backend revision is deployed. The controlled admission fixtures in [issue #28](https://github.com/WhatTheStackConf/wts/issues/28) do not prove deployed account-wide discovery or production configuration. All new automated upstream responses are explicitly synthetic.

Source references at that exact commit:

- [Authenticated route declarations](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/routes/api.php): `auth:api` group, `GET /events`, `/events/{event_id}/check-in-lists`, `/events/{event_id}/questions`, `/events/{event_id}/products`.
- [GetEventsAction](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Http/Actions/Events/GetEventsAction.php), [GetEventsHandler](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Services/Application/Handlers/Event/GetEventsHandler.php): organizer-or-higher authenticated discovery, scoped to the authenticated account, returning a `LengthAwarePaginator`.
- [AuthUserService](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Services/Domain/Auth/AuthUserService.php): authenticated account comes from the JWT `account_id` claim; an invented account-switch header is not used.
- [GetCheckInListsHandler](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Services/Application/Handlers/CheckInList/GetCheckInListsHandler.php) and [CheckInListResource](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Resources/CheckInList/CheckInListResource.php): paginated exact event scope, loaded event/products, numeric `id`, `name`, capability `short_id`, `is_active`, `is_expired`, and products with event IDs. **The capability is server-only.**
- [GetQuestionsAction](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Http/Actions/Questions/GetQuestionsAction.php) and [QuestionResource](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Resources/Question/QuestionResource.php): event-authorized collection with product relations, **not a paginator** despite the frontend client's generic type. Fields include `id`, `event_id`, `title`, `type`, `belongs_to`, and `product_ids`.
- [GetProductsHandler](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Services/Application/Handlers/Product/GetProductsHandler.php) and [ProductResource](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Resources/Product/ProductResource.php): event-scoped paginator, including `id`, `event_id`, and `title`. Any filtered/incomplete paginator fails closed rather than silently treating its remaining rows as exhaustive.
- [BaseAction](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Http/Actions/BaseAction.php) and [QueryParamsDTO](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Http/DTO/QueryParamsDTO.php): Laravel resource envelopes and explicit `page`/`per_page` parameters, default 25.

## Server configuration and fail-closed reads

Configure private server variables only:

- `HIEVENTS_API_URL`: the complete HTTPS API base, including `/api`. No userinfo, query, fragment or embedded secret. No default production URL.
- `HIEVENTS_API_KEY`: a pre-issued authenticated bearer JWT for this adapter. Despite the legacy variable name, this contract does not assume an opaque API-key header. The upstream validates its signature, expiry and permissions. Obtain/rotate it through separately authorized operations; this slice performs no login or token-renewal POST.
- `HIEVENTS_ACCOUNT_ID`: exact positive decimal account ID, required to match the JWT claim. This comparison is configuration consistency, not local JWT authentication.

No `HIEVENTS_EVENT_ID`, public Appearance Event or title/year heuristic supplies admission configuration. The stable source key hashes endpoint+account (not the token). Token rotation keeps the same identity; a changed source/account makes persisted mappings unavailable rather than retargeting their numeric IDs. Restore the expected source or plan an explicit forward migration; do not edit immutable source identities.

The adapter issues GET only, refuses redirects, uses no cookies, bounds each response to 2 MiB and each read to 10 seconds. Arrival preflight (#49) adds a shared GET-only budget with at most three automatic attempts, jittered backoff and Retry-After handling; see [arrival preflight](checkin-arrival-preflight.md) for its process-local scope. Pagination must prove contiguous pages, constant totals/page size, expected row counts, unique IDs, matching page/path/first/last/prev/next and safe same-endpoint navigation links. It builds URLs locally, never follows an upstream next URL. Each collection is capped at 1,000 rows and 40 pages. Questions are a bounded complete collection. Missing metadata, duplicate/unsafe IDs, partial reads and cross-event product/question references fail closed. A dependency failure is `unavailable`; failure after a validated page is `partial`; neither returns a successful partial catalogue.

Admin-safe projections contain IDs/titles and product scopes, never `short_id`, JWTs, upstream descriptions or raw diagnostics. Titles are bounded and suspicious private text receives a generic ID-based label. Only active, unexpired lists are offered for new mappings. Product-level text questions are offered for affiliation; order questions are not attendee affiliation inputs. An empty product selection adds no restriction beyond the question's own scope. Existing configured answers are read in later slices; this code creates no questions or answers.

## Persistence, selection and downstream context

`1790000002_create_checkin_events.js` creates an empty deny-by-default collection; it seeds no upstream IDs. An admin explicitly records membership, list and optional question/product mapping, enabled state and generation. Unconfigured edition members remain visible but disabled. Configuration writes recheck live admin authority and use transactional Admin Actions plus immutable feature audit. Same UUID/payload replays its original result without another write; different payload or stale generation conflicts. Replay does not undo newer configuration.

The operator's selection is stored on their hashed Station Client Binding, not on the station or User. All catalogue/selection requests check live role and binding, discover current events, and verify each enabled member's exact active list and optional affiliation mapping. A removed/expired list or incomplete option read makes that event unavailable; it produces no context and cannot be selected. Validation is tied to the stored event generation and list, so concurrent configuration changes cannot reuse an earlier proof. No upstream list or capability reaches operator DTOs. Station/system stops disable selection. Configuration edits and rebinding invalidate old context; selection changes do not mutate already-returned snapshots.

The UI refreshes event discovery on entry, binding/station-generation changes, focus and explicit refresh/selection, not on every five-second station status poll. This avoids multiplying full account/list reads per phone heartbeat. The last displayed context is an observation, not cached authority for a new request; new selection and downstream resolution always perform live checks.

`CheckinEventContext` version 1 contains opaque internal event/binding/station references and event, selection, binding, station and system fences. `CheckinEventService.validateContext()` is **read-only context resolution, not admission acceptance**. It checks the fence before and after live upstream reads and returns a server-only snapshot containing exact source/event/list and optional question/product references. Downstream admission intake must perform the same checks **inside its work-acceptance transaction**, persist an immutable copy there, and never retarget accepted work by rereading the phone's selection. No future workflow ownership or effect guarantee is implied by this helper.

## Required deployed integration proof — outstanding

Before configuring production event use, a separately authorized operator must retain redacted evidence for the **actual deployed** contract:

1. Exact backend image/tag/commit if available, observed HTTPS API base and authentication/account scope (no credentials in evidence).
2. All pages of authorized discovery, counts and navigation metadata, including empty-account behavior and a controlled interrupted read. Confirm which exact events belong to WTS 2026 with the owner, not their titles.
3. Each chosen event's lists and immutable IDs, active/expired semantics, product associations, and source/list capability handling. Capture list pagination and prove it is complete.
4. Each optional affiliation question's immutable ID, attendee/product scope and exact product IDs. Confirm deployed questions are unpaginated (or explicitly adapt/test a different observed contract). No fixture list/question/product ID may be a production default.
5. Real authenticated admin configuration and operator catalogue readback, correct per-phone selections, generation changes and secret-free wire DTOs. Verify credential expiry/replacement and dependency outages fail closed.

No item above was performed by these software tests. Production/device readiness, admission submission, cross-process rate-budget coordination, physical devices and rollout approval remain outside this slice. Read-only durable intake is documented separately in [arrival preflight](checkin-arrival-preflight.md). See [checkin-verification.md](checkin-verification.md) for the disposable automated gate.
