import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { publicApiDiscovery, publicApiOpenApi } from "~/lib/public-api-openapi";
import { conferenceTimeZone } from "~/lib/conference-guide-content";
import type { PublicConferenceGuideProgramme, PublicSpeakerSummary } from "~/lib/conference-public";

export interface PublicApiEvent {
  request: Request;
  clientAddress?: string;
}

interface PublicApiDependencies {
  loadProgramme: (signal: AbortSignal) => Promise<PublicConferenceGuideProgramme>;
  now?: () => number;
  trustProxy?: boolean;
  limits?: { perClient?: number; global?: number; concurrency?: number };
}

const METHODS = "GET, HEAD, OPTIONS";
const CACHE_MS = 30_000;
const WINDOW_MS = 60_000;
const REFRESH_TIMEOUT_MS = 10_000;

function publicApiResponse(request: Request, body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(
    request.method === "HEAD" || status === 204 || status === 304 ? null : JSON.stringify(body),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": METHODS,
        "Access-Control-Allow-Headers": "Accept, Content-Type, If-None-Match",
        "Access-Control-Expose-Headers": "ETag, Retry-After, Link",
        Link: '</api/public/v1/openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"',
        "X-Content-Type-Options": "nosniff",
        ...extra,
      },
    },
  );
}

function publicApiMetadata() {
  return {
    apiVersion: "1",
    ...(conferenceTimeZone ? { timeZone: conferenceTimeZone } : {}),
  };
}

/** Run before framework matchers, which may throw decoding a malformed path. */
export function publicApiPathGuard(request: Request, next: () => Promise<Response>) {
  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/public/v1/")) {
    const invalid = () => publicApiResponse(request, {
      error: { code: "invalid_slug", message: "Use a lowercase public slug." },
    }, 400);
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      return invalid();
    }
    // Consume the decoded value: the bundler removes unused pure decoding calls,
    // including their try/catch, which would silently delete this protection.
    if (Array.from(decoded).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return invalid();
  }
  return next();
}

interface Snapshot {
  programme: PublicConferenceGuideProgramme;
  expiresAt: number;
}

function speakerSummary(speaker: PublicSpeakerSummary): PublicSpeakerSummary {
  return {
    slug: speaker.slug,
    displayName: speaker.displayName,
    photoUrl: speaker.photoUrl,
    affiliation: speaker.affiliation,
    isMc: speaker.isMc === true,
    sessionCount: speaker.sessionCount,
    appearanceEvents: speaker.appearanceEvents,
  };
}

type PublicApiResource = "speakers" | "sessions" | "agenda";
type PublicApiRoute =
  | { type: "document"; openApi: boolean }
  | { type: "resource"; resource: PublicApiResource; slug?: string }
  | { type: "not_found" }
  | { type: "invalid_slug" };

function decodePublicSlug(raw: string): string | undefined {
  let slug: string;
  try {
    slug = decodeURIComponent(raw);
  } catch {
    return undefined;
  }
  return slug.length > 200 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? undefined : slug;
}

function parsePublicApiRoute(pathname: string): PublicApiRoute {
  if (/^\/api\/public\/v1\/?$/.test(pathname)) return { type: "document", openApi: false };
  if (/^\/api\/public\/v1\/openapi\.json\/?$/.test(pathname)) return { type: "document", openApi: true };
  const match = /^\/api\/public\/v1\/(speakers|sessions|agenda)(?:\/([^/]+))?\/?$/.exec(pathname);
  if (!match || (match[1] === "agenda" && match[2])) return { type: "not_found" };
  const resource = match[1] as PublicApiResource;
  if (!match[2]) return { type: "resource", resource };
  const slug = decodePublicSlug(match[2]);
  return slug === undefined ? { type: "invalid_slug" } : { type: "resource", resource, slug };
}

function entityTag(body: unknown): string {
  return `"${createHash("sha256").update(JSON.stringify(body)).digest("hex")}"`;
}

function conditionalResponse(request: Request, body: unknown, etag: string, headers: Record<string, string>) {
  const unchanged = request.headers.get("if-none-match")?.split(",")
    .some((value) => value.trim() === "*" || value.trim().replace(/^W\//, "") === etag);
  return unchanged ? publicApiResponse(request, null, 304, headers) : publicApiResponse(request, body, 200, headers);
}

function documentResponse(request: Request, openApi: boolean) {
  if (request.method === "OPTIONS") return publicApiResponse(request, null, 204, { Allow: METHODS });
  const body = openApi ? publicApiOpenApi : {
    data: publicApiDiscovery, meta: publicApiMetadata(),
  };
  const etag = entityTag(body);
  return conditionalResponse(request, body, etag, { ETag: etag, "Cache-Control": "public, max-age=300, must-revalidate" });
}

const RESOURCE_READERS: Record<PublicApiResource, (programme: PublicConferenceGuideProgramme, slug?: string) => unknown> = {
  agenda: (programme) => programme.agenda,
  speakers: (programme, slug) => slug
    ? programme.speakers.find((speaker) => speaker.slug === slug)
    : [...programme.speakers]
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "en", { sensitivity: "base" }) || a.slug.localeCompare(b.slug, "en"))
      .map(speakerSummary),
  sessions: (programme, slug) => slug
    ? programme.sessions.find((session) => session.slug === slug)
    : [...programme.sessions]
      .sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }) || a.slug.localeCompare(b.slug, "en"))
      .map((session) => ({ slug: session.slug, title: session.title, format: session.format })),
};

interface RateLimitRejection {
  message: string;
  retryAfter: string;
}

/** Anonymous HTTP adapter over the same allowlisted programme used by the site. */
export function createPublicApi(dependencies: PublicApiDependencies) {
  const now = dependencies.now ?? Date.now;
  const salt = randomBytes(32);
  const perClientLimit = dependencies.limits?.perClient ?? 600;
  const globalLimit = dependencies.limits?.global ?? 6_000;
  const concurrencyLimit = dependencies.limits?.concurrency ?? 48;
  // One bounded window per process. No raw addresses, cookies or auth state retained.
  const clients = new Map<string, number>();
  let windowEnd = 0;
  let requests = 0;
  let inFlight = 0;
  let snapshot: Snapshot | undefined;
  let loading: Promise<Snapshot> | undefined;

  async function loadSnapshot(): Promise<Snapshot> {
    if (snapshot && now() < snapshot.expiresAt) return snapshot;
    if (!loading) {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout>;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Public programme refresh timed out."));
        }, REFRESH_TIMEOUT_MS);
      });
      loading = Promise.race([
        Promise.resolve().then(() => dependencies.loadProgramme(controller.signal)),
        timeout,
      ]).then((programme) => {
        // Only the winning refresh may publish a snapshot. Late timed-out reads
        // must not repopulate the cache after a newer refresh has succeeded.
        snapshot = { programme, expiresAt: now() + CACHE_MS };
        return snapshot;
      }).finally(() => {
        clearTimeout(timer);
        controller.abort();
        loading = undefined;
      });
    }
    return loading;
  }

  function clientKey(request: Request, clientAddress: string | undefined): string | undefined {
    const forwarded = dependencies.trustProxy
      ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      : undefined;
    const address = forwarded && isIP(forwarded) ? forwarded : clientAddress;
    return address ? createHash("sha256").update(salt).update(address).digest("hex") : undefined;
  }

  function admit(timestamp: number, key: string | undefined): RateLimitRejection | undefined {
    if (timestamp >= windowEnd) {
      clients.clear();
      requests = 0;
      windowEnd = timestamp + WINDOW_MS;
    }
    const clientRequests = key ? clients.get(key) ?? 0 : 0;
    if (requests >= globalLimit || (key && clientRequests >= perClientLimit)) {
      return { message: "Too many requests. Retry later.", retryAfter: String(Math.max(1, Math.ceil((windowEnd - timestamp) / 1_000))) };
    }
    if (inFlight >= concurrencyLimit) return { message: "Public API is busy. Retry later.", retryAfter: "1" };
    requests++;
    if (key) clients.set(key, clientRequests + 1);
    inFlight++;
    return undefined;
  }

  return async ({ request, clientAddress }: PublicApiEvent): Promise<Response> => {
    const respond = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
      publicApiResponse(request, body, status, extra);
    const error = (code: string, message: string, status: number, extra: Record<string, string> = {}) =>
      respond({ error: { code, message } }, status, extra);
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      return error("method_not_allowed", "Use GET to read public conference data.", 405, { Allow: METHODS });
    }
    const route = parsePublicApiRoute(new URL(request.url).pathname);
    if (route.type === "document") return documentResponse(request, route.openApi);
    if (route.type === "not_found") return error("not_found", "Public resource not found.", 404);
    if (route.type === "invalid_slug") return error("invalid_slug", "Use a lowercase public slug.", 400);
    if (request.method === "OPTIONS") return respond(null, 204, { Allow: METHODS });

    const timestamp = now();
    const rejection = admit(timestamp, clientKey(request, clientAddress));
    if (rejection) return error("rate_limited", rejection.message, 429, { "Retry-After": rejection.retryAfter });
    try {
      const { programme, expiresAt } = await loadSnapshot();
      const data = RESOURCE_READERS[route.resource](programme, route.slug);
      if (!data) return error("not_found", "Public resource not found.", 404);
      const body = {
        data,
        meta: publicApiMetadata(),
      };
      const etag = entityTag(body);
      return conditionalResponse(request, body, etag, {
        "Cache-Control": `public, max-age=${Math.max(0, Math.floor((expiresAt - now()) / 1_000))}, must-revalidate`,
        ETag: etag,
      });
    } catch {
      return error("programme_unavailable", "Public conference data is temporarily unavailable.", 503, { "Retry-After": "5" });
    } finally {
      inFlight--;
    }
  };
}
