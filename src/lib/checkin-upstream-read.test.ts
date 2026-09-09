import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createCheckinUpstreamReader } from "~/lib/checkin-upstream-read";

const config = { base: "https://reader.example.invalid/api", key: "synthetic" };
afterEach(() => vi.useRealTimers());

describe("shared check-in GET reader", () => {
  it("finishes an early timer wake without rejecting a still-safe read or spending before backoff", async () => {
    let time = 0;
    const sent: number[] = [];
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => {
      sent.push(time);
      return sent.length === 1 ? new Response("{}", { status: 503 }) : Response.json({ ok: true });
    });
    const read = createCheckinUpstreamReader(config, transport, { now: () => time, random: () => 0, sleep: async ms => { time += Math.max(1, ms - 1); } });
    expect(await read("events")).toEqual({ ok: true });
    expect(sent).toEqual([0, 200]);
  });
  it("adopts the first observed higher limit rather than retaining the fallback", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({}, { headers: { "X-RateLimit-Limit": "10000", "X-RateLimit-Remaining": "9999" } }));
    const read = createCheckinUpstreamReader(config, transport);
    for (let i = 0; i < 200; i++) await read("events");
    expect(transport).toHaveBeenCalledTimes(200);
  });

  it("retains a lower observed limit on reset and never replenishes from stale remaining headers", async () => {
    let time = 0;
    const transport = vi.fn<typeof fetch>().mockImplementationOnce(async () => Response.json({}, { headers: { "X-RateLimit-Limit": "7", "X-RateLimit-Remaining": "6", "X-RateLimit-Reset": "60" } })).mockImplementation(async () => Response.json({}));
    const read = createCheckinUpstreamReader(config, transport, { now: () => time });
    await read("events");
    await read("events");
    await expect(read("events")).rejects.toThrow("http");
    time = 60_000;
    await read("events");
    await read("events");
    await expect(createCheckinUpstreamReader(config, transport, { now: () => time })("events")).rejects.toThrow("http");
    expect(transport).toHaveBeenCalledTimes(4);
  });

  it("waits a fresh local window when exhausted remaining has no usable reset", async () => {
    let time = 0;
    const transport = vi.fn<typeof fetch>().mockImplementationOnce(async () => Response.json({})).mockImplementation(async () => Response.json({}, { headers: { "X-RateLimit-Remaining": "0" } }));
    const read = createCheckinUpstreamReader(config, transport, { now: () => time });
    await read("events");
    time = 59_999;
    await read("events");
    time = 60_000;
    await expect(read("events")).rejects.toThrow("http");
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("does not replenish an observed budget from repeated stale headers", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({}, { headers: { "X-RateLimit-Limit": "7", "X-RateLimit-Remaining": "6" } }));
    const read = createCheckinUpstreamReader(config, transport);
    await read("events");
    await read("events");
    await expect(read("events")).rejects.toThrow("http");
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("shares Retry-After with concurrent readers and spends no early GET", async () => {
    vi.useFakeTimers();
    const times: number[] = [];
    const started = Date.now();
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => {
      times.push(Date.now() - started);
      return times.length === 1 ? new Response("{}", { status: 429, headers: { "Retry-After": "1" } }) : Response.json({});
    });
    const first = createCheckinUpstreamReader(config, transport, { random: () => 0 })("events");
    const second = createCheckinUpstreamReader(config, transport, { random: () => 0 })("attendees", false);
    const result = Promise.all([first, second]);
    await vi.advanceTimersByTimeAsync(999);
    expect(times).toEqual([0]);
    await vi.advanceTimersByTimeAsync(26);
    await result;
    expect(times).toHaveLength(3);
    expect(times.slice(1).every(time => time >= 1000)).toBe(true);
  });

  it("retains long Retry-After across separately constructed readers", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response("{}", { status: 429, headers: { "Retry-After": "60" } }));
    await expect(createCheckinUpstreamReader(config, transport)("events")).rejects.toThrow("http");
    await expect(createCheckinUpstreamReader(config, transport)("attendees")).rejects.toThrow("http");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each(["network", "server"])("caps %s failures at three GET attempts", async kind => {
    let time = 0;
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => {
      if (kind === "network") throw new TypeError("synthetic network failure");
      return new Response("{}", { status: 503, headers: { "Retry-After": "0" } });
    });
    const read = createCheckinUpstreamReader(config, transport, { now: () => time, sleep: async ms => { time += ms; }, random: () => 0 });
    await expect(read("events")).rejects.toThrow(kind === "network" ? "transport" : "http");
    expect(transport).toHaveBeenCalledTimes(3);
    for (const [, init] of transport.mock.calls) { expect(init?.method).toBe("GET"); expect(init?.body).toBeUndefined(); }
  });

  it("does not replenish its total wait allowance on every retry", async () => {
    let time = 0;
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response("{}", { status: 429, headers: { "Retry-After": "1" } }));
    await expect(createCheckinUpstreamReader(config, transport, { now: () => time, sleep: async ms => { time += ms; } })("events")).rejects.toThrow("http");
    expect(transport).toHaveBeenCalledTimes(2);
    expect(time).toBe(1000);
  });

  it("rejects slot waiters within 1.5s without releasing a stuck owner's slot", async () => {
    vi.useFakeTimers();
    const transport = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const read = createCheckinUpstreamReader(config, transport);
    const owner = read("events").catch(error => error.reason);
    const waiter = read("attendees").catch(error => error.reason);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await waiter).toBe("http");
    const next = read("products").catch(error => error.reason);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await next).toBe("http");
    expect(transport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(7000);
    expect(await owner).toBe("transport");
    expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("bounds waiting occupancy as well as duration", async () => {
    vi.useFakeTimers();
    const transport = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const read = createCheckinUpstreamReader(config, transport);
    const owner = read("events").catch(error => error.reason);
    const waiters = Array.from({ length: 32 }, () => read("attendees").catch(error => error.reason));
    await expect(read("overflow")).rejects.toThrow("http");
    await vi.advanceTimersByTimeAsync(1500);
    expect(await Promise.all(waiters)).toEqual(Array(32).fill("http"));
    expect(transport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(8500);
    await owner;
  });

  it("ends a hanging body at the original response deadline and cancels the stream", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 9000));
      return new Response(new ReadableStream({ cancel }));
    });
    const outcome = createCheckinUpstreamReader(config, transport)("events").catch(error => error.reason);
    await vi.advanceTimersByTimeAsync(9999);
    expect(cancel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBe("transport");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("waits for an ordinary concurrent read across separate accounts on the same origin", async () => {
    vi.useFakeTimers();
    let release!: (response: Response) => void;
    const transport = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockImplementation(async () => Response.json({ ok: true }));
    const first = createCheckinUpstreamReader(config, transport)("events");
    const second = createCheckinUpstreamReader({ base: `${config.base}/public`, key: "other-account" }, transport)("attendees", false);
    const both = Promise.allSettled([first, second]);
    expect(transport).toHaveBeenCalledTimes(1);
    release(Response.json({ ok: true }));
    await vi.advanceTimersByTimeAsync(25);
    expect(await both).toEqual([{ status: "fulfilled", value: { ok: true } }, { status: "fulfilled", value: { ok: true } }]);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[1][1]).toMatchObject({ method: "GET" });
    expect(transport.mock.calls[1][1]?.headers).not.toHaveProperty("Authorization");
  });
});
