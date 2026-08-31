# Hi.Events controlled check-in fixtures and deployed evidence

**Ticket:** [Establish controlled Hi.Events check-in fixtures](https://github.com/WhatTheStackConf/wts/issues/28)  
**Wayfinder:** [Wayfinder: Specify WTS 2026 Attendee Check-in and Name Label Printing](https://github.com/WhatTheStackConf/wts/issues/19)  
**Captured:** 2026-08-14  
**Related contract:** [Hi.Events deployed check-in and affiliation contract](./hievents-checkin-affiliation-contract.md)

## Resolution status

**Complete.** The controlled fixture matrix establishes the deployed behavior and safe boundary for every requested case. A genuine awaiting-payment attendee is not reachable under the WTS event configuration: offline payment is not configured, `allow_orders_awaiting_offline_payment_to_check_in = false`, and the deployed transition of a dedicated hidden paid-product order to offline payment returned HTTP 403. The temporary order was abandoned successfully. This is the deployed answer for the awaiting-payment case; enabling an unused payment method solely to manufacture the state would change live event behavior rather than verify it.

No production attendee was checked in, cancelled, edited, or deleted. Every mutation below targeted synthetic attendees attached to hidden fixture products and the dedicated fixture list. Capability values, attendee public IDs, QR payloads, names, emails, ticket/order codes, cookies, authorization data, and localized error text are omitted.

## Fixture boundary

The organizer UI initially had no check-in lists. The following dedicated non-production boundary was created and verified before the first check-in mutation:

| Resource | Immutable ID | Deployed configuration |
|---|---:|---|
| Check-in list | `3` | `WTS 2026 NON-PRODUCTION CHECK-IN FIXTURES`; active; capability present but redacted |
| Eligible fixture ticket | `10` | Free ticket, hidden from customers, associated with list `3` |
| Awaiting-payment fixture ticket | `12` | Paid ticket, hidden from customers, associated with list `3` |
| Wrong-list fixture ticket | `11` | Free ticket, hidden from customers, deliberately not associated with list `3` |
| Affiliation fixture question | `3` | `SINGLE_LINE_TEXT`, belongs to `PRODUCT`, hidden, optional, associated only with ticket `10` |

The organizer GET for list `3` returned exactly product IDs `[10, 12]`; both products were hidden. The public list GET returned HTTP 200, the exact fixture-list name, `is_active`, activation/expiration fields, product data, and attendee totals. Its capability identifier exists but is not recorded here.

### Access and secret location

The list capability is managed only in the authenticated Hi.Events organizer UI under **WhatTheStack 2026 → Check-In Lists → WTS 2026 NON-PRODUCTION CHECK-IN FIXTURES → Copy Check-In URL**. It is not committed to this repository or written into this artifact. Temporary automation state was kept at `/tmp/wts-hievents-fixture-state.json` with mode `0600` and securely removed after verification; it is not an implementation configuration source.

No WTS server-only deployment secret has been provisioned by this task. A later implementation must place the selected list capability in the deployment's server-only secret manager rather than source control or browser-visible configuration.

## Authoritative list read

A list-scoped attendee GET searched with the attendee public ID and then required one exact `public_id` match. Deployed results:

| Case | HTTP | Exact matches | Status | Product | List-specific `check_in` |
|---|---:|---:|---|---:|---|
| Active with affiliation | 200 | 1 | `ACTIVE` | `10` | absent before mutation |
| Active with missing affiliation | 200 | 1 | `ACTIVE` | `10` | absent before mutation |
| Cancelled | 200 | 1 | `CANCELLED` | `10` | absent |
| Product outside list | 200 | 0 | — | — | absent |

The returned check-in object, when present, contains `id`, `short_id`, `check_in_list_id`, `attendee_id`, `order_id`, and `checked_in_at`. Direct attendee lookup was not used to authorize any mutation.

## Affiliation answer contract

Authenticated organizer detail GET `/api/events/5/attendees/{id}` is the deployed answer source that exposed the fixture answer:

- attendee on product `10` with an answer: `question_answers[]` contained `question_id = 3`, a raw `answer`, and `text_answer`; both values were present and nonblank;
- attendee on product `10` without an answer: the `question_answers` field was present as an empty array;
- therefore the fixture adapter can identify the answer only by immutable question ID `3`, normalize `text_answer`, and treat an absent entry/empty array as missing;
- public list-scoped attendee GET does not expose question answers.

This proves the deployed relationship and missing representation without establishing a production checkout policy. Question `3` is deliberately hidden and covers only fixture product `10`; no production admission product was changed. Production affiliation coverage remains a downstream decision.

## Redacted deployed mutation envelopes

### Newly accepted

HTTP 200:

```json
{
  "data": [{
    "id": "<redacted-check-in-id>",
    "short_id": "<redacted-check-in-capability>",
    "check_in_list_id": 3,
    "attendee_id": "<redacted-synthetic-attendee-id>",
    "order_id": "<redacted-synthetic-order-id>",
    "checked_in_at": "<timestamp-present>"
  }]
}
```

No `errors` field was present. This is the only observed envelope that can classify a POST as newly accepted.

### Already checked in

The first POST returned the newly accepted envelope. The second POST returned HTTP 200 with both one existing check-in object and one attendee-keyed error:

```json
{
  "data": [{ "<same-check-in-fields>": "<redacted>" }],
  "errors": {
    "<redacted-attendee-public-id>": "<localized-message-redacted>"
  }
}
```

The list-scoped reconciliation GET showed `check_in` present. HTTP 200 alone is therefore not success; the requested attendee's entry in `errors` must be inspected, and this envelope must not authorize automatic printing.

### Unknown attendee

HTTP 409:

```json
{
  "message": "<localized-message-redacted>",
  "errors": []
}
```

### Product outside the list

HTTP 409 with the same top-level shape as the unknown-attendee case:

```json
{
  "message": "<localized-message-redacted>",
  "errors": []
}
```

### Cancelled attendee

The organizer API verified status `CANCELLED`. POST returned HTTP 200 with no check-in data and one attendee-keyed error:

```json
{
  "data": [],
  "errors": {
    "<redacted-attendee-public-id>": "<localized-message-redacted>"
  }
}
```

This is a rejection despite HTTP 200.

### Awaiting payment — proven unreachable under WTS configuration

A dedicated hidden paid product (`12`) was associated with the fixture list. A synthetic public order was created and completed, but the deployed offline-payment transition returned HTTP 403. The temporary order was abandoned with HTTP 200. Current authenticated settings show:

```json
{
  "offline_payment_instructions_present": false,
  "allow_orders_awaiting_offline_payment_to_check_in": false
}
```

No genuine `AWAITING_PAYMENT` attendee exists and no check-in POST envelope is claimed for this case. The deployed contract is that WTS cannot currently create this state through its configured checkout paths. The integration must still fail closed if Hi.Events ever returns `AWAITING_PAYMENT`, but WTS does not need to enable offline payment or manufacture the state to establish today's boundary.

## Concurrent duplicate result

Two POSTs for the same clean synthetic attendee were dispatched concurrently through the same dedicated list:

- both returned HTTP 200;
- both returned `data` with no `errors` field;
- the returned/reconciled data contained **two distinct live check-in capabilities**;
- list-scoped reconciliation exposed one check-in object, which was insufficient to reveal the duplicate by itself;
- both distinct check-ins were deleted successfully with HTTP 204;
- final reconciliation showed no live check-in.

**Deployed fact:** concurrent duplicate requests can create more than one live check-in on this backend. WTS must serialize/fence one mutation workflow per event+attendee and cannot rely on the list read alone to detect that race.

## Deliberately lost response and reconciliation

A POST request for a clean synthetic attendee was observed leaving a headless browser page. The page was then closed without observing or retaining the response. A bounded list-scoped exact-match reconciliation found a live check-in.

This proves current Hi.Events state but not safe print attribution: the client that lost its response cannot distinguish its own accepted mutation from another scanner's mutation. The result must remain `outcome_unknown`, create no automatic print intent, and require admin judgment under the settled authority model. Cleanup deleted the reconciled check-in with HTTP 204, and a final exact-match GET showed no check-in.

## DELETE/reset behavior

For a dedicated synthetic fixture:

1. POST created a check-in with HTTP 200.
2. `DELETE /check-ins/{checkInShortId}` returned HTTP 204.
3. Repeating the same DELETE returned HTTP 409.
4. Exact list-scoped reconciliation returned the attendee with no `check_in`.

### Repeatable reset procedure

1. In the authenticated organizer UI, verify list ID `3`, the exact fixture-list name, and that every associated product is hidden before touching a fixture.
2. Search the list-scoped public attendee endpoint with the synthetic attendee public ID and select only one exact `public_id` match.
3. If `check_in` is absent, the fixture is already reset.
4. If `check_in` is present, keep its `short_id` only in process memory and issue DELETE against the same verified list.
5. Accept HTTP 204 as reset. Treat HTTP 409 as already absent only after another exact reconciliation GET.
6. Confirm the exact attendee remains eligible/status-correct and has no `check_in`.

After the probes, the concurrency, lost-response, and DELETE fixtures were reset. The dedicated already-checked-in fixture intentionally remains checked in. No production attendee is part of this procedure.

## Rate-limit and `Retry-After` observations

Normal dedicated-list GET, POST, DELETE, and rejection responses consistently reported:

```text
X-RateLimit-Limit: 180
X-RateLimit-Remaining: <decrementing value>
Retry-After: <absent>
```

Observed remaining values declined from 173 through 149 during the bounded matrix. No 429 was induced, production limits were not intentionally exhausted, and deployed 429 `Retry-After` behavior therefore remains unknown. Any implementation must honor `Retry-After` when present and apply shared coordinator backpressure before the remaining budget is exhausted.

## Backend identity

Authenticated event settings exposed no image, build, version, tag, or commit field. Authenticated `GET /api/version` returned HTTP 404; the response server header identified `nginx/1.24.0`, not the Hi.Events backend build. The deployed frontend still exposes the older check-in surface documented in the related contract, but the exact backend image/tag/commit remains unknown and must not be inferred from that fingerprint.

## Deployed boundary and implementation consequence

The event's payment configuration makes `AWAITING_PAYMENT` unreachable today. Do not enable a production-visible or otherwise unused offline-payment path merely to manufacture a test state. The WTS adapter should retain a conservative fail-closed classification for an unexpected awaiting-payment attendee, while the implementation and rehearsal matrix should treat the current HTTP 403 plus disabled configuration as the authoritative deployed evidence.
