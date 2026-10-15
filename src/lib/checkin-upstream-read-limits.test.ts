import { describe, expect, it, vi } from "vite-plus/test";
import { CheckinReadError, createCheckinUpstreamReader } from "~/lib/checkin-upstream-read";

const config = { base: "https://reader.example.invalid/api", key: "synthetic" };
function clocked(transport: typeof fetch) {
  const clock = { time: 0 };
  const read = createCheckinUpstreamReader(config, transport, { now: () => clock.time, random: () => 0, sleep: async ms => { clock.time += ms; } });
  return { clock, read };
}
async function failure(promise: Promise<unknown>) {
  try { await promise; return "resolved"; } catch (error) { const e = error as CheckinReadError; return { reason: e.reason, status: e.status, retryAfterMs: e.retryAfterMs, retryBlocked: e.retryBlocked }; }
}

describe("check-in GET reader limits and contract", () => {
  it("normalizes error metadata", () => {
    expect({ ...new CheckinReadError("http", { status: 99, retryAfterMs: Infinity }), message: "http" }).toEqual({ reason: "http", status: undefined, retryAfterMs: 86400000, retryBlocked: true, message: "http" });
    const error = new CheckinReadError("limit", { status: 404, retryAfterMs: 1.2 });
    expect([error.message, error.status, error.retryAfterMs, error.retryBlocked]).toEqual(["limit", 404, 2, false]);
    expect([new CheckinReadError("transport").status, new CheckinReadError("transport", { retryAfterMs: -5 }).retryAfterMs, new CheckinReadError("transport", { retryAfterMs: 86400001 }).retryBlocked]).toEqual([undefined, 0, true]);
  });
  it("sends one authenticated or anonymous GET with fixed options", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ ok: 1 }));
    const { read } = clocked(transport);
    expect(await read("events?page=1")).toEqual({ ok: 1 });
    expect(await read("public/list", false)).toEqual({ ok: 1 });
    expect(transport.mock.calls.map(([url, init]) => [url, { ...init, signal: undefined }])).toEqual([
      ["https://reader.example.invalid/api/events?page=1", { method: "GET", redirect: "error", credentials: "omit", cache: "no-store", headers: { Authorization: "Bearer synthetic", Accept: "application/json" }, signal: undefined }],
      ["https://reader.example.invalid/api/public/list", { method: "GET", redirect: "error", credentials: "omit", cache: "no-store", headers: { Accept: "application/json" }, signal: undefined }],
    ]);
  });
  it("rejects oversize declared and streamed bodies", async () => {
    const cancel = vi.fn();
    const declared = vi.fn<typeof fetch>().mockImplementation(async () => new Response(new ReadableStream({ cancel }), { headers: { "content-length": String(2 * 1024 * 1024 + 1) } }));
    expect(await failure(clocked(declared).read("events"))).toEqual({ reason: "limit", status: 200, retryAfterMs: 0, retryBlocked: false });
    expect(cancel).toHaveBeenCalledTimes(1);
    const chunk = new Uint8Array(1024 * 1024);
    const streamed = vi.fn<typeof fetch>().mockImplementation(async () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(chunk); } })));
    expect(await failure(clocked(streamed).read("events"))).toEqual({ reason: "limit", status: 200, retryAfterMs: 0, retryBlocked: false });
    expect(streamed).toHaveBeenCalledTimes(1);
    const exact = vi.fn<typeof fetch>().mockImplementation(async () => new Response(`{"a":"${"x".repeat(2 * 1024 * 1024 - 8)}"}`, { headers: { "content-length": String(2 * 1024 * 1024) } }));
    expect(Object.keys(await clocked(exact).read("events"))).toEqual(["a"]);
  });
  it.each([["[]"], ["null"], ["1"], ["{"], [""]])("rejects non-object JSON %j as contract", async body => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response(body));
    expect(await failure(clocked(transport).read("events"))).toEqual({ reason: "contract", status: 200, retryAfterMs: 0, retryBlocked: false });
  });
  it("rejects a missing body as contract", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null));
    expect(await failure(clocked(transport).read("events"))).toEqual({ reason: "contract", status: 200, retryAfterMs: 0, retryBlocked: false });
  });
  it("does not retry client errors or redirects", async () => {
    const missing = vi.fn<typeof fetch>().mockImplementation(async () => new Response("{}", { status: 404 }));
    expect(await failure(clocked(missing).read("events"))).toEqual({ reason: "http", status: 404, retryAfterMs: 0, retryBlocked: false });
    expect(missing).toHaveBeenCalledTimes(1);
    const redirected = vi.fn<typeof fetch>().mockImplementation(async () => Object.defineProperty(Response.json({}), "redirected", { value: true }));
    expect(await failure(clocked(redirected).read("events"))).toEqual({ reason: "http", status: 200, retryAfterMs: 0, retryBlocked: false });
    expect(redirected).toHaveBeenCalledTimes(1);
    const programmer = vi.fn<typeof fetch>().mockRejectedValue(new Error("fixture bug"));
    expect(await failure(clocked(programmer).read("events"))).toEqual({ reason: "transport", status: undefined, retryAfterMs: 0, retryBlocked: false });
    expect(programmer).toHaveBeenCalledTimes(1);
  });
  it("blocks on dated and malformed Retry-After values", async () => {
    const dated = vi.fn<typeof fetch>().mockImplementation(async () => new Response("{}", { status: 404, headers: { "Retry-After": new Date(5000).toUTCString() } }));
    const first = clocked(dated);
    expect(await failure(first.read("events"))).toEqual({ reason: "http", status: 404, retryAfterMs: 5000, retryBlocked: false });
    expect(await failure(first.read("events"))).toEqual({ reason: "http", status: undefined, retryAfterMs: 5000, retryBlocked: false });
    expect(dated).toHaveBeenCalledTimes(1);
    const malformed = vi.fn<typeof fetch>().mockImplementation(async () => new Response("{}", { status: 404, headers: { "Retry-After": "soon" } }));
    expect(await failure(clocked(malformed).read("events"))).toEqual({ reason: "http", status: 404, retryAfterMs: 60000, retryBlocked: false });
  });
  it("reports the remaining window when the reserve is reached", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({}, { headers: { "X-RateLimit-Remaining": "5", "X-RateLimit-Reset": "1" } }));
    const { read, clock } = clocked(transport);
    expect(await read("events")).toEqual({});
    clock.time = 100;
    expect(await failure(read("events"))).toEqual({ reason: "http", status: undefined, retryAfterMs: 59900, retryBlocked: false });
    clock.time = 58_600;
    expect(await read("events")).toEqual({});
    expect(clock.time).toBe(60_000);
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("ignores malformed rate-limit headers", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({}, { headers: { "X-RateLimit-Remaining": "-1", "X-RateLimit-Limit": "1e3", "X-RateLimit-Reset": "9007199254740993" } }));
    const { read } = clocked(transport);
    for (let i = 0; i < 175; i++) await read("events");
    expect(await failure(read("events"))).toEqual({ reason: "http", status: undefined, retryAfterMs: 60000, retryBlocked: false });
    expect(transport).toHaveBeenCalledTimes(175);
  });
});
