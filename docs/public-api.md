# Public conference JSON API (v1)

A read-only interface for workshop apps and other clients. No account, API key, PocketBase SDK, AI model, or MCP client is needed. Base URL after deployment: `https://wts.sh/api/public/v1`.

## Discovery and OpenAPI

- `GET /api/public/v1` returns the endpoint catalogue and the specification URL.
- `GET /api/public/v1/openapi.json` returns the **OpenAPI 3.1.1 document directly**, without the `data`/`meta` envelope, ready for import into OpenAPI-compatible tools.
- Public API responses advertise the specification using a `Link` header with `rel="service-desc"`; browsers can read that header through CORS.

Import `https://wts.sh/api/public/v1/openapi.json` into Postman or load it into Swagger Editor/UI to browse operations, schemas and examples. OpenAPI-compatible client generators can use the same document; individual generator/version compatibility is not guaranteed. The spec targets the existing production endpoints and does not require credentials. It distinguishes list cards from detail relationships, optional versus nullable fields, HTML-rich text, and the existing timestamp representations.

Discovery and the spec support GET/HEAD/OPTIONS, ETags and five-minute HTTP caching. They do not load PocketBase or consume the data-read budget, and remain available if programme reads fail. The spec describes the five conference-data paths; these metadata URLs are documented here and in its introduction. Examples are synthetic, not cached copies of live people or sessions. Tests validate the document with Swagger Parser and actual HTTP response bodies with JSON Schema (Ajv).

## Endpoints

| GET path | `data` |
| --- | --- |
| `/speakers` | Complete array of Published Speaker summaries, alphabetical by `displayName`, then `slug` |
| `/speakers/{slug}` | Speaker detail: summary plus `bio`, `socialHandles`, and Published `sessions` |
| `/sessions` | Complete array of Published Session cards, alphabetical by `title`, then `slug` |
| `/sessions/{slug}` | Session detail: `slug`, `title`, `abstract`, optional `format`, public `speakers`, optional `schedule` or `announcement`, and `relatedSessions` |
| `/agenda` | `{ "days": [...] }`, including Published programmes and explicitly announced weekday lineups |

All paths support `HEAD` and `OPTIONS`. Writes return `405`. There is no partners endpoint, generic collection endpoint, filter/expand facility, search, or pagination in v1. Query parameters are ignored. Unknown resources and unpublished slugs return the same `404`. Slugs are lowercase ASCII letters/numbers separated by single hyphens, at most 200 characters. A trailing slash is accepted.

```sh
curl --fail-with-body https://wts.sh/api/public/v1/speakers
curl --fail-with-body https://wts.sh/api/public/v1/agenda
# Use a slug returned by a listing for detail requests.
```

## JSON contract

Every successful conference-data GET (and the discovery catalogue) returns an ordinary JSON object (not JSON-RPC):

```json
{
  "data": [],
  "meta": { "apiVersion": "1", "timeZone": "Europe/Skopje" }
}
```

`data` is an array for listings and an object for details or agenda. An empty listing is valid. New optional fields may be added within v1; clients should ignore unknown fields. Breaking changes require a new versioned path.

### Speakers and sessions

Speaker summaries contain `slug`, `displayName`, `photoUrl` (absolute URL or null), `affiliation`, `sessionCount`, and `appearanceEvents` (objects with `name` and `compactLabel`). Speaker details additionally contain `bio`, `socialHandles` (string array), and `sessions` (Session cards).

Session cards contain `slug`, `title`, and optional `format`. A detail's `speakers` are Speaker summaries; use their slugs to request full biographies. `relatedSessions` may be empty. `bio` and `abstract` are website-authored rich text and may contain HTML; do not assume Markdown or plain text, and sanitize before rendering as HTML.

### Agenda and timing

An agenda Day has `key`, `localDate`, `title`, and `programmes`. A programme has `event`, `tracks`, and `slots`; it may also have `details` and/or `untimed` announcement information. Events contain `name`, `compactLabel`, and optional `destinationUrl`. Tracks contain `key`, `name`, and optional `locationLabel`.

Slots have `kind`, `startAt`, `endAt`, optional `track`/`locationLabel`, and either a `session`, announced `speakers`, or `title`/`summary`. Session summaries inside slots include public Speaker names and photo URLs. Shared breaks need not have a track. Day/programme/track/slot arrays follow the published programme's ordering.

A Session detail's `schedule` has `dayDate`, `dayTitle`, `event`, `startAt`, optional `endAt`, `trackName`, and `locationLabel`. `announcement` instead describes an assigned event without a confirmed individual session time: `dayDate`, `event`, optional `eventStartTime` and `locationLabel`. An event start is **not** necessarily the session start.

Dates use `YYYY-MM-DD`; local announcement times use `HH:mm` in `Europe/Skopje`. Timed instants can come from PocketBase (`2026-09-19 08:00:00.000Z`) or explicit announcements (`2026-09-15T18:00:00+02:00`). Treat these as timestamp strings, normalize the space separator to `T` if your date parser requires it, and accept both fractional and non-fractional seconds. Do not assume every session has a time, an end time, or a track. Empty `slots` with an `untimed` lineup is intentional, not an error.

## Errors, caching, and limits

Errors use `{ "error": { "code": "...", "message": "..." } }`:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_slug` | Malformed slug |
| 404 | `not_found` | Missing, unpublished, or unsupported resource |
| 405 | `method_not_allowed` | Only GET, HEAD, OPTIONS are supported |
| 429 | `rate_limited` | Request budget/concurrency exhausted; honor `Retry-After` seconds |
| 503 | `programme_unavailable` | Temporary data failure; honor `Retry-After` seconds |

The server shares a 30-second programme snapshot and coalesces simultaneous refreshes. Successful responses advertise only its remaining freshness via `Cache-Control: public, max-age=..., must-revalidate`, so downstream caches do not add another full cache window. Errors are `no-store`; expired snapshots are not served if refresh fails.

A shared refresh has a 10-second deadline. Timeout returns sanitized `503`, releases waiting request capacity, and signals cancellation to PocketBase collection reads. The next request may retry; a late result from an expired refresh cannot overwrite a newer snapshot. One disconnected client does not cancel the refresh for other waiting clients; their wait is still bounded by this deadline.

Responses include an `ETag`. Send it in `If-None-Match` to receive a bodyless `304` when unchanged. `HEAD` has the same status and headers as GET, without a body. Cache data in your app rather than refetching every row on every redraw; revalidate periodically. Concurrent publication across PocketBase collections is not a transactional export.

Limits are in-memory, per server process: 600 requests per client address per 60-second window, 6,000 requests globally per window, and 48 concurrent reads. They are separate from MCP budgets. Where the framework does not supply a client address, the global and concurrency limits still apply. Operators may set `WTS_PUBLIC_API_TRUST_PROXY=true` **only** when the trusted edge overwrites `X-Forwarded-For` and prevents direct access to the server. Forwarded headers are otherwise ignored. Multiple replicas need edge-level rate limiting for a deployment-wide budget. Addresses are salted/hashed in memory, and counters expire with each window.

Browser requests are allowed from any origin with `Access-Control-Allow-Origin: *`, without credentialed CORS. Send no cookies or Authorization header; the interface does not use either and never upgrades its responses for an authenticated caller. Swift networking is not subject to browser CORS.

## Swift example

Copy this into an iOS app using Swift concurrency (`URLSession.data(for:)`, iOS 15+). It decodes the listing and handles non-success responses rather than treating them as empty lists.

```swift
import Foundation

struct APIEnvelope<Value: Decodable>: Decodable {
    let data: Value
}

struct Speaker: Decodable, Identifiable {
    let slug: String
    let displayName: String
    let affiliation: String
    let photoUrl: URL?
    let sessionCount: Int
    var id: String { slug }
}

struct APIErrorEnvelope: Decodable {
    struct Detail: Decodable {
        let code: String
        let message: String
    }
    let error: Detail
}

enum ConferenceAPIError: Error {
    case invalidResponse
    case server(status: Int, message: String, retryAfterSeconds: Int?)
}

func loadSpeakers() async throws -> [Speaker] {
    let url = URL(string: "https://wts.sh/api/public/v1/speakers")!
    var request = URLRequest(url: url)
    request.timeoutInterval = 20
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse else {
        throw ConferenceAPIError.invalidResponse
    }
    guard (200..<300).contains(http.statusCode) else {
        let detail = try? JSONDecoder().decode(APIErrorEnvelope.self, from: data)
        throw ConferenceAPIError.server(
            status: http.statusCode,
            message: detail?.error.message ?? "Request failed",
            retryAfterSeconds: http.value(forHTTPHeaderField: "Retry-After").flatMap(Int.init)
        )
    }
    return try JSONDecoder().decode(APIEnvelope<[Speaker]>.self, from: data).data
}
```

Use `AsyncImage(url: speaker.photoUrl)` for a photo and `/speakers/{slug}` for detail. Keep network calls outside view body recomputation; handle loading, failure, and retry in the app. This example intentionally relies on URLSession's normal HTTP cache rather than implementing manual ETag storage.

## Maintenance and verification

The HTTP adapter is `src/lib/public-api.ts`, registered by `src/routes/api/public/v1/[...path].ts`. It consumes `loadPublicConferenceGuideProgramme()` and its explicit public-field mappings. PocketBase collection permissions remain locked; this is not anonymous database access. Internal user/applicant relations, origin, CFP/review fields, unpublished records, partner records, and operational data are not part of the contract.

`src/lib/public-api-plugin.ts` is registered in Nitro's `vite.config.ts` options. It rejects malformed percent encodings in this namespace before H3 constructs its request event; app middleware is too late for that validation. Keep the built-server malformed-path regression test: the bundler can discard an unused decoding call even inside a try/catch, so the guard also consumes the decoded value to reject control characters.

Run `pnpm test` for the retained HTTP/privacy/cache tests, `pnpm typecheck`, and `pnpm check`. Run `pnpm build && pnpm test:public-api-smoke` to exercise the actual built HTTP routes against disposable local PocketBase data. The smoke test never reads project dotenv files or touches production data. Its fixture is synthetic, not a production dataset or deployment check.
