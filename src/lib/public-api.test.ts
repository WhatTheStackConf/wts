import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fetchAllRecords = vi.hoisted(() => vi.fn());
vi.mock("~/lib/pocketbase-admin-service", () => ({
  getAdminPB: () => ({ fetchAllRecords }),
}));

import { loadPublicConferenceGuideProgramme } from "~/lib/conference-public";
import { createPublicApi, publicApiPathGuard } from "~/lib/public-api";
import * as route from "~/routes/api/public/v1/[...path]";

const root = "https://wts.sh/api/public/v1/";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

// Synthetic database records, including private fields that must never cross HTTP.
function records() {
  const ada = {
    id: "ada-id", collectionName: "speakers", slug: "ada", display_name: "Ada", affiliation: "Engines",
    bio: "Public biography", social_handles: ["https://example.com/ada"],
    photo: "ada.png", published: true, appearance_events: ["event"],
    email: "PRIVATE_EMAIL", user: "PRIVATE_USER", cfp_applicant: "PRIVATE_APPLICANT",
    origin: "PRIVATE_ORIGIN", promo: { statusMessage: "PRIVATE_PROMO" },
  };
  const hidden = { ...ada, id: "hidden-id", slug: "draft-speaker", display_name: "PRIVATE_SPEAKER", published: false };
  const session = {
    id: "session", slug: "engines", title: "Engines", abstract: "Public abstract", format: "talk",
    published: true, speakers: [ada.id, hidden.id],
    expand: { speakers: [ada, hidden] }, review_notes: "PRIVATE_REVIEW", key_takeaways: "PRIVATE_TAKEAWAYS",
  };
  return {
    speakers: [{ ...ada, id: "zoe-id", slug: "zoe", display_name: "Zoe" }, hidden, ada],
    sessions: [session, { ...session, id: "draft-session", slug: "draft-session", title: "PRIVATE_SESSION", published: false }],
    conference_days: [{ id: "day", key: "main", local_date: "2026-09-19", title: "Main day", published: true }],
    appearance_events: [{ id: "event", name: "WhatTheStack 2026", compact_label: "WTS", published: true }],
    event_programmes: [{ id: "programme", day: "day", appearance_event: "event" }],
    agenda_tracks: [{ id: "track", programme: "programme", key: "stage-1", name: "Stage 1" }],
    agenda_slots: [{ id: "slot", programme: "programme", track: "track", session: "session", kind: "session", published: true, start_at: "2026-09-19T08:00:00Z", end_at: "2026-09-19T08:35:00Z" }],
  };
}

beforeEach(() => {
  vi.stubEnv("PUBLIC_POCKETBASE_URL", "https://pb.example");
  const data = records();
  fetchAllRecords.mockReset();
  fetchAllRecords.mockImplementation(async (collection: keyof typeof data, options?: { filter?: string }) => {
    const rows = data[collection] || [];
    return options?.filter === "published = true"
      ? rows.filter((row) => !("published" in row) || row.published)
      : rows;
  });
});

describe("public JSON interface", () => {
  it("rejects malformed encodings before routing without intercepting unrelated requests", async () => {
    const next = vi.fn(async () => new Response("downstream"));
    for (const slug of ["%ZZ", "%C0%AF", "%00"]) {
      const response = await publicApiPathGuard(new Request(`${root}sessions/${slug}`), next);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("invalid_slug");
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    }
    expect(next).not.toHaveBeenCalled();
    expect(await (await publicApiPathGuard(new Request(`${root}speakers/ada`), next)).text()).toBe("downstream");
    expect(await (await publicApiPathGuard(new Request("https://wts.sh/api/other/%ZZ"), next)).text()).toBe("downstream");
  });

  it("serves session lists, both detail resources and the agenda, never draft relations", async () => {
    const api = createPublicApi({ loadProgramme: loadPublicConferenceGuideProgramme });
    const read = async (path: string) => {
      const response = await api({ request: new Request(`${root}${path}`) });
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).not.toContain("PRIVATE_");
      expect(text).not.toContain("draft-speaker");
      expect(text).not.toContain("draft-session");
      return JSON.parse(text).data;
    };
    expect(await read("sessions")).toEqual([{ slug: "engines", title: "Engines", format: "talk" }]);
    expect(await read("speakers/ada")).toMatchObject({
      slug: "ada", bio: "Public biography", socialHandles: ["https://example.com/ada"],
      photoUrl: "https://pb.example/api/files/speakers/ada-id/ada.png",
      appearanceEvents: [{ name: "WhatTheStack 2026", compactLabel: "WTS" }],
      sessions: [{ slug: "engines", title: "Engines" }],
    });
    expect(await read("sessions/engines")).toMatchObject({
      slug: "engines", abstract: "Public abstract", speakers: [{ slug: "ada", sessionCount: 1 }],
      schedule: { startAt: "2026-09-19T08:00:00Z", endAt: "2026-09-19T08:35:00Z" },
    });
    const agenda = await read("agenda");
    expect(agenda.days[0].programmes[0].slots[0]).toMatchObject({
      track: { key: "stage-1" }, session: { slug: "engines", speakers: [{ slug: "ada" }] },
    });
  });

  it("keeps event-only announcements on session details without inventing a talk time", async () => {
    const data = records();
    data.sessions[0].slug = "building-a-distributed-multi-agent-system";
    data.appearance_events[0].name = "DevFest";
    data.agenda_slots = [];
    fetchAllRecords.mockImplementation(async (collection: keyof typeof data, options?: { filter?: string }) => {
      const rows = data[collection] || [];
      return options?.filter === "published = true"
        ? rows.filter((row) => !("published" in row) || row.published)
        : rows;
    });
    const api = createPublicApi({ loadProgramme: loadPublicConferenceGuideProgramme });
    const response = await api({ request: new Request(`${root}sessions/building-a-distributed-multi-agent-system`) });
    const { data: session } = await response.json();
    expect(session.schedule).toBeUndefined();
    expect(session.announcement).toMatchObject({ dayDate: "2026-09-16", eventStartTime: "17:00" });
  });

  it("has predictable JSON errors, rejects writes and does not expose partners", async () => {
    const api = createPublicApi({ loadProgramme: loadPublicConferenceGuideProgramme });
    for (const path of ["partners", "speakers/draft-speaker", "sessions/draft-session", "speakers/absent", "sessions/a/extra"]) {
      const response = await api({ request: new Request(`${root}${path}`) });
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    for (const path of ["speakers/UPPERCASE", "sessions/%ZZ", "speakers/a%2Fb", `sessions/${"a".repeat(201)}`]) {
      const response = await api({ request: new Request(`${root}${path}`) });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "invalid_slug" } });
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await api({ request: new Request(`${root}speakers`, { method }) });
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("GET, HEAD, OPTIONS");
    }
  });

  it("supports credential-free browser CORS and bodyless HEAD/preflight responses", async () => {
    const api = createPublicApi({ loadProgramme: loadPublicConferenceGuideProgramme });
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      const response = await api({ request: new Request(`${root}speakers`, {
        method, headers: { Origin: "https://workshop.example" },
      }) });
      expect(response.status).toBe(method === "OPTIONS" ? 204 : 200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.has("Access-Control-Allow-Credentials")).toBe(false);
      if (method !== "GET") expect(await response.text()).toBe("");
    }
  });

  it.each(["conference_days", "appearance_events", "agenda_slots", "sessions"] as const)(
    "hides agenda relations when their %s record is unpublished", async (collection) => {
      const data = records();
      data[collection][0].published = false;
      fetchAllRecords.mockImplementation(async (name: keyof typeof data, options?: { filter?: string }) => {
        const rows = data[name] || [];
        return options?.filter === "published = true"
          ? rows.filter((row) => !("published" in row) || row.published)
          : rows;
      });
      const api = createPublicApi({ loadProgramme: loadPublicConferenceGuideProgramme });
      const response = await api({ request: new Request(`${root}agenda`) });
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).not.toContain("engines");
      expect(text).not.toContain("Stage 1");
      expect(text).not.toContain("PRIVATE_");
    },
  );

  it("uses slug tie-breaks for equal public names and titles", async () => {
    const data = records();
    data.speakers[0].display_name = "Ada";
    fetchAllRecords.mockImplementation(async (name: keyof typeof data, options?: { filter?: string }) => {
      const rows = data[name] || [];
      return options?.filter === "published = true"
        ? rows.filter((row) => !("published" in row) || row.published)
        : rows;
    });
    const api = createPublicApi({ loadProgramme: loadPublicConferenceGuideProgramme });
    const response = await api({ request: new Request(`${root}speakers`) });
    expect((await response.json()).data.map((speaker: { slug: string }) => speaker.slug)).toEqual(["ada", "zoe"]);
  });

  it("wires the actual route exports and ignores auth, filter and expansion attempts", async () => {
    const response = await route.GET({ request: new Request(`${root}speakers?filter=published=false&expand=user`, {
      headers: { Authorization: "Bearer synthetic-invalid", Cookie: "pb_auth=synthetic-invalid" },
    }) });
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("PRIVATE_");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      expect((await route[method]({ request: new Request(`${root}agenda`, { method }) })).status).toBe(405);
    }
    expect((await route.HEAD({ request: new Request(`${root}agenda`, { method: "HEAD" }) })).status).toBe(200);
    expect((await route.OPTIONS({ request: new Request(`${root}agenda`, { method: "OPTIONS" }) })).status).toBe(204);
  });

  it("coalesces cold reads, revalidates with ETags and stops serving unpublished data after expiry", async () => {
    let now = 0;
    const programme = await loadPublicConferenceGuideProgramme();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const loadProgramme = vi.fn(async () => { await gate; return programme; });
    const api = createPublicApi({ loadProgramme, now: () => now });
    const first = api({ request: new Request(`${root}speakers`) });
    const concurrent = api({ request: new Request(`${root}sessions`) });
    release();
    const [response] = await Promise.all([first, concurrent]);
    expect(loadProgramme).toHaveBeenCalledTimes(1);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=30, must-revalidate");
    const etag = response.headers.get("ETag")!;
    expect(etag).toMatch(/^"[a-f0-9]+"$/);
    now = 10_000;
    const unchanged = await api({ request: new Request(`${root}speakers`, { headers: { "If-None-Match": `W/${etag}` } }) });
    expect(unchanged.status).toBe(304);
    expect(await unchanged.text()).toBe("");
    expect(unchanged.headers.get("Cache-Control")).toBe("public, max-age=20, must-revalidate");
    now = 30_001;
    loadProgramme.mockResolvedValue({ ...programme, speakers: [] });
    const removed = await api({ request: new Request(`${root}speakers/ada`) });
    expect(removed.status).toBe(404);
    expect(loadProgramme).toHaveBeenCalledTimes(2);
  });

  it("returns a sanitized retryable error on load failure and recovers without stale fallback", async () => {
    let now = 0;
    const programme = await loadPublicConferenceGuideProgramme();
    const loadProgramme = vi.fn().mockResolvedValueOnce(programme).mockRejectedValueOnce(new Error("PRIVATE_PASSWORD"))
      .mockResolvedValue(programme);
    const api = createPublicApi({ loadProgramme, now: () => now });
    expect((await api({ request: new Request(`${root}agenda`) })).status).toBe(200);
    now = 31_000;
    const failed = await api({ request: new Request(`${root}agenda`) });
    expect(failed.status).toBe(503);
    expect(failed.headers.get("Retry-After")).toBe("5");
    expect(failed.headers.get("Cache-Control")).toBe("no-store");
    expect(await failed.text()).not.toContain("PRIVATE_PASSWORD");
    expect((await api({ request: new Request(`${root}agenda`) })).status).toBe(200);
  });

  it("rate limits per client and globally, expires windows and ignores untrusted forwarding headers", async () => {
    let now = 0;
    const api = createPublicApi({ loadProgramme: loadPublicConferenceGuideProgramme, now: () => now,
      limits: { perClient: 2, global: 4 } });
    const read = (clientAddress?: string, forwarded = "198.51.100.99") => api({
      clientAddress, request: new Request(`${root}speakers`, { headers: { "X-Forwarded-For": forwarded } }),
    });
    expect((await read("198.51.100.1")).status).toBe(200);
    expect((await read("198.51.100.1")).status).toBe(200);
    const limited = await read("198.51.100.1", "198.51.100.100");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(limited.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect((await read("198.51.100.2")).status).toBe(200);
    expect((await read()).status).toBe(200);
    expect((await read("198.51.100.3")).status).toBe(429);
    now = 60_000;
    expect((await read("198.51.100.1")).status).toBe(200);
  });

  it("bounds a stalled refresh, aborts upstream reads and ignores late results after recovery", async () => {
    const programme = await loadPublicConferenceGuideProgramme();
    vi.useFakeTimers();
    let finish!: (value: typeof programme) => void;
    const stalled = new Promise<typeof programme>((resolve) => { finish = resolve; });
    let signal: AbortSignal | undefined;
    const loadProgramme = vi.fn((input: AbortSignal) => {
      signal = input;
      return stalled;
    }).mockImplementationOnce((input: AbortSignal) => {
      signal = input;
      return stalled;
    });
    const api = createPublicApi({ loadProgramme, limits: { concurrency: 2 } });
    const pending = api({ request: new Request(`${root}speakers`) });
    const shared = api({ request: new Request(`${root}agenda`) });
    await vi.advanceTimersByTimeAsync(10_000);
    for (const response of await Promise.all([pending, shared])) {
      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("5");
    }
    expect(signal?.aborted).toBe(true);
    expect(loadProgramme).toHaveBeenCalledTimes(1);
    loadProgramme.mockResolvedValue({ ...programme, speakers: [] });
    expect((await api({ request: new Request(`${root}speakers/ada`) })).status).toBe(404);
    finish(programme);
    await vi.advanceTimersByTimeAsync(0);
    expect((await api({ request: new Request(`${root}speakers/ada`) })).status).toBe(404);
    expect(loadProgramme).toHaveBeenCalledTimes(2);
  });

  it("uses forwarded client addresses only when explicitly enabled for a trusted proxy", async () => {
    const api = createPublicApi({ loadProgramme: loadPublicConferenceGuideProgramme, trustProxy: true,
      limits: { perClient: 1 } });
    const read = (address: string) => api({ request: new Request(`${root}speakers`, {
      headers: { "X-Forwarded-For": `${address}, 10.0.0.1` },
    }) });
    expect((await read("198.51.100.1")).status).toBe(200);
    expect((await read("198.51.100.1")).status).toBe(429);
    expect((await read("198.51.100.2")).status).toBe(200);
  });

  it("bounds concurrent reads and releases capacity after failure", async () => {
    let reject!: (error: Error) => void;
    const gate = new Promise<never>((_, fail) => { reject = fail; });
    const loadProgramme = vi.fn().mockReturnValueOnce(gate).mockImplementation(loadPublicConferenceGuideProgramme);
    const api = createPublicApi({ loadProgramme, limits: { concurrency: 1 } });
    const pending = api({ request: new Request(`${root}speakers`) });
    const busy = await api({ request: new Request(`${root}sessions`) });
    expect(busy.status).toBe(429);
    expect(busy.headers.get("Retry-After")).toBe("1");
    reject(new Error("synthetic failure"));
    expect((await pending).status).toBe(503);
    expect((await api({ request: new Request(`${root}speakers`) })).status).toBe(200);
  });

  it("serves anonymous, sorted speaker summaries without private fields", async () => {
    const api = createPublicApi({ loadProgramme: loadPublicConferenceGuideProgramme });
    const response = await api({ request: new Request(`${root}speakers`) });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(await response.json()).toMatchObject({
      data: [
        { slug: "ada", displayName: "Ada", affiliation: "Engines", sessionCount: 1 },
        { slug: "zoe", displayName: "Zoe", sessionCount: 0 },
      ],
      meta: { apiVersion: "1", timeZone: "Europe/Skopje" },
    });
    const second = await api({ request: new Request(`${root}speakers`) });
    const text = await second.text();
    expect(text).not.toContain("PRIVATE_");
    expect(text).not.toContain("bio");
  });
});
