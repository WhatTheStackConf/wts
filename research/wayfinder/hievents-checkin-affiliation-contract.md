# Hi.Events deployed check-in and affiliation contract

**Ticket:** [Verify the deployed Hi.Events check-in and affiliation contract](https://github.com/WhatTheStackConf/wts/issues/20)
**Wayfinder:** [Wayfinder: Specify WTS 2026 Attendee Check-in and Name Label Printing](https://github.com/WhatTheStackConf/wts/issues/19)
**Researched:** 2026-08-14
**WTS source:** commit `70005d1bd7104564da721641a2e9f09874dafd7c` on `research/checkin-hievents`
**Official Hi.Events references:** stable tag `v1.11.1-beta` at `cfbf468bb5b1b4ed3cba18184edc2e1094318f17`; current `develop` at `8d020d5b8ed8dd38d2e0112d151992326106b42f`.

## Executive decision

The production coordinator **must not be implemented against the direct attendee lookup as if it proves list eligibility or existing check-in state**. The deployed frontend has the older check-in client surface: list, paginated list attendees, direct attendee lookup, create check-in, and delete check-in; it does not contain current `develop`'s `/stats` or `/detail` calls. The exact deployed Hi.Events version/tag and deployed backend semantics are not exposed, however, so source comparison is a behavioral fingerprint and conservative design input—not version identification or a substitute for test-list response captures.

The safe interim contract, combining production-safe observations with conservative upstream-source behavior, is:

1. Use the list-scoped paginated attendees endpoint for read-only list membership and reconciliation, selecting an **exact** `public_id` match from the results.
2. Treat the first POST response as authoritative only after inspecting both `data` and `errors[public_id]`; HTTP 200 alone is not success. This response shape is proven in pinned upstream source but still requires a deployed test-list capture.
3. Under the pinned upstream contract, a response with a check-in object and no attendee error is a newly accepted check-in. A response with the existing check-in object **and** an attendee error is an already-checked-in outcome and must not authorize automatic printing.
4. A timeout/lost POST response is unattributed. Reconcile through the list-scoped attendee list. An existing check-in proves current state but not whether WTS created it; therefore do not auto-print without stronger WTS-owned evidence or a named supervisor decision.
5. No authoritative Hi.Events affiliation source is presently proven. The live event exposes no non-hidden custom questions, the public check-in attendee DTO contains no affiliation or question answers, and the WTS adapter drops question-answer data. Affiliation and its missing-value rule remain an implementation blocker.

No production check-in or attendee was mutated during this research.

## Evidence boundary and direct answers

The findings below intentionally keep four evidence classes separate:

| Evidence class | What it establishes here | What it does **not** establish |
|---|---|---|
| **Deployed-safe evidence** | Read-only public responses for event 5, its visible questions, response rate-limit headers, public version-path behavior, and the deployed frontend bundle's client calls. | Exact image/tag/commit; private or hidden questions; list identifiers/configuration; test-list availability; actual POST/DELETE envelopes or backend race behavior. |
| **Pinned upstream-source evidence** | Exact behavior of Hi.Events tag `v1.11.1-beta` and the cited `develop` commit, including route, DTO, service, and migration behavior. | Proof that either backend revision is deployed. The public bundle is only a surface fingerprint. |
| **Historical plan claims** | The recovered implementation plan proposed a conservative workflow and explicitly made version, list ID, test-list existence, and fixture probes Task 0 prerequisites (plan lines 690–708). It proposed full-name-only label content and stripping custom attendee fields (lines 1074–1080). | A deployed affiliation source, a two-line affiliation requirement, a missing-value rule, or completed deployment verification. The plan is design history, not runtime evidence. |
| **Unknowns / operator-owned configuration** | Items explicitly listed as blockers below. | They must not be filled in from guesses, source similarity, email domain, or an undisclosed capability URL. |

**Direct answer on production-safe reach:** safe public reads establish the older frontend endpoint surface, event settings, absence of currently public/non-hidden questions, and the observed public-IP rate-limit header. They cannot establish the exact deployed backend version or whether a non-production check-in list exists. Public event data does not enumerate check-in lists, and this research was not given and did not guess a list capability URL.

## Evidence and confidence

### 1. Deployed version and endpoint fingerprint

| Finding | Status | Evidence |
|---|---|---|
| The exact deployed tag/commit is exposed by neither the public page nor a public version endpoint. | **Unknown** | `GET https://hievents.foundry.mk/api/version` returned 404 on 2026-08-14; `/VERSION` and `/version` returned the frontend HTML shell. No version claim can be made from these responses. |
| The deployed check-in frontend is from the older surface, not current `develop`. | **Proven behavioral fingerprint** | The deployed public bundle [`index-B3iLdcHV.js`](https://hievents.foundry.mk/assets/index-B3iLdcHV.js) calls list, attendees, direct attendee, POST check-in, and DELETE check-in, with no `/stats` or `/detail`. This matches the pinned stable client ([lines 12–40](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/frontend/src/api/check-in.client.ts#L12-L40)); current `develop` adds `/stats` and `/detail` ([lines 14–50](https://github.com/HiEventsDev/Hi.Events/blob/8d020d5b8ed8dd38d2e0112d151992326106b42f/frontend/src/api/check-in.client.ts#L14-L50)). |
| It is unsafe to assume current `develop`'s race fix or detail endpoint is deployed. | **Proven implication** | Current `develop` adds a unique live check-in index ([migration lines 10–26](https://github.com/HiEventsDev/Hi.Events/blob/8d020d5b8ed8dd38d2e0112d151992326106b42f/backend/database/migrations/2026_07_20_000002_add_unique_attendee_check_in_index.php#L10-L26)) and catches the resulting unique violation ([service lines 178–203](https://github.com/HiEventsDev/Hi.Events/blob/8d020d5b8ed8dd38d2e0112d151992326106b42f/backend/app/Services/Domain/CheckInList/CreateAttendeeCheckInService.php#L178-L203)). The pinned stable implementation has only a pre-insert duplicate check ([lines 184–208](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Services/Domain/CheckInList/CreateAttendeeCheckInService.php#L184-L208)). |

**Decision implication:** record the production image/tag or expose authenticated system-info before implementation. Until then, code to the conservative older behavior and serialize one mutation attempt per attendee workflow.

### 2. Attendee lookup, list membership, and eligibility

The public routes in the pinned stable source are:

```text
GET    /api/public/check-in-lists/{listShortId}
GET    /api/public/check-in-lists/{listShortId}/attendees
GET    /api/public/check-in-lists/{listShortId}/attendees/{attendeePublicId}
POST   /api/public/check-in-lists/{listShortId}/check-ins
DELETE /api/public/check-in-lists/{listShortId}/check-ins/{checkInShortId}
```

Source: [stable route definitions, lines 490–543](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/routes/api.php#L490-L543). The deployed frontend bundle calls exactly these check-in endpoints.

#### List-scoped paginated attendees is the conservative read model (upstream-derived)

The pinned stable list query joins attendee products to the named check-in list, limits attendee statuses to `ACTIVE`, `CANCELLED`, or `AWAITING_PAYMENT`, limits orders to completed or awaiting offline payment, loads check-ins, and caps `per_page` at 250 ([repository lines 106–140](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Repository/Eloquent/AttendeeRepository.php#L106-L140)). The handler then attaches only the check-in for the requested list ([handler lines 31–54](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Services/Application/Handlers/CheckInList/Public/GetCheckInListAttendeesPublicHandler.php#L31-L54)). The public response includes name, public ID, product IDs, status, and an optional list-specific `check_in`; it contains neither email nor custom-question answers ([resource lines 15–30](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Resources/Attendee/AttendeeWithCheckInPublicResource.php#L15-L30)).

The query parameter is a fuzzy search across name, attendee public ID, and email ([repository lines 109–123](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Repository/Eloquent/AttendeeRepository.php#L109-L123)). Because it is fuzzy, the WTS adapter must still require one exact `public_id` match.

#### Direct lookup must be treated as non-authoritative

The pinned stable direct handler looks up only `{public_id, event_id}` and neither verifies product/list membership nor attaches the list-specific check-in ([lines 29–47](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Services/Application/Handlers/CheckInList/Public/GetCheckInListAttendeePublicHandler.php#L29-L47)). Although it serializes with the same DTO, `check_in` appears only if the handler populated it ([resource lines 27–29](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Resources/Attendee/AttendeeWithCheckInPublicResource.php#L27-L29)). Current `develop` adds direct-lookup membership checks ([lines 43–71](https://github.com/HiEventsDev/Hi.Events/blob/8d020d5b8ed8dd38d2e0112d151992326106b42f/backend/app/Services/Application/Handlers/CheckInList/Public/GetCheckInListAttendeePublicHandler.php#L43-L71)), but neither backend behavior has been captured from the deployed system. The stable behavior is therefore the conservative compatibility assumption.

**Decision implication:** never let a successful direct GET authorize check-in or printing, and never interpret missing `check_in` there as “not checked in.”

#### Mutation eligibility

The POST service verifies product/list membership before insertion ([stable lines 168–194](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Services/Domain/CheckInList/CreateAttendeeCheckInService.php#L168-L194)). It rejects cancelled attendees; it also rejects `AWAITING_PAYMENT` for ordinary `check-in` when the event disallows unpaid check-in ([lines 218–248](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Services/Domain/CheckInList/CreateAttendeeCheckInService.php#L218-L248)). The live event's public event response currently reports:

```json
{
  "attendee_details_collection_method": "PER_TICKET",
  "required_attendee_details": true,
  "allow_orders_awaiting_offline_payment_to_check_in": false,
  "allow_attendee_self_edit": true
}
```

Source: deployed read-only [`GET /api/public/events/5`](https://hievents.foundry.mk/api/public/events/5), observed 2026-08-14.

In pinned stable source, unknown attendee codes, missing lists, wrong-list attendees, inactive lists, and status failures are returned as conflict/forbidden errors according to the relevant action/service paths; they must not produce a print intent. Error text is localized and is not a stable machine code. Exact deployed statuses/envelopes remain a test-list verification item.

### 3. New versus existing check-in response semantics (upstream-derived)

The request accepts only an attendee array with `public_id` and action (`check-in` or the other supported enum value); there is no idempotency key ([request lines 11–17](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Http/Request/CheckInList/CreateAttendeeCheckInPublicRequest.php#L11-L17)).

For an attendee already checked into the list, pinned stable source returns the existing check-in object **and** adds an attendee-keyed error ([service lines 184–190](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Services/Domain/CheckInList/CreateAttendeeCheckInService.php#L184-L190)). The action sends the check-in collection plus the error map without changing the default 200 status ([action lines 27–44](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Http/Actions/CheckInLists/Public/CreateAttendeeCheckInPublicAction.php#L27-L44)). A newly created check-in has a returned `short_id` and timestamp ([resource lines 13–22](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Resources/CheckInList/AttendeeCheckInPublicResource.php#L13-L22)). These are upstream-source semantics, not deployed response captures.

Source-derived, redacted fixtures for adapter tests (these are not production mutation captures):

```json
// newly_checked_in: HTTP 200
{
  "data": [{
    "id": 123,
    "short_id": "C-<redacted>",
    "check_in_list_id": 456,
    "attendee_id": 789,
    "checked_in_at": "2026-09-19T08:00:00.000000Z",
    "order_id": 101
  }]
}
```

```json
// already_checked_in: HTTP 200; do not auto-print
{
  "data": [{
    "id": 123,
    "short_id": "C-<redacted>",
    "check_in_list_id": 456,
    "attendee_id": 789,
    "checked_in_at": "2026-09-19T08:00:00.000000Z",
    "order_id": 101
  }],
  "errors": {
    "A-<redacted>": "<localized already-checked-in message>"
  }
}
```

```json
// top-level rejection such as unknown code/wrong list/inactive list: typically HTTP 409
{
  "message": "<localized operator-safe message>",
  "errors": []
}
```

**Classification rule:**

- exact returned attendee check-in + no `errors[publicId]` → `newly_checked_in`;
- `errors[publicId]` present, even if `data` also contains a check-in → `already_checked_in` or conservative `rejected`; never authorize initial printing;
- 409/403/422 → rejected unless the adapter has a separately proven retry classification;
- 429/5xx/network failure → retryable only when no mutation may have occurred; a lost POST response is `outcome_unknown`.

Do not branch on English error strings.

### 4. Ambiguous/lost response reconciliation (conservative design)

There is no idempotency field in the POST request contract. In the stable source family the duplicate check occurs before insertion and there is no unique live `(attendee_id, check_in_list_id)` constraint/race recovery. Consequently:

1. WTS must acquire a durable, event+attendee-scoped workflow lease before the POST and must not issue concurrent POSTs for the same attendee.
2. If the first POST times out or the connection closes after sending, record `checkin_outcome_unknown` and create no print intent.
3. Query the list-scoped paginated attendee endpoint using the attendee public ID as the search term; select only an exact `public_id` match and inspect its list-specific `check_in`.
4. If no exact attendee/check-in exists after a bounded consistency wait, the same fenced workflow may retry.
5. If a check-in exists, that proves current Hi.Events state but cannot distinguish WTS's lost success from another scanner's success. Without WTS-owned response/webhook evidence that identifies the same check-in, require named-supervisor resolution and never auto-print.

The active WTS adapter already models complete/partial/unavailable pagination and safe GET retry behavior ([`src/lib/hievents.ts` lines 315–438](../../src/lib/hievents.ts#L315-L438)); its tests cover paginated completion, interruption, malformed pagination/data, cross-origin next links, and bounded 503 retries ([`src/lib/gamification.test.ts` lines 6107–6244](../../src/lib/gamification.test.ts#L6107-L6244)). It does **not** implement the public check-in POST or this reconciliation state machine.

### 5. Rate limits

The live public event and questions GET responses included:

```text
X-RateLimit-Limit: 180
X-RateLimit-Remaining: <decrementing value>
```

The official stable configuration defaults `APP_API_RATE_LIMIT_PER_MINUTE` to 180 ([config line 21](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/config/app.php#L20-L22)), and the API limiter keys authenticated traffic by user ID and public traffic by request IP ([provider lines 25–30](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Providers/RouteServiceProvider.php#L25-L30)).

**Proven deployed limit:** 180 requests/minute for the observed public source IP.
**Not proven:** burst behavior, `Retry-After`, proxy/IP topology from the future coordinator, or whether event operations will raise the limit.

**Decision implication:** all stations behind one WTS coordinator may share one public-IP budget. Add a shared limiter/backpressure policy, honor 429 headers, cache safe reads, and measure peak rehearsal throughput. Do not intentionally exhaust the production limit to test it.

### 6. Undo/reset support (surface observed; behavior upstream-derived)

The public contract includes `DELETE /check-in-lists/{listShortId}/check-ins/{checkInShortId}` ([stable route line 543](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/routes/api.php#L538-L543)). It looks up the exact list/check-in pair, soft-deletes it, returns 204, and returns 409 if no matching live check-in exists ([service lines 24–53](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Services/Domain/CheckInList/DeleteAttendeeCheckInService.php#L24-L53); [action lines 21–40](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Http/Actions/CheckInLists/Public/DeleteAttendeeCheckInPublicAction.php#L21-L40)). The deployed frontend bundle contains this DELETE call.

The deployed frontend advertises a check-out/reset primitive, and pinned stable source defines the behavior above, but it was **not exercised against the deployed backend**. WTS should expose it only to named supervisors with an audit reason. It is suitable for resetting dedicated non-production fixtures once a test list is confirmed; it must not be part of automatic lost-response reconciliation.

### 7. Affiliation source and missing-value behavior

#### What is proven

1. On 2026-08-14, the live event's public question endpoint returned exactly:

   ```json
   { "data": [] }
   ```

   Source: deployed read-only [`GET /api/public/events/5/questions`](https://hievents.foundry.mk/api/public/events/5/questions).

2. The pinned stable public-question action returns every non-hidden event question and its product associations ([action lines 22–32](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Http/Actions/Questions/GetQuestionsPublicAction.php#L22-L32); [resource lines 14–30](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Resources/Question/QuestionResourcePublic.php#L14-L30)). On those semantics, the deployed empty response means no **currently non-hidden** custom question, including affiliation, is configured for event 5; independently, the deployed public interface exposes no question the integration can use.
3. Hi.Events' built-in public check-in attendee DTO has no affiliation or question answers ([resource lines 15–30](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Resources/Attendee/AttendeeWithCheckInPublicResource.php#L15-L30)).
4. The pinned stable authenticated organizer attendee DTO can expose product-level `question_answers` when that relationship is loaded; each answer has stable `question_id`, raw `answer`, and formatted `text_answer` ([attendee resource lines 47–53](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Resources/Attendee/AttendeeResource.php#L47-L53); [answer resource lines 18–35](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Resources/Question/QuestionAnswerViewResource.php#L18-L35)). However, the pinned stable handler corresponding to the organizer attendee-list endpoint used by the active WTS adapter explicitly loads only order and check-ins ([handler lines 20–31](https://github.com/HiEventsDev/Hi.Events/blob/cfbf468bb5b1b4ed3cba18184edc2e1094318f17/backend/app/Services/Application/Handlers/Attendee/GetAttendeesHandler.php#L20-L31)). Whether another deployed authenticated endpoint loads answers is unverified.
5. The active WTS adapter normalizes email, eligibility, check-ins, names, product, and locale, but has no affiliation/question-answer field ([`src/lib/hievents.ts` lines 51–69 and 215–244](../../src/lib/hievents.ts#L51-L69)). Its tests contain no affiliation fixture or assertion.

#### Authoritative answer

**There is no authoritative deployed affiliation field that can be named today.** A hidden or historical organizer-only question cannot be ruled out without authenticated read access, but it would not be collected by the current public checkout and its ID/answer contract has not been supplied. Email domain, ticket title, WTS account profile, CFP speaker affiliation, and free-form operator guesses are not valid substitutes for an attendee label contract.

#### Required product/integration decision

Before implementation, the event owner must:

1. Create or identify one product-level Hi.Events text question for affiliation and record its immutable **question ID** in server-only event configuration; never match only on a localized title.
2. Make it applicable to every admission product that should produce a Name Label (and explicitly decide whether add-on-only attendees are eligible for the main check-in list).
3. Decide whether it is required at checkout and whether attendee self-edit can change it after purchase.
4. Prove which authenticated read endpoint/relationship returns `question_answers[].question_id` and `text_answer` on the deployed version, then add redacted fixtures and adapter tests.
5. Specify missing-value behavior. Recommended conservative rule: trim/collapse whitespace; treat absent answer, `null`, empty string, and whitespace-only as **missing**; render row two as blank rather than inventing an organization. If operations require nonblank affiliation, stop in an explicit `affiliation_missing` operator state and collect a supervised label-only correction—do not mutate Hi.Events implicitly.

Until these are done, the two-line Name Label requirement is blocked.

### 8. Non-production list and fixtures

**Not proven available.** No check-in-list short ID or test-list identifier was supplied by the ticket/context, and public event data does not enumerate check-in lists. This research intentionally did not read credential values or `.env` files and did not guess capability URLs. Therefore production list membership, already-checked-in fixtures, cancelled/unpaid fixtures, and reset behavior were not probed.

Required safe fixture matrix on a dedicated non-production list:

- active eligible attendee with affiliation;
- active eligible attendee with missing/blank affiliation;
- already checked-in attendee;
- unknown attendee ID;
- attendee for a product outside the list;
- cancelled attendee;
- awaiting-payment attendee while `allow_orders_awaiting_offline_payment_to_check_in=false`;
- concurrent duplicate POSTs;
- one accepted POST whose client response is deliberately discarded, followed by list reconciliation;
- DELETE reset using the returned check-in `short_id`.

Do not run this matrix against production attendees. Save real deployed redacted envelopes only after the organizer provides the test capability.

## Implementation gates / open blockers

1. **Exact deployed version/image/tag:** unknown; the bundle only proves an older behavioral surface.
2. **Production and test check-in-list configuration:** list short IDs, product membership, activation/expiry, and existence of a non-production list are unknown.
3. **Real deployed POST envelopes:** source-derived semantics are strong, but new/existing/unknown/wrong-list/cancelled/awaiting-payment responses still need read/write testing on dedicated fixtures.
4. **Affiliation:** no visible question exists; no immutable question ID, answer endpoint, historical backfill, or final missing-value rule exists.
5. **Lost-response attribution:** no idempotency key exists. The design needs durable WTS workflow fencing plus supervisor resolution for an existing but unattributed check-in.
6. **Throughput:** deployed limit 180/min is proven, but peak station rate and any planned production override are unknown.
7. **Undo policy:** the deployed frontend exposes the DELETE call and pinned stable source defines reset behavior, but deployed behavior, named supervisors, authorization, audit requirements, and event-day use policy remain unverified.

## Recommended contract tests to add later

- Exact-list attendee query returns one exact `public_id`; fuzzy neighbors are ignored.
- Direct lookup missing `check_in` never becomes “not checked in.”
- HTTP 200 with `data` only → `newly_checked_in` and retains `short_id`.
- HTTP 200 with `data` plus `errors[publicId]` → `already_checked_in`; no print authorization.
- 409 localized error → typed rejection without English-string branching.
- Timeout after POST send → `outcome_unknown`; no automatic print.
- Reconciliation exact match absent/present and partial pagination fail closed.
- 429 honors backoff and never converts to a check-in outcome.
- Affiliation uses configured question ID and normalized `text_answer`; missing/null/blank follow the selected rule.
- DELETE 204 resets only a dedicated fixture; unknown check-in DELETE 409 is handled idempotently by test cleanup.

## Source index

- [Deployed WTS Hi.Events event](https://hievents.foundry.mk/event/5/whatthestack-2026)
- [Deployed public event API](https://hievents.foundry.mk/api/public/events/5)
- [Deployed public event questions API](https://hievents.foundry.mk/api/public/events/5/questions)
- [Deployed check-in frontend bundle](https://hievents.foundry.mk/assets/index-B3iLdcHV.js)
- [Hi.Events stable tag commit](https://github.com/HiEventsDev/Hi.Events/commit/cfbf468bb5b1b4ed3cba18184edc2e1094318f17)
- [Hi.Events current develop commit](https://github.com/HiEventsDev/Hi.Events/commit/8d020d5b8ed8dd38d2e0112d151992326106b42f)
- [Active WTS adapter](../../src/lib/hievents.ts)
- [Active WTS adapter tests](../../src/lib/gamification.test.ts#L6107-L6244)
