import type { OpenAPIV3_1 } from "openapi-types";
import type { PublicSessionDetail, PublicSpeakerDetail } from "~/lib/conference-public";

type Schema = OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject;
const ref = (name: string): OpenAPIV3_1.ReferenceObject => ({ $ref: `#/components/schemas/${name}` });
const text = (description?: string): { type: "string"; description?: string } => ({ type: "string", ...(description ? { description } : {}) });
const array = (items: Schema): Schema => ({ type: "array", items });
const object = (properties: Record<string, Schema>, required: string[]): OpenAPIV3_1.SchemaObject => ({
  type: "object", properties, required, additionalProperties: false,
});

const sessionCard = { slug: ref("Slug"), title: text(), format: text("Public session format, for example talk or workshop.") };
const speakerSummary = {
  slug: ref("Slug"), displayName: text(), photoUrl: { type: ["string", "null"], format: "uri" } satisfies Schema,
  affiliation: text(), sessionCount: { type: "integer", minimum: 0 } satisfies Schema,
  appearanceEvents: array(ref("AppearanceEvent")),
};
const speakerRequired = ["slug", "displayName", "photoUrl", "affiliation", "sessionCount", "appearanceEvents"];
const programmeDetails = {
  summary: text(), access: text(), cta: ref("CallToAction"), unassignedSpeakers: array(ref("AgendaSpeaker")),
};

const schemas: Record<string, Schema> = {
  Slug: {
    type: "string", minLength: 1, maxLength: 200, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    description: "Public identifier, not a PocketBase ID. Use a speaker slug at /speakers/{slug} and a session slug at /sessions/{slug}.",
  },
  LocalDate: { type: "string", format: "date", description: "Calendar date in Europe/Skopje (YYYY-MM-DD)." },
  LocalTime: { type: "string", pattern: "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$", description: "Local Europe/Skopje time (HH:mm), not an instant." },
  Timestamp: {
    type: "string",
    pattern: "^\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
    description: "Instant with offset. Existing v1 accepts both PocketBase's space separator and ISO T, with optional fractional seconds. Normalize the space to T before strict ISO parsing. Intentionally not declared format: date-time because v1 also emits PocketBase timestamps.",
    examples: ["2026-09-19 08:00:00.000Z", "2026-09-15T18:00:00+02:00"],
  },
  Metadata: object({ apiVersion: { type: "string", enum: ["1"] }, timeZone: { type: "string", enum: ["Europe/Skopje"] } }, ["apiVersion", "timeZone"]),
  AppearanceEvent: object({ name: text(), compactLabel: text() }, ["name", "compactLabel"]),
  AgendaEvent: object({ name: text(), compactLabel: text(), destinationUrl: text("Optional event destination URL.") }, ["name", "compactLabel"]),
  SpeakerSummary: object(speakerSummary, speakerRequired),
  SpeakerDetail: object({
    ...speakerSummary,
    bio: text("Website-authored rich text, which may contain HTML. Sanitize before rendering HTML."),
    socialHandles: array(text("A public social link or handle; not guaranteed to be a URL.")),
    sessions: array(ref("SessionCard")),
  }, [...speakerRequired, "bio", "socialHandles", "sessions"]),
  SessionCard: object(sessionCard, ["slug", "title"]),
  SessionDetail: object({
    ...sessionCard,
    abstract: text("Website-authored rich text, which may contain HTML. Sanitize before rendering HTML."),
    speakers: array(ref("SpeakerSummary")), schedule: ref("SessionSchedule"), announcement: ref("SessionAnnouncement"),
    relatedSessions: array(ref("SessionCard")),
  }, ["slug", "title", "abstract", "speakers", "relatedSessions"]),
  SessionSchedule: object({
    dayDate: ref("LocalDate"), dayTitle: text(), event: ref("AgendaEvent"), startAt: ref("Timestamp"), endAt: ref("Timestamp"),
    trackName: text(), locationLabel: text(),
  }, ["dayDate", "dayTitle", "event", "startAt"]),
  SessionAnnouncement: object({
    dayDate: ref("LocalDate"), event: ref("AgendaEvent"),
    eventStartTime: { ...text(), description: "Event start, NOT necessarily this session's start.", pattern: "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$" },
    locationLabel: text(),
  }, ["dayDate", "event"]),
  AgendaSpeaker: object({ slug: ref("Slug"), name: text(), photoUrl: { type: ["string", "null"], format: "uri" } }, ["slug", "name"]),
  AgendaSession: object({ ...sessionCard, schedule: ref("SessionSchedule"), speakers: array(ref("AgendaSpeaker")) }, ["slug", "title", "speakers"]),
  AgendaTrack: object({ key: text(), name: text(), locationLabel: text() }, ["key", "name"]),
  AgendaSlot: object({
    kind: { type: "string", enum: ["session", "break", "meal", "networking", "opening", "closing", "other"] },
    startAt: ref("Timestamp"), endAt: ref("Timestamp"), locationLabel: text(), track: ref("AgendaTrack"),
    session: ref("AgendaSession"), speakers: array(ref("AgendaSpeaker")), title: text(), summary: text(),
  }, ["kind", "startAt", "endAt"]),
  CallToAction: object({ label: text(), href: text("A URL or site-relative path.") }, ["label", "href"]),
  ProgrammeDetails: object(programmeDetails, ["summary"]),
  UntimedProgramme: object({
    ...programmeDetails, startTime: ref("LocalTime"), endTime: ref("LocalTime"), title: text(), locationLabel: text(),
    speakers: array(ref("AgendaSpeaker")), sessions: array(ref("AgendaSession")), highlights: array(text()),
  }, ["summary", "sessions"]),
  EventProgramme: object({
    event: ref("AgendaEvent"), tracks: array(ref("AgendaTrack")), slots: array(ref("AgendaSlot")),
    details: ref("ProgrammeDetails"), untimed: ref("UntimedProgramme"),
  }, ["event", "tracks", "slots"]),
  AgendaDay: object({ key: text(), localDate: ref("LocalDate"), title: text(), programmes: array(ref("EventProgramme")) }, ["key", "localDate", "title", "programmes"]),
  Agenda: object({ days: array(ref("AgendaDay")) }, ["days"]),
  Error: object({ error: object({
    code: { type: "string", enum: ["invalid_slug", "not_found", "method_not_allowed", "rate_limited", "programme_unavailable"] },
    message: text(),
  }, ["code", "message"]) }, ["error"]),
};
for (const [name, data] of Object.entries({
  SpeakerListResponse: array(ref("SpeakerSummary")), SpeakerResponse: ref("SpeakerDetail"),
  SessionListResponse: array(ref("SessionCard")), SessionResponse: ref("SessionDetail"), AgendaResponse: ref("Agenda"),
})) {
  schemas[name] = object({ data, meta: ref("Metadata") }, ["data", "meta"]);
}

// Synthetic, internally consistent examples. No live data is copied into the spec.
const exampleSpeaker: PublicSpeakerDetail = {
  slug: "ada-example", displayName: "Ada Example", affiliation: "Example Labs", photoUrl: null,
  sessionCount: 1, appearanceEvents: [{ name: "WhatTheStack 2026", compactLabel: "WTS 2026" }],
  bio: "<p>A synthetic speaker biography.</p>", socialHandles: ["https://example.com/ada"],
  sessions: [{ slug: "building-reliable-apps", title: "Building Reliable Apps", format: "talk" }],
};
const { bio: _bio, socialHandles: _socialHandles, sessions: _sessions, ...exampleSummary } = exampleSpeaker;
const exampleSession: PublicSessionDetail = {
  slug: "building-reliable-apps", title: "Building Reliable Apps", format: "talk",
  abstract: "<p>A synthetic session abstract.</p>", speakers: [exampleSummary], relatedSessions: [],
  schedule: {
    dayDate: "2026-09-19", dayTitle: "Conference day", event: { name: "WhatTheStack 2026", compactLabel: "WTS 2026" },
    startAt: "2026-09-19 08:00:00.000Z", endAt: "2026-09-19 08:35:00.000Z", trackName: "Stage 1",
  },
};
const envelope = (data: unknown) => ({ data, meta: { apiVersion: "1", timeZone: "Europe/Skopje" } });
const commonHeaders: Record<string, OpenAPIV3_1.HeaderObject> = {
  Link: { description: "Link to the OpenAPI document, rel=service-desc.", schema: text() },
  "Access-Control-Allow-Origin": { schema: { type: "string", enum: ["*"] } },
};
const cacheHeaders: Record<string, OpenAPIV3_1.HeaderObject> = {
  ...commonHeaders,
  ETag: { description: "Representation validator for If-None-Match.", schema: text() },
  "Cache-Control": { description: "public, max-age=<remaining snapshot seconds>, must-revalidate; at most 30 seconds.", schema: text() },
};
interface ReadResponse {
  description: string;
  headers: Record<string, OpenAPIV3_1.HeaderObject>;
  content?: { "application/json": { schema: OpenAPIV3_1.ReferenceObject; example?: unknown } };
}

const errorResponse = (description: string, retry = false): ReadResponse => ({
  description, content: { "application/json": { schema: ref("Error") } },
  headers: { ...commonHeaders, "Cache-Control": { schema: { type: "string", enum: ["no-store"] } },
    ...(retry ? { "Retry-After": { description: "Wait this many seconds before retrying.", schema: { type: "integer", minimum: 1 } satisfies Schema } } : {}),
  },
});

// Paths use only shared 3.0/3.1 vocabulary and schema references. This also avoids
// openapi-types' 3.1 PathItem intersection retaining the old response type.
function readPath(operationId: string, summary: string, schema: string, description: string, example: unknown, detail = false): OpenAPIV3_1.PathItemObject {
  const responses: Record<string, ReadResponse> = {
    "200": { description: "Published public data.", headers: cacheHeaders, content: { "application/json": { schema: ref(schema), example: envelope(example) } } },
    "304": { description: "Unchanged representation; no response body.", headers: cacheHeaders },
    ...(detail ? { "400": errorResponse("Malformed slug."), "404": errorResponse("Missing or unpublished record (indistinguishable).") } : {}),
    "405": errorResponse("Unsupported method. Only GET, HEAD and OPTIONS are allowed."),
    "429": errorResponse("Per-client, global or concurrency budget exhausted.", true),
    "503": errorResponse("Programme refresh failed or exceeded its 10-second deadline.", true),
  };
  return {
    parameters: [
      ...(detail ? [{ name: "slug", in: "path", required: true, schema: ref("Slug"), description: "Use a slug returned by the corresponding listing." } satisfies OpenAPIV3_1.ParameterObject] : []),
      { name: "If-None-Match", in: "header", required: false, schema: text(), description: "ETag from an earlier response. Matching validators return 304." },
    ],
    get: { operationId, summary, description, tags: [operationId.toLowerCase().includes("speaker") ? "Speakers" : operationId.toLowerCase().includes("session") ? "Sessions" : "Agenda"], responses },
    head: { operationId: `${operationId}Headers`, summary: `${summary} (headers only)`, responses: Object.fromEntries(Object.entries(responses).map(([status, response]) => {
      return [status, { description: response.description, headers: response.headers }];
    })) },
    options: { operationId: `${operationId}Options`, summary: "Read-only CORS preflight", responses: {
      "204": { description: "No body; no database access. Does not establish that a slug exists.", headers: {
        ...commonHeaders, "Access-Control-Allow-Methods": { schema: { type: "string", enum: ["GET, HEAD, OPTIONS"] } },
        "Access-Control-Allow-Headers": { schema: text() },
      } },
      ...(detail ? { "400": errorResponse("Malformed slug.") } : {}),
    } },
  };
}

export const publicApiOpenApi: OpenAPIV3_1.Document = {
  openapi: "3.1.1",
  info: {
    title: "WhatTheStack Public Conference API", version: "1.0.0",
    description: "Anonymous, read-only Published conference data. No account, API key, MCP client or AI model is required. List endpoints are complete (no pagination/filter/expand); relationships are embedded in detail responses and use public slugs, not database IDs. Query parameters are ignored. No partners or private/operational records are exposed. Optional fields may be omitted; rich text may contain HTML. Examples are synthetic. Cache for at most 30 seconds and honor Retry-After. Per process: 600 reads/client/minute when client identity is available, 6000 globally/minute, 48 concurrent reads. Forwarded client identity is accepted only with an explicitly trusted proxy. Metadata discovery is available at /api/public/v1 and this document at /api/public/v1/openapi.json, independently of PocketBase.",
  },
  servers: [{ url: "https://wts.sh/api/public/v1", description: "Production" }],
  security: [],
  externalDocs: { description: "Usage notes and a Swift URLSession example", url: "https://github.com/WhatTheStackConf/wts/blob/master/docs/public-api.md" },
  tags: [{ name: "Speakers" }, { name: "Sessions" }, { name: "Agenda" }],
  paths: {
    "/speakers": readPath("listSpeakers", "List published speakers", "SpeakerListResponse", "Alphabetical by displayName, then slug. Includes sessionCount, not session arrays; request a speaker detail for their sessions.", [exampleSummary]),
    "/speakers/{slug}": readPath("getSpeaker", "Get a speaker and their sessions", "SpeakerResponse", "Includes bio, social handles and published Session cards. Follow each sessions[].slug with GET /sessions/{slug}.", exampleSpeaker, true),
    "/sessions": readPath("listSessions", "List published sessions", "SessionListResponse", "Alphabetical by title, then slug. Cards do not include speakers; request session detail or agenda for speaker names.", exampleSpeaker.sessions),
    "/sessions/{slug}": readPath("getSession", "Get a session and its speakers", "SessionResponse", "Includes public speaker summaries; follow speakers[].slug with GET /speakers/{slug}. Schedule and end time are optional. An announcement's eventStartTime is not necessarily the session start.", exampleSession, true),
    "/agenda": readPath("getAgenda", "Get the published conference agenda", "AgendaResponse", "Ordered days, programmes, tracks, slots and announced lineups. Empty slots with an untimed lineup is intentional. Times use Europe/Skopje. Agenda speakers use name, whereas profile summaries use displayName.", {
      days: [{ key: "conference-day", localDate: "2026-09-19", title: "Conference day", programmes: [{
        event: { name: "WhatTheStack 2026", compactLabel: "WTS 2026" }, tracks: [{ key: "stage-1", name: "Stage 1" }],
        slots: [{ kind: "session", startAt: "2026-09-19 08:00:00.000Z", endAt: "2026-09-19 08:35:00.000Z", track: { key: "stage-1", name: "Stage 1" },
          session: { ...exampleSpeaker.sessions[0], speakers: [{ slug: "ada-example", name: "Ada Example", photoUrl: null }] } }],
      }] }],
    }),
  },
  components: { schemas },
};

export const publicApiDiscovery = {
  name: "WhatTheStack Public Conference API",
  openapi: "/api/public/v1/openapi.json",
  endpoints: Object.keys(publicApiOpenApi.paths ?? {}).map((path) => ({ method: "GET", path: `/api/public/v1${path}` })),
};
