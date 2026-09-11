import { describe, expect, it, vi } from "vite-plus/test";
import { checkinDiscoveryConfiguration, checkinServerConfig, createCheckinDiscoveryAdapter } from "~/lib/checkin-hievents";
import { createCheckinEventSource } from "~/lib/checkin-event-source";

// Synthetic transport fixtures, not deployed discovery evidence or credentials.
it.each(["https://admission.example.invalid", "https://admission.example.invalid/", "https://admission.example.invalid/api", "https://admission.example.invalid/api/"])("uses a canonical check-in API base for shared server setting %s", apiUrl => {
  vi.stubEnv("HIEVENTS_API_URL", apiUrl); vi.stubEnv("HIEVENTS_API_KEY", token); vi.stubEnv("HIEVENTS_ACCOUNT_ID", "77");
  try {
    expect(checkinDiscoveryConfiguration(checkinServerConfig())).toEqual({ base, key: token });
    expect(createCheckinEventSource().sourceKey).toBe(createCheckinEventSource(config).sourceKey);
  } finally { vi.unstubAllEnvs(); }
});
it.each(["http://admission.example.invalid", "https://user:password@admission.example.invalid", "https://admission.example.invalid?key=bad", "not a URL"])("does not repair unsafe shared server setting %s", apiUrl => {
  vi.stubEnv("HIEVENTS_API_URL", apiUrl); vi.stubEnv("HIEVENTS_API_KEY", token); vi.stubEnv("HIEVENTS_ACCOUNT_ID", "77");
  try { expect(checkinDiscoveryConfiguration(checkinServerConfig())).toBeNull(); }
  finally { vi.unstubAllEnvs(); }
});
const base = "https://admission.example.invalid/api";
const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url")}.${Buffer.from('{"account_id":77}').toString("base64url")}.c3ludGhldGlj`;
const config = { apiUrl: base, apiKey: token, accountId: "77" };
const event = { id: 501, title: "Explicit edition candidate", settings: { private: "not-a-DTO" } };
const product = { id: 601, event_id: 501, title: "Admission", description: "private" };
const list = { id: 701, name: "Admission list", short_id: "synthetic-list-capability", is_active: true, is_expired: false, products: [product] };
const question = { id: 801, event_id: 501, title: "Organisation", type: "SINGLE_LINE_TEXT", belongs_to: "PRODUCT", product_ids: [601], description: "private" };

function page(path: string, data: unknown[], current = 1, total = data.length, perPage = 25) {
  const last = Math.max(1, Math.ceil(total / perPage));
  const url = (p: number) => `${base}/${path}?page=${p}`;
  return {
    data,
    links: { first: url(1), last: url(last), prev: current > 1 ? url(current - 1) : null, next: current < last ? url(current + 1) : null },
    meta: { current_page: current, last_page: last, per_page: perPage, total, from: data.length ? (current - 1) * perPage + 1 : null, to: data.length ? (current - 1) * perPage + data.length : null, path: `${base}/${path}` },
  };
}

function transport(...bodies: unknown[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url, init });
    const body = bodies.shift();
    if (body === undefined) throw new Error("Unexpected request");
    if (body instanceof Error) throw body;
    return body instanceof Response ? body : Response.json(body);
  };
  return { calls, fetcher };
}

// Advance only the injected reader clock; exercise its real retries and budget.
function readClock() {
  let time = 0;
  return { now: () => time, random: () => 0, sleep: async (ms: number) => { time += ms; } };
}

const category = { id: 901, name: "Tickets", products: [{ ...product, product_category_id: 901 }] };
function failedReads(status = 500) {
  return Array.from({ length: 3 }, () => new Response("private upstream diagnostic", { status }));
}

describe("read-only Hi.Events admission discovery", () => {
  it("validates prefix-stripped pagination metadata without following its URLs", async () => {
    const alias = (body: ReturnType<typeof page>) => ({ ...body,
      meta: { ...body.meta, path: body.meta.path.replace("/api/", "/") },
      links: Object.fromEntries(Object.entries(body.links).map(([key, value]) => [key, value?.replace("/api/", "/") ?? null])) });
    const upstream = transport(alias(page("events", [event], 1, 2, 1)), alias(page("events", [{ ...event, id: 502 }], 2, 2, 1)));
    expect(await createCheckinDiscoveryAdapter(config, upstream.fetcher).discover()).toEqual({ status: "complete", data: [{ id: "501", title: event.title }, { id: "502", title: event.title }] });
    expect(upstream.calls.map(call => call.url)).toEqual([`${base}/events?page=1&per_page=25`, `${base}/events?page=2&per_page=25`]);
  });
  it("uses the complete authenticated category catalogue including hidden products after first-page product HTTP 500", async () => {
    const hidden = { id: 602, event_id: "501", title: "Hidden admission", is_hidden: true };
    const upstream = transport(page("events/501/check-in-lists", [{ ...list, products: [product, hidden] }]),
      { data: [{ ...question, product_ids: [601, 602] }] }, ...failedReads(),
      { data: [{ ...category, products: [...category.products, hidden] }] });
    const result = await createCheckinDiscoveryAdapter(config, upstream.fetcher, readClock()).options("501");
    expect(result).toEqual({ status: "complete", data: {
      eventId: "501",
      lists: [{ id: "701", title: "Admission list", productIds: ["601", "602"], isActive: true, isExpired: false }],
      questions: [{ id: "801", title: "Organisation", type: "SINGLE_LINE_TEXT", belongsTo: "PRODUCT", productIds: ["601", "602"] }],
      products: [{ id: "601", title: "Admission" }, { id: "602", title: "Hidden admission" }],
      serverOnly: { listCapabilities: { "701": "synthetic-list-capability" } },
    } });
    expect(upstream.calls.map((call) => call.url)).toEqual([
      `${base}/events/501/check-in-lists?page=1&per_page=25`, `${base}/events/501/questions`,
      `${base}/events/501/products?page=1&per_page=25`, `${base}/events/501/products?page=1&per_page=25`,
      `${base}/events/501/products?page=1&per_page=25`, `${base}/events/501/product-categories`,
    ]);
    for (const call of upstream.calls) {
      expect(call.init).toMatchObject({ method: "GET", redirect: "error", credentials: "omit", cache: "no-store", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      expect(call.init?.body).toBeUndefined();
    }
    if (result.status !== "complete") throw new Error("Expected fixture options");
    const { serverOnly: _secrets, ...safe } = result.data;
    expect(JSON.stringify(safe)).not.toContain("synthetic-list-capability");
    expect(JSON.stringify(safe)).not.toContain("private");
  });

  it.each([
    ["missing data", {}], ["non-array data", { data: {} }], ["null category", { data: [null] }],
    ["meta", { data: [category], meta: null }], ["links", { data: [category], links: null }],
    ["errors", { data: [category], errors: [] }], ["extra envelope field", { data: [category], total: 1 }],
    ["duplicate categories", { data: [category, { ...category, id: "901", products: [] }] }],
    ["invalid category ID", { data: [{ ...category, id: "0901" }] }],
    ["unsafe category ID", { data: [{ ...category, id: 9007199254740992 }] }],
    ["missing category ID", { data: [{ name: "Tickets", products: [product] }] }],
    ["foreign category when scope supplied", { data: [{ ...category, event_id: 502 }] }],
    ["blank category name", { data: [{ ...category, name: "  " }] }],
    ["invalid category name", { data: [{ ...category, name: null }] }],
    ["oversized category name", { data: [{ ...category, name: "x".repeat(2001) }] }],
    ["missing products", { data: [{ id: 901, name: "Tickets" }] }],
    ["paginated nested products", { data: [{ ...category, products: { data: [product] } }] }],
    ["non-array products", { data: [{ ...category, products: null }] }],
    ["null product", { data: [{ ...category, products: [null] }] }],
    ["missing product event", { data: [{ ...category, products: [{ id: 601, title: "Admission" }] }] }],
    ["foreign product event", { data: [{ ...category, products: [{ ...product, event_id: 502 }] }] }],
    ["foreign product category", { data: [{ ...category, products: [{ ...product, product_category_id: 902 }] }] }],
    ["null product category", { data: [{ ...category, products: [{ ...product, product_category_id: null }] }] }],
    ["invalid product ID", { data: [{ ...category, products: [{ ...product, id: "0601" }] }] }],
    ["unsafe product ID", { data: [{ ...category, products: [{ ...product, id: 9007199254740992 }] }] }],
    ["blank product title", { data: [{ ...category, products: [{ ...product, title: " " }] }] }],
    ["invalid product title", { data: [{ ...category, products: [{ ...product, title: null }] }] }],
    ["oversized product title", { data: [{ ...category, products: [{ ...product, title: "x".repeat(2001) }] }] }],
    ["duplicate products within category", { data: [{ ...category, products: [product, { ...product, id: "601" }] }] }],
    ["duplicate products across categories", { data: [category, { ...category, id: 902, products: [product] }] }],
  ])("withholds all fallback data on %s", async (_name, body) => {
    const upstream = transport(page("events/501/check-in-lists", [list]), { data: [question] }, ...failedReads(), body);
    expect(await createCheckinDiscoveryAdapter(config, upstream.fetcher, readClock()).options("501"))
      .toEqual({ status: "partial", reason: "contract" });
    expect(upstream.calls).toHaveLength(6);
    expect(upstream.calls[5]?.url).toBe(`${base}/events/501/product-categories`);
  });

  it.each([
    ["category count", { data: Array.from({ length: 1001 }, (_, i) => ({ id: i + 1, title: "Tickets", products: [] })) }],
    ["product count in one category", { data: [{ ...category, products: Array.from({ length: 1001 }, (_, i) => ({ ...product, id: i + 1 })) }] }],
    ["product count across categories", { data: [
      { ...category, products: Array.from({ length: 600 }, (_, i) => ({ ...product, id: i + 1 })) },
      { ...category, id: 902, products: Array.from({ length: 401 }, (_, i) => ({ ...product, id: i + 601 })) },
    ] }],
  ])("enforces the total fallback %s budget", async (_name, body) => {
    const upstream = transport(page("events/501/check-in-lists", []), { data: [] }, ...failedReads(), body);
    expect(await createCheckinDiscoveryAdapter(config, upstream.fetcher, readClock()).options("501"))
      .toEqual({ status: "partial", reason: "limit" });
    expect(upstream.calls).toHaveLength(6);
  });

  it("accepts exactly 1000 categories and 1000 total products without truncating", async () => {
    const categories = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, name: "Tickets",
      products: [{ id: i + 1, event_id: "501", product_category_id: String(i + 1), title: `Ticket ${i + 1}` }] }));
    const upstream = transport(page("events/501/check-in-lists", []), { data: [] }, ...failedReads(), { data: categories });
    const result = await createCheckinDiscoveryAdapter(config, upstream.fetcher, readClock()).options("501");
    expect(result.status).toBe("complete");
    if (result.status !== "complete") throw new Error("Expected fixture options");
    expect(result.data.products).toHaveLength(1000);
    expect(result.data.products[0]).toEqual({ id: "1", title: "Ticket 1" });
    expect(result.data.products[999]).toEqual({ id: "1000", title: "Ticket 1000" });
    expect(upstream.calls).toHaveLength(6);
  });

  it.each(["list", "question"])("retains the %s product-reference crosscheck for fallback catalogues", async (scope) => {
    const upstream = transport(page("events/501/check-in-lists", scope === "list" ? [list] : []),
      { data: scope === "question" ? [question] : [] }, ...failedReads(), { data: [] });
    expect(await createCheckinDiscoveryAdapter(config, upstream.fetcher, readClock()).options("501"))
      .toEqual({ status: "partial", reason: "contract" });
    expect(upstream.calls).toHaveLength(6);
  });

  it("accepts a complete empty fallback catalogue only when no option references products", async () => {
    const upstream = transport(page("events/501/check-in-lists", []), { data: [] }, ...failedReads(), { data: [] });
    expect(await createCheckinDiscoveryAdapter(config, upstream.fetcher, readClock()).options("501"))
      .toEqual({ status: "complete", data: { eventId: "501", lists: [], questions: [], products: [], serverOnly: { listCapabilities: {} } } });
  });

  it.each([401, 403, 404, 429, 502, 503])("does not fall back from flat HTTP %i", async (status) => {
    const responses = status === 429 || status >= 500 ? failedReads(status) : [new Response("private", { status })];
    const upstream = transport(page("events/501/check-in-lists", [list]), { data: [question] }, ...responses, { data: [category] });
    expect(await createCheckinDiscoveryAdapter(config, upstream.fetcher, readClock()).options("501"))
      .toEqual({ status: "partial", reason: "http" });
    expect(upstream.calls.filter((call) => call.url.endsWith("/product-categories"))).toEqual([]);
    expect(upstream.calls).toHaveLength(2 + responses.length);
  });

  it.each([
    ["transport error", () => [new Error("private")], "transport"],
    ["network retries", () => Array.from({ length: 3 }, () => new TypeError("private")), "transport"],
    ["HTTP 500 then transport error", () => [new Response("private", { status: 500 }), new Error("private")], "transport"],
    ["HTTP 500 then malformed JSON", () => [new Response("private", { status: 500 }), new Response("{private")], "contract"],
    ["malformed JSON", () => [new Response("{private")], "contract"],
    ["missing pagination", () => [{ data: [product] }], "contract"],
    ["duplicate flat products", () => [page("events/501/products", [product, product])], "contract"],
    ["foreign flat product", () => [page("events/501/products", [{ ...product, event_id: 502 }])], "contract"],
    ["flat row budget", () => [page("events/501/products", [product], 1, 1001)], "limit"],
  ] as const)("does not rescue flat %s with the category catalogue", async (_name, responses, reason) => {
    const failures = responses();
    const upstream = transport(page("events/501/check-in-lists", [list]), { data: [question] }, ...failures, { data: [category] });
    expect(await createCheckinDiscoveryAdapter(config, upstream.fetcher, readClock()).options("501"))
      .toEqual({ status: "partial", reason });
    expect(upstream.calls).toHaveLength(2 + failures.length);
    expect(upstream.calls.some((call) => call.url.endsWith("/product-categories"))).toBe(false);
  });

  it("never replaces already accepted flat product pages after a later HTTP 500", async () => {
    const upstream = transport(page("events/501/check-in-lists", [list]), { data: [question] },
      page("events/501/products", [product], 1, 2, 1), ...failedReads(), { data: [category] });
    expect(await createCheckinDiscoveryAdapter(config, upstream.fetcher, readClock()).options("501"))
      .toEqual({ status: "partial", reason: "http" });
    expect(upstream.calls.map((call) => call.url)).toEqual([
      `${base}/events/501/check-in-lists?page=1&per_page=25`, `${base}/events/501/questions`,
      `${base}/events/501/products?page=1&per_page=25`, `${base}/events/501/products?page=2&per_page=25`,
      `${base}/events/501/products?page=2&per_page=25`, `${base}/events/501/products?page=2&per_page=25`,
    ]);
  });

  it("keeps a valid flat catalogue when the bounded reader recovers from HTTP 500", async () => {
    const upstream = transport(page("events/501/check-in-lists", [list]), { data: [question] },
      new Response("private", { status: 500 }), page("events/501/products", [product]), { data: [category] });
    const result = await createCheckinDiscoveryAdapter(config, upstream.fetcher, readClock()).options("501");
    expect(result.status).toBe("complete");
    if (result.status !== "complete") throw new Error("Expected fixture options");
    expect(result.data.products).toEqual([{ id: "601", title: "Admission" }]);
    expect(upstream.calls).toHaveLength(4);
    expect(upstream.calls.some((call) => call.url.endsWith("/product-categories"))).toBe(false);
  });

  it.each([
    ["auth failure", () => [new Response("private", { status: 401 })], "http"],
    ["forbidden", () => [new Response("private", { status: 403 })], "http"],
    ["rate limited", () => failedReads(429), "http"],
    ["HTTP 500", () => failedReads(), "http"],
    ["transport failure", () => [new Error("private")], "transport"],
    ["malformed JSON", () => [new Response("{private")], "contract"],
  ] as const)("withholds all options on category %s without another catalogue switch", async (_name, responses, reason) => {
    const failures = responses();
    const upstream = transport(page("events/501/check-in-lists", [list]), { data: [question] }, ...failedReads(), ...failures);
    expect(await createCheckinDiscoveryAdapter(config, upstream.fetcher, readClock()).options("501"))
      .toEqual({ status: "partial", reason });
    expect(upstream.calls).toHaveLength(5 + failures.length);
    expect(upstream.calls.slice(5).every((call) => call.url === `${base}/events/501/product-categories`)).toBe(true);
  });

  it("uses the bounded reader for fallback bodies too", async () => {
    for (const response of [
      new Response("private", { headers: { "content-length": "2097153" } }),
      Response.json({ data: [{ ...category, private: "x".repeat(2 * 1024 * 1024) }] }),
    ]) {
      const upstream = transport(page("events/501/check-in-lists", []), { data: [] }, ...failedReads(), response);
      expect(await createCheckinDiscoveryAdapter(config, upstream.fetcher, readClock()).options("501"))
        .toEqual({ status: "partial", reason: "limit" });
      expect(upstream.calls).toHaveLength(6);
    }
  });

  it.each([
    {}, { ...config, apiUrl: undefined }, { ...config, apiKey: undefined }, { ...config, accountId: undefined },
    { ...config, accountId: "78" }, { ...config, accountId: "077" }, { ...config, apiKey: "opaque-key-not-proven-by-source" },
    { ...config, apiUrl: "http://admission.example.invalid/api" }, { ...config, apiUrl: `${base}?key=bad` },
    { ...config, apiUrl: "https://user:pass@admission.example.invalid/api" }, { ...config, apiUrl: `${base}#fragment` },
  ])("fails closed with incomplete, mismatched-account or unsafe config and has no fixture defaults", async (badConfig) => {
    const upstream = transport();
    const adapter = createCheckinDiscoveryAdapter(badConfig, upstream.fetcher);
    expect(await adapter.discover()).toEqual({ status: "unavailable", reason: "configuration" });
    expect(await adapter.options("501")).toEqual({ status: "unavailable", reason: "configuration" });
    expect(upstream.calls).toHaveLength(0);
  });

  it("refuses browser execution even when explicit credentials are supplied", async () => {
    const upstream = transport();
    vi.stubGlobal("window", {});
    try {
      expect(await createCheckinDiscoveryAdapter(config, upstream.fetcher).discover()).toEqual({ status: "unavailable", reason: "configuration" });
      expect(upstream.calls).toHaveLength(0);
    } finally { vi.unstubAllGlobals(); }
  });

  it.each([0, -1, 1.5, 9007199254740992, "01", "9007199254740992", null])("rejects unsafe/malformed upstream numeric identities %j rather than rounding or coercing", async (badId) => {
    const upstream = transport(page("events", [{ ...event, id: badId }]));
    expect(await createCheckinDiscoveryAdapter(config, upstream.fetcher).discover()).toEqual({ status: "unavailable", reason: "contract" });
  });

  it("bounds page totals before more reads", async () => {
    const upstream = transport(page("events", [event], 1, 1001));
    expect(await createCheckinDiscoveryAdapter(config, upstream.fetcher).discover()).toEqual({ status: "unavailable", reason: "limit" });
    expect(upstream.calls).toHaveLength(1);
  });

  it("bounds declared and streamed bodies and rejects malformed JSON without echoing diagnostics", async () => {
    for (const response of [
      new Response("private", { headers: { "content-type": "application/json", "content-length": "2097153" } }),
      Response.json({ data: [], private: "x".repeat(2 * 1024 * 1024) }),
    ]) {
      const upstream = transport(response);
      expect(await createCheckinDiscoveryAdapter(config, upstream.fetcher).discover()).toEqual({ status: "unavailable", reason: "limit" });
    }
    const upstream = transport(new Response("{private", { headers: { "content-type": "application/json" } }));
    expect(await createCheckinDiscoveryAdapter(config, upstream.fetcher).discover()).toEqual({ status: "unavailable", reason: "contract" });
  });

  it("bounds a stalled transport and aborts it without retrying", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    let calls = 0;
    const fetcher: typeof fetch = async (_url, init) => { calls++; signal = init?.signal; return new Promise(() => {}); };
    try {
      const result = createCheckinDiscoveryAdapter(config, fetcher).discover();
      await vi.advanceTimersByTimeAsync(10_001);
      expect(await result).toEqual({ status: "unavailable", reason: "transport" });
      expect(signal?.aborted).toBe(true);
      expect(calls).toBe(1);
    } finally { vi.useRealTimers(); }
  });

  it("loads lists, the unpaginated question collection and every product page, separating server-only capabilities from option DTOs", async () => {
    const upstream = transport(page("events/501/check-in-lists", [list]), { data: [question] },
      page("events/501/products", [product], 1, 2, 1), page("events/501/products", [{ id: 602, event_id: "501", title: "Workshop" }], 2, 2, 1));
    const result = await createCheckinDiscoveryAdapter(config, upstream.fetcher).options("501");
    expect(result).toEqual({ status: "complete", data: {
      eventId: "501",
      lists: [{ id: "701", title: "Admission list", productIds: ["601"], isActive: true, isExpired: false }],
      questions: [{ id: "801", title: "Organisation", type: "SINGLE_LINE_TEXT", belongsTo: "PRODUCT", productIds: ["601"] }],
      products: [{ id: "601", title: "Admission" }, { id: "602", title: "Workshop" }],
      serverOnly: { listCapabilities: { "701": "synthetic-list-capability" } },
    } });
    expect(upstream.calls.map((call) => call.url)).toEqual([
      `${base}/events/501/check-in-lists?page=1&per_page=25`, `${base}/events/501/questions`,
      `${base}/events/501/products?page=1&per_page=25`, `${base}/events/501/products?page=2&per_page=25`,
    ]);
    for (const call of upstream.calls) { expect(call.init?.method).toBe("GET"); expect(call.init?.body).toBeUndefined(); }
    if (result.status !== "complete") throw new Error("Expected fixture options");
    const { serverOnly: _secrets, ...safe } = result.data;
    expect(JSON.stringify(safe)).not.toContain("synthetic-list-capability");
    expect(JSON.stringify(safe)).not.toContain("private");
  });

  it.each(["0", "01", "+1", "1.0", "1e2", " 1", "1 ", "-1", "1/2", "1?x=y", "9007199254740992", "", "١"])("rejects the exact malformed event ID %j without normalization or any fetch", async (eventId) => {
    const upstream = transport();
    expect(await createCheckinDiscoveryAdapter(config, upstream.fetcher).options(eventId)).toEqual({ status: "unavailable", reason: "invalid_event_id" });
    expect(upstream.calls).toHaveLength(0);
  });

  it("does not mistake a paginated or failed question read for a complete empty mapping catalogue", async () => {
    for (const questions of [page("events/501/questions", [question]), new Error("secret"), { data: [question, question] }]) {
      const upstream = transport(page("events/501/check-in-lists", []), questions);
      const result = await createCheckinDiscoveryAdapter(config, upstream.fetcher).options("501");
      expect(result.status).toBe("partial");
      expect(result).not.toHaveProperty("data");
      expect(upstream.calls).toHaveLength(2);
    }
  });

  it.each([
    { ...question, event_id: 502 }, { ...question, product_ids: [999] }, { ...question, product_ids: [601, 601] },
  ])("rejects wrong-event or inconsistent immutable question product scopes", async (badQuestion) => {
    const upstream = transport(page("events/501/check-in-lists", [list]), { data: [badQuestion] }, page("events/501/products", [product]));
    expect(await createCheckinDiscoveryAdapter(config, upstream.fetcher).options("501")).toEqual({ status: "partial", reason: "contract" });
  });

  it("reads every page and withholds all data if a later read fails", async () => {
    const first = page("events", [event], 1, 2, 1);
    const upstream = transport(first, page("events", [{ id: 502, title: "Unrelated year" }], 2, 2, 1));
    expect(await createCheckinDiscoveryAdapter(config, upstream.fetcher).discover()).toEqual({
      status: "complete", data: [{ id: "501", title: "Explicit edition candidate" }, { id: "502", title: "Unrelated year" }],
    });
    expect(upstream.calls.map((call) => call.url)).toEqual([`${base}/events?page=1&per_page=25`, `${base}/events?page=2&per_page=25`]);
    const failed = transport(first, new Error("private upstream diagnostic"));
    expect(await createCheckinDiscoveryAdapter(config, failed.fetcher).discover()).toEqual({ status: "partial", reason: "transport" });
  });

  it.each([
    ["missing metadata", { data: [event] }],
    ["missing links", { data: [event], meta: page("events", [event]).meta }],
    ["empty but nonzero total", page("events", [], 1, 1)],
    ["short page", page("events", [event], 1, 26)],
    ["duplicate IDs", page("events", [event, event])],
    ["cross-origin next", { ...page("events", [event], 1, 2, 1), links: { ...page("events", [event], 1, 2, 1).links, next: "https://evil.invalid/api/events?page=2" } }],
    ["missing next", { ...page("events", [event], 1, 2, 1), links: { ...page("events", [event], 1, 2, 1).links, next: null } }],
    ["wrong total type", { ...page("events", [event]), meta: { ...page("events", [event]).meta, total: "1" } }],
    ["wrong last page", { ...page("events", [event]), meta: { ...page("events", [event]).meta, last_page: 2 } }],
  ])("fails closed on %s instead of returning a successful partial catalogue", async (_name, body) => {
    const upstream = transport(body);
    expect(await createCheckinDiscoveryAdapter(config, upstream.fetcher).discover()).toEqual({ status: "unavailable", reason: "contract" });
    expect(upstream.calls).toHaveLength(1);
  });

  it("distinguishes complete empty discovery from dependency failure", async () => {
    const empty = transport(page("events", []));
    expect(await createCheckinDiscoveryAdapter(config, empty.fetcher).discover()).toEqual({ status: "complete", data: [] });
    const failed = transport(new Response("private", { status: 403 }));
    expect(await createCheckinDiscoveryAdapter(config, failed.fetcher).discover()).toEqual({ status: "unavailable", reason: "http" });
    expect(failed.calls).toHaveLength(1);
  });

  it("discovers account events without title inference or leaking upstream fields and issues only a credential-contained GET", async () => {
    const upstream = transport(page("events", [event]));
    const adapter = createCheckinDiscoveryAdapter(config, upstream.fetcher);
    expect(await adapter.discover()).toEqual({ status: "complete", data: [{ id: "501", title: "Explicit edition candidate" }] });
    expect(upstream.calls).toHaveLength(1);
    expect(upstream.calls[0]?.url).toBe(`${base}/events?page=1&per_page=25`);
    expect(upstream.calls[0]?.init).toMatchObject({ method: "GET", redirect: "error", credentials: "omit", cache: "no-store", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    expect(upstream.calls[0]?.init?.body).toBeUndefined();
  });
});
