import { describe, expect, it, vi } from "vite-plus/test";
import { createCheckinDiscoveryAdapter } from "~/lib/checkin-hievents";

// Synthetic transport fixtures, not deployed discovery evidence or credentials.
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

describe("read-only Hi.Events admission discovery", () => {
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
