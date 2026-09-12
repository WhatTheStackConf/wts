import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { publicApiDiscovery, publicApiOpenApi } from "~/lib/public-api-openapi";
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

  return async ({ request, clientAddress }: PublicApiEvent): Promise<Response> => {
    const respond = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
      publicApiResponse(request, body, status, extra);
    const error = (code: string, message: string, status: number, extra: Record<string, string> = {}) =>
      respond({ error: { code, message } }, status, extra);
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      return error("method_not_allowed", "Use GET to read public conference data.", 405, { Allow: METHODS });
    }
    const url = new URL(request.url);
    const isDiscovery = /^\/api\/public\/v1\/?$/.test(url.pathname);
    const isOpenApi = /^\/api\/public\/v1\/openapi\.json\/?$/.test(url.pathname);
    if (isDiscovery || isOpenApi) {
      if (request.method === "OPTIONS") return respond(null, 204, { Allow: METHODS });
      const body = isOpenApi ? publicApiOpenApi : {
        data: publicApiDiscovery, meta: { apiVersion: "1", timeZone: "Europe/Skopje" },
      };
      const etag = `"${createHash("sha256").update(JSON.stringify(body)).digest("hex")}"`;
      const headers = { ETag: etag, "Cache-Control": "public, max-age=300, must-revalidate" };
      const unchanged = request.headers.get("if-none-match")?.split(",")
        .some((value) => value.trim() === "*" || value.trim().replace(/^W\//, "") === etag);
      return unchanged ? respond(null, 304, headers) : respond(body, 200, headers);
    }
    const match = /^\/api\/public\/v1\/(speakers|sessions|agenda)(?:\/([^/]+))?\/?$/.exec(url.pathname);
    if (!match || (match[1] === "agenda" && match[2])) {
      return error("not_found", "Public resource not found.", 404);
    }
    let slug: string | undefined;
    if (match[2]) {
      try {
        slug = decodeURIComponent(match[2]);
      } catch {
        return error("invalid_slug", "Use a lowercase public slug.", 400);
      }
      if (slug.length > 200 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        return error("invalid_slug", "Use a lowercase public slug.", 400);
      }
    }
    if (request.method === "OPTIONS") return respond(null, 204, { Allow: METHODS });

    const timestamp = now();
    if (timestamp >= windowEnd) {
      clients.clear();
      requests = 0;
      windowEnd = timestamp + WINDOW_MS;
    }
    const forwarded = dependencies.trustProxy
      ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      : undefined;
    const address = forwarded && isIP(forwarded) ? forwarded : clientAddress;
    const key = address ? createHash("sha256").update(salt).update(address).digest("hex") : undefined;
    const clientRequests = key ? clients.get(key) ?? 0 : 0;
    if (requests >= globalLimit || (key && clientRequests >= perClientLimit)) {
      return error("rate_limited", "Too many requests. Retry later.", 429, {
        "Retry-After": String(Math.max(1, Math.ceil((windowEnd - timestamp) / 1_000))),
      });
    }
    if (inFlight >= concurrencyLimit) {
      return error("rate_limited", "Public API is busy. Retry later.", 429, { "Retry-After": "1" });
    }
    requests++;
    if (key) clients.set(key, clientRequests + 1);
    inFlight++;
    try {
      const { programme, expiresAt } = await loadSnapshot();
      let data: unknown;
      if (match[1] === "agenda") {
        data = programme.agenda;
      } else if (match[1] === "speakers") {
        data = slug
          ? programme.speakers.find((speaker) => speaker.slug === slug)
          : [...programme.speakers]
            .sort((a, b) => a.displayName.localeCompare(b.displayName, "en", { sensitivity: "base" }) || a.slug.localeCompare(b.slug, "en"))
            .map(speakerSummary);
      } else {
        data = slug
          ? programme.sessions.find((session) => session.slug === slug)
          : [...programme.sessions]
            .sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }) || a.slug.localeCompare(b.slug, "en"))
            .map((session) => ({ slug: session.slug, title: session.title, format: session.format }));
      }
      if (!data) return error("not_found", "Public resource not found.", 404);
      const body = {
        data,
        meta: { apiVersion: "1", timeZone: "Europe/Skopje" },
      };
      const etag = `"${createHash("sha256").update(JSON.stringify(body)).digest("hex")}"`;
      const headers = {
        "Cache-Control": `public, max-age=${Math.max(0, Math.floor((expiresAt - now()) / 1_000))}, must-revalidate`,
        ETag: etag,
      };
      const unchanged = request.headers.get("if-none-match")?.split(",")
        .some((value) => value.trim() === "*" || value.trim().replace(/^W\//, "") === etag);
      return unchanged ? respond(null, 304, headers) : respond(body, 200, headers);
    } catch {
      return error("programme_unavailable", "Public conference data is temporarily unavailable.", 503, { "Retry-After": "5" });
    } finally {
      inFlight--;
    }
  };
}
