import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { fetchHiEventsAttendeeSnapshot, type HiEventsAdapterOptions } from "~/lib/hievents";

const fetchedAt = "2026-04-01T12:00:00.000Z";
const firstPageUrl = "https://tickets.example/api/events/evt%201/attendees?page=1&per_page=100";
const secondPageUrl = "https://tickets.example/api/events/evt%201/attendees?page=2&per_page=100";
const ENV_KEYS = [
  "HIEVENTS_API_URL",
  "HIEVENTS_EVENT_ID",
  "HIEVENTS_API_KEY",
  "HIEVENTS_EMAIL",
  "HIEVENTS_PASSWORD",
  "HIEVENTS_ACCOUNT_ID",
  "HIEVENTS_REQUEST_TIMEOUT_MS",
  "HIEVENTS_MAX_RETRIES",
  "HIEVENTS_RETRY_BASE_MS",
];
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
});

type Step = unknown;

function scriptedFetcher(steps: Step[]) {
  const urls: string[] = [];
  const authorizations: string[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(String(url));
    authorizations.push(String((init?.headers as Record<string, string> | undefined)?.Authorization));
    const step = steps.shift();
    if (step instanceof Error) throw step;
    if (step instanceof Response) return step;
    return new Response(JSON.stringify(step), { status: 200 });
  }) as typeof fetch;
  return { fetcher, urls, authorizations };
}

async function snapshotFor(steps: Step[], options: HiEventsAdapterOptions = {}) {
  const scripted = scriptedFetcher(steps);
  const snapshot = await fetchHiEventsAttendeeSnapshot({
    apiUrl: "https://tickets.example/",
    eventId: "evt 1",
    accessToken: "tok",
    now: () => fetchedAt,
    maxRetries: 0,
    fetcher: scripted.fetcher,
    ...options,
  });
  return { snapshot, urls: scripted.urls, authorizations: scripted.authorizations };
}

function attendees(snapshot: Awaited<ReturnType<typeof fetchHiEventsAttendeeSnapshot>>) {
  if (snapshot.state !== "success") throw new Error(`Expected success, received ${snapshot.state}`);
  return snapshot.attendees.map((attendee) => attendee.stableId);
}

const row = (id: string) => ({ id, email: `${id}@example.com` });

function partial(reason: string, requestedPages: number, completedPages: number, totalPages?: number) {
  return { state: "partial", eventId: "evt 1", fetchedAt, pagination: { requestedPages, completedPages, totalPages, complete: false }, reason };
}

function unavailable(reason: string, requestedPages: number) {
  return { state: "unavailable", eventId: "evt 1", fetchedAt, pagination: { requestedPages, completedPages: 0, totalPages: undefined, complete: false }, reason };
}

describe("Hi.Events attendee snapshot pagination", () => {
  it("follows numbered pages from meta", async () => {
    const { snapshot, urls } = await snapshotFor([
      { data: [row("a1")], meta: { last_page: 2, current_page: 1 } },
      { data: [row("a2")], meta: { last_page: 2, current_page: 2 } },
    ]);
    expect(urls).toEqual([firstPageUrl, secondPageUrl]);
    expect(attendees(snapshot)).toEqual(["a1", "a2"]);
    expect(snapshot.pagination).toEqual({ requestedPages: 2, completedPages: 2, totalPages: 2, complete: true });
  });

  it("follows same-path next links when no total is known", async () => {
    const { snapshot, urls } = await snapshotFor([
      { data: [row("a1")], links: { next: "/api/events/evt%201/attendees?cursor=abc" } },
      { data: [row("a2")], links: { next: null } },
    ]);
    expect(urls).toEqual([firstPageUrl, "https://tickets.example/api/events/evt%201/attendees?cursor=abc"]);
    expect(attendees(snapshot)).toEqual(["a1", "a2"]);
    expect(snapshot.pagination).toEqual({ requestedPages: 2, completedPages: 2, totalPages: 2, complete: true });
  });

  it("uses numbered pages instead of a same-origin next link when the total is known", async () => {
    const { snapshot, urls } = await snapshotFor([
      { data: [row("a1")], meta: { last_page: 2 }, links: { next: "/elsewhere?page=2" } },
      { data: [], meta: { last_page: 2 } },
    ]);
    expect(urls).toEqual([firstPageUrl, secondPageUrl]);
    expect(snapshot.pagination).toEqual({ requestedPages: 2, completedPages: 2, totalPages: 2, complete: true });
  });

  it.each<[string, unknown[], HiEventsAdapterOptions, unknown]>([
    ["no pagination metadata", [{ data: [row("a1")] }], {}, partial("malformed_pagination", 1, 0)],
    ["a cross-origin next link", [{ data: [row("a1")], links: { next: "https://evil.example/api/events/evt%201/attendees?page=2" } }], {}, partial("malformed_pagination", 1, 1)],
    ["a next link to another path", [{ data: [row("a1")], links: { next: "/api/events/other/attendees?page=2" } }], {}, partial("malformed_pagination", 1, 1)],
    ["a repeated next link", [{ data: [row("a1")], links: { next: "/api/events/evt%201/attendees?page=1&per_page=100" } }], {}, partial("malformed_pagination", 1, 1)],
    ["a reported page mismatch", [{ data: [row("a1")], meta: { current_page: 2 } }], {}, partial("malformed_pagination", 1, 0)],
    ["a fractional page total", [{ data: [row("a1")], meta: { last_page: 1.5 } }], {}, partial("malformed_pagination", 1, 0)],
    ["a shrinking page total", [{ data: [row("a1")], meta: { last_page: 2 } }, { data: [row("a2")], meta: { last_page: 1 } }], {}, partial("malformed_pagination", 2, 1, 2)],
    ["missing rows", [{ meta: { last_page: 1 } }], {}, partial("malformed_pagination", 1, 0)],
    ["a non-object row", [{ data: [row("a1"), 5], meta: { last_page: 1 } }], {}, partial("malformed_data", 1, 0)],
    ["an array body", [[]], {}, unavailable("malformed_data", 1)],
    ["an invalid JSON body", [new Response("not json", { status: 200 })], {}, unavailable("malformed_data", 1)],
    ["an invalid JSON second page", [{ data: [row("a1")], meta: { last_page: 2 } }, new Response("{", { status: 200 })], {}, partial("malformed_data", 2, 1, 2)],
    ["a forbidden first page", [new Response("no", { status: 403 })], {}, unavailable("authentication", 1)],
    ["a missing first page", [new Response("no", { status: 404 })], {}, unavailable("request", 1)],
    ["an unauthorized second page", [{ data: [row("a1")], meta: { last_page: 2 } }, new Response("no", { status: 401 })], {}, partial("request", 2, 1, 2)],
    ["a network failure", [new Error("offline")], {}, unavailable("request", 1)],
    ["a server error without retries", [new Response("no", { status: 500 })], {}, unavailable("request", 1)],
  ])("reports %s", async (_name, steps, options, expected) => {
    const { snapshot } = await snapshotFor(steps, options);
    expect(snapshot).toEqual(expected);
  });

  it.each<[string, unknown]>([
    ["nested data and meta", { data: { data: [row("a1")], meta: { current_page: 1, last_page: 1 } } }],
    ["top-level pagination", { data: [row("a1")], pagination: { total_pages: 1, current_page: 1 } }],
    ["meta pagination", { data: [row("a1")], meta: { pagination: { total_pages: 1 } } }],
  ])("reads %s", async (_name, page) => {
    const { snapshot } = await snapshotFor([page]);
    expect(attendees(snapshot)).toEqual(["a1"]);
    expect(snapshot.pagination).toEqual({ requestedPages: 1, completedPages: 1, totalPages: 1, complete: true });
  });

  it("retries rate limits and server errors before succeeding", async () => {
    const { snapshot, urls } = await snapshotFor([
      new Response("busy", { status: 429, headers: { "retry-after": "0" } }),
      new Response("down", { status: 503 }),
      { data: [row("a1")], meta: { last_page: 1 } },
    ], { maxRetries: 2, retryBaseMs: 10 });
    expect(urls).toEqual([firstPageUrl, firstPageUrl, firstPageUrl]);
    expect(attendees(snapshot)).toEqual(["a1"]);
  });

  it("clamps retries to three and defaults unparseable retry settings to two", async () => {
    const failing = () => Array.from({ length: 6 }, () => new Response("down", { status: 500 }));
    const clamped = await snapshotFor(failing(), { maxRetries: 9, retryBaseMs: 10 });
    expect(clamped.urls).toHaveLength(4);
    expect(clamped.snapshot).toEqual(unavailable("request", 1));

    process.env.HIEVENTS_MAX_RETRIES = "two";
    const defaulted = await snapshotFor(failing(), { maxRetries: undefined, retryBaseMs: 10 });
    expect(defaulted.urls).toHaveLength(3);
  });

  it("reports missing configuration before any request", async () => {
    const { snapshot, urls } = await snapshotFor([], { apiUrl: "", eventId: "evt 1" });
    expect(urls).toEqual([]);
    expect(snapshot).toEqual({ state: "unavailable", fetchedAt, pagination: { requestedPages: 0, completedPages: 0, totalPages: undefined, complete: false }, reason: "configuration" });

    process.env.HIEVENTS_API_URL = "https://tickets.example";
    process.env.HIEVENTS_EVENT_ID = "env-event";
    const fromEnv = await snapshotFor([{ data: [], meta: { last_page: 1 } }], { apiUrl: undefined, eventId: undefined });
    expect(fromEnv.urls).toEqual(["https://tickets.example/api/events/env-event/attendees?page=1&per_page=100"]);
    expect(fromEnv.snapshot).toMatchObject({ state: "success", eventId: "env-event" });
  });
});

describe("Hi.Events attendee snapshot rows", () => {
  it("maps identity, eligibility, check-in, product, and freshness facts", async () => {
    const { snapshot } = await snapshotFor([{
      data: [
        {
          id: "att-1",
          email: "  Ada@Example.COM ",
          status: "Active",
          first_name: " Ada ",
          last_name: "Lovelace",
          locale: "en",
          product_id: 13,
          product: { title: "Conference", price: "120.5", currency: "EUR" },
          public_url: "https://t/1",
          updated_at: "2026-03-01T10:00:00Z",
          check_ins: [
            { id: "c-old", created_at: "2026-03-02T09:00:00Z" },
            { uuid: "c-new", checked_in_at: "2026-03-03T09:00:00Z" },
            { nothing: true },
            "bad",
          ],
        },
        { public_id: "pub-2", email: "bad email@example.com", order_status: "pending_review", checked_in_at: "2026-03-04T08:00:00Z", created_at: "2026-02-01T00:00:00Z", product_id: "02" },
        { short_id: "s3", email: "x@y.co", ticket_status: "REFUNDED", product: [] },
        { email: "no-at-sign", is_cancelled: true },
        { id: "a5", email: "user@sub.example.org" },
        { id: "a6", email: "", status: "confirmed" },
        { id: "a7", email: "a..b@example.com", status: "checked_in" },
        { id: "a8", email: "u@-bad.com" },
        { id: "a9", email: "u@localhost" },
        { id: "a10", email: "u@example.com", status: "voided", refunded: false },
        { id: "a11", email: "ok@example.com", product_id: "15", status: "weird" },
        { id: "a12", email: `${"l".repeat(65)}@example.com` },
      ],
      meta: { last_page: 1 },
    }]);

    if (snapshot.state !== "success") throw new Error("Expected success");
    expect(snapshot.sourceUpdatedAt).toBe("2026-03-01T10:00:00Z");
    expect(snapshot.attendees).toEqual([
      {
        stableId: "att-1",
        email: "Ada@Example.COM",
        normalizedEmail: "ada@example.com",
        eligibility: "eligible",
        sourceStatus: "Active",
        checkedIn: true,
        checkInStableId: "c-new",
        checkedInAt: "2026-03-03T09:00:00Z",
        sourceUpdatedAt: "2026-03-01T10:00:00Z",
        productId: "13",
        firstName: "Ada",
        lastName: "Lovelace",
        locale: "en",
        ticketTitle: "Conference",
        ticketPrice: 120.5,
        ticketCurrency: "EUR",
        publicUrl: "https://t/1",
      },
      {
        stableId: "pub-2",
        email: "bad email@example.com",
        normalizedEmail: "",
        eligibility: "unknown",
        sourceStatus: "pending_review",
        checkedIn: true,
        checkedInAt: "2026-03-04T08:00:00Z",
        sourceUpdatedAt: "2026-02-01T00:00:00Z",
      },
      { stableId: "s3", email: "x@y.co", normalizedEmail: "x@y.co", eligibility: "ineligible", sourceStatus: "REFUNDED", checkedIn: false },
      {
        stableId: "51f120ee7cb572c5d9dc32292a4def36a2a614a64a89ca7faa753cdb2f1ecf57",
        email: "no-at-sign",
        normalizedEmail: "",
        eligibility: "ineligible",
        checkedIn: false,
      },
      { stableId: "a5", email: "user@sub.example.org", normalizedEmail: "user@sub.example.org", eligibility: "eligible", checkedIn: false },
      { stableId: "a6", email: "", normalizedEmail: "", eligibility: "unknown", sourceStatus: "confirmed", checkedIn: false },
      { stableId: "a7", email: "a..b@example.com", normalizedEmail: "", eligibility: "unknown", sourceStatus: "checked_in", checkedIn: false },
      { stableId: "a8", email: "u@-bad.com", normalizedEmail: "", eligibility: "unknown", checkedIn: false },
      { stableId: "a9", email: "u@localhost", normalizedEmail: "", eligibility: "unknown", checkedIn: false },
      { stableId: "a10", email: "u@example.com", normalizedEmail: "u@example.com", eligibility: "ineligible", sourceStatus: "voided", checkedIn: false },
      { stableId: "a11", email: "ok@example.com", normalizedEmail: "ok@example.com", eligibility: "unknown", sourceStatus: "weird", checkedIn: false, productId: "15" },
      { stableId: "a12", email: `${"l".repeat(65)}@example.com`, normalizedEmail: "", eligibility: "unknown", checkedIn: false },
    ]);
  });
});

describe("Hi.Events attendee snapshot authentication", () => {
  async function freshAdapter() {
    vi.resetModules();
    return import("~/lib/hievents");
  }

  it("uses the configured API key", async () => {
    process.env.HIEVENTS_API_KEY = "env-key";
    const { fetchHiEventsAttendeeSnapshot: fetchSnapshot } = await freshAdapter();
    const scripted = scriptedFetcher([{ data: [], meta: { last_page: 1 } }]);
    await fetchSnapshot({ apiUrl: "https://tickets.example", eventId: "e", fetcher: scripted.fetcher, now: () => fetchedAt });
    expect(scripted.authorizations).toEqual(["Bearer env-key"]);
  });

  it("logs in once and reuses the cached token", async () => {
    Object.assign(process.env, { HIEVENTS_EMAIL: "ops@example.com", HIEVENTS_PASSWORD: "pw", HIEVENTS_ACCOUNT_ID: "acc" });
    const { fetchHiEventsAttendeeSnapshot: fetchSnapshot } = await freshAdapter();
    const scripted = scriptedFetcher([
      { token: "login-token", expires_in: 0 },
      { data: [], meta: { last_page: 1 } },
      { data: [], meta: { last_page: 1 } },
    ]);
    const options = { apiUrl: "https://tickets.example", eventId: "e", fetcher: scripted.fetcher, now: () => fetchedAt };
    await fetchSnapshot(options);
    await fetchSnapshot(options);
    expect(scripted.urls).toEqual([
      "https://tickets.example/api/auth/login",
      "https://tickets.example/api/events/e/attendees?page=1&per_page=100",
      "https://tickets.example/api/events/e/attendees?page=1&per_page=100",
    ]);
    expect(scripted.authorizations.slice(1)).toEqual(["Bearer login-token", "Bearer login-token"]);
  });

  it("logs in again once a short-lived token is inside the refresh margin", async () => {
    Object.assign(process.env, { HIEVENTS_EMAIL: "ops@example.com", HIEVENTS_PASSWORD: "pw", HIEVENTS_ACCOUNT_ID: "acc" });
    const { fetchHiEventsAttendeeSnapshot: fetchSnapshot } = await freshAdapter();
    const scripted = scriptedFetcher([
      { token: "first", expires_in: 1 },
      { data: [], meta: { last_page: 1 } },
      { token: "second", expires_in: 1 },
      { data: [], meta: { last_page: 1 } },
    ]);
    const options = { apiUrl: "https://tickets.example", eventId: "e", fetcher: scripted.fetcher, now: () => fetchedAt };
    await fetchSnapshot(options);
    await fetchSnapshot(options);
    expect(scripted.authorizations).toEqual(["undefined", "Bearer first", "undefined", "Bearer second"]);
  });

  it.each<[string, Record<string, string>, unknown[]]>([
    ["missing credentials", {}, []],
    ["a rejected login", { HIEVENTS_EMAIL: "a@b.co", HIEVENTS_PASSWORD: "pw", HIEVENTS_ACCOUNT_ID: "acc" }, [new Response("no", { status: 401 })]],
    ["a blank login token", { HIEVENTS_EMAIL: "a@b.co", HIEVENTS_PASSWORD: "pw", HIEVENTS_ACCOUNT_ID: "acc" }, [{ token: " " }]],
    ["a failed login request", { HIEVENTS_EMAIL: "a@b.co", HIEVENTS_PASSWORD: "pw", HIEVENTS_ACCOUNT_ID: "acc" }, [new Error("offline")]],
  ])("reports authentication failure for %s", async (_name, env, steps) => {
    Object.assign(process.env, env);
    const { fetchHiEventsAttendeeSnapshot: fetchSnapshot } = await freshAdapter();
    const expectedCalls = steps.length;
    const scripted = scriptedFetcher(steps);
    await expect(fetchSnapshot({ apiUrl: "https://tickets.example", eventId: "e", fetcher: scripted.fetcher, now: () => fetchedAt }))
      .resolves.toEqual({ state: "unavailable", eventId: "e", fetchedAt, pagination: { requestedPages: 0, completedPages: 0, totalPages: undefined, complete: false }, reason: "authentication" });
    expect(scripted.urls).toHaveLength(expectedCalls);
  });
});

describe("Hi.Events releases", () => {
  async function releases(steps: unknown[], env: Record<string, string> = { HIEVENTS_API_URL: "https://tickets.example/", HIEVENTS_EVENT_ID: "5", HIEVENTS_API_KEY: "key" }) {
    Object.assign(process.env, env);
    const scripted = scriptedFetcher(steps);
    vi.stubGlobal("fetch", scripted.fetcher);
    vi.resetModules();
    const { fetchHiEventsReleases } = await import("~/lib/hievents");
    return { result: await fetchHiEventsReleases(), urls: scripted.urls, authorizations: scripted.authorizations };
  }

  it("maps visible products to releases", async () => {
    const { result, urls, authorizations } = await releases([{
      data: {
        slug: "wts-2027",
        product_categories: [{
          products: [
            { id: 3, title: "Early", description: "", price: "99", currency: "", is_available: "true", quantity_sold: "7" },
            { id: "x", title: "Hidden", is_hidden: true },
            { title: "Hidden legacy", hidden: 1 },
            { title: "Promo only", is_hidden_without_promo_code: "1" },
            { title: " Shown ", is_hidden: false, hidden: true, price: null, currency: "USD", description: "Desc", is_available: 1 },
            { title: "Bad price", price: "abc", is_available: "yes" },
            "not a product",
            [1],
          ],
        }],
      },
    }]);
    expect(urls).toEqual(["https://tickets.example/api/events/5/"]);
    expect(authorizations).toEqual(["Bearer key"]);
    const release = { sales_start_date: null, sales_end_date: null, quantity_available: null, purchase_link: "https://tickets.example/event/5/wts-2027" };
    expect(result).toEqual([
      { ...release, id: 3, title: "Early", description: null, price: 99, currency: "EUR", is_available: true, quantity_sold: 7 },
      { ...release, id: 0, title: "Shown", description: "Desc", price: null, currency: "USD", is_available: true, quantity_sold: 0 },
      { ...release, id: 0, title: "Bad price", description: null, price: null, currency: "EUR", is_available: false, quantity_sold: 0 },
    ]);
  });

  it("links to the event without a slug", async () => {
    const { result } = await releases([{ data: { product_categories: [{ products: [{ id: 1, title: "Ticket" }] }] } }]);
    expect(result.map((release) => release.purchase_link)).toEqual(["https://tickets.example/event/5"]);
  });

  it.each<[string, unknown[], Record<string, string> | undefined, number]>([
    ["missing configuration", [], { HIEVENTS_API_KEY: "key" }, 0],
    ["missing credentials", [], { HIEVENTS_API_URL: "https://tickets.example", HIEVENTS_EVENT_ID: "5" }, 0],
    ["a failed response", [new Response("no", { status: 500 })], undefined, 1],
    ["a missing product list", [{ data: { product_categories: [] } }], undefined, 1],
    ["a request failure", [new Error("offline")], undefined, 1],
  ])("returns no releases for %s", async (_name, steps, env, calls) => {
    const { result, urls } = await releases(steps, env);
    expect(result).toEqual([]);
    expect(urls).toHaveLength(calls);
  });
});
