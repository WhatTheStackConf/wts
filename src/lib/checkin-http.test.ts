import { describe, expect, it, vi } from "vite-plus/test";
import type { CheckinServiceContract } from "~/lib/checkin-contract";
import { handleCheckinRequest } from "~/lib/checkin-http";
import { CheckinError } from "~/lib/checkin-service";
import { isCheckinPath, protectCheckinResponse } from "~/lib/checkin-privacy";
import { checkinPrinters, previewCheckinStation, selectCheckinPrinter } from "~/lib/checkin-client";

const token = "a".repeat(64);
function request(body: unknown, options: { origin?: string; cookie?: string; method?: string } = {}) {
  const method = options.method ?? "POST";
  return new Request("https://wts.example.test/api/checkin", {
    method,
    headers: {
      origin: options.origin ?? "https://wts.example.test",
      "content-type": "application/json",
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}
function dependencies(role = "checkin_operator") {
  const service = {
    status: vi.fn().mockResolvedValue({ bindingState: "unbound", operationsEnabled: false }),
    printers: vi.fn().mockResolvedValue({ printers: [] }),
    selectPrinter: vi.fn().mockResolvedValue({ status: { bindingState: "bound", operationsEnabled: false }, bindingToken: token }),
    preview: vi.fn().mockResolvedValue({ canBind: true }),
    bind: vi.fn().mockResolvedValue({ status: { bindingState: "bound", operationsEnabled: false }, bindingToken: token }),
    adminList: vi.fn().mockResolvedValue({ stations: [] }),
    adminControl: vi.fn().mockResolvedValue({ actionId: "action", replayed: false }),
  } satisfies CheckinServiceContract;
  return {
    authenticate: vi.fn().mockResolvedValue({ id: "operator", role }),
    service: vi.fn().mockResolvedValue(service),
    provisioningQr: vi.fn().mockResolvedValue("data:image/png;base64,test-only"),
    target: service,
  };
}

describe("authenticated Check-in HTTP boundary", () => {
  it("cancels a queued printer choice before dispatch when its authority expires", async () => {
    const release = Promise.withResolvers<void>();
    const fetched = vi.fn();
    vi.stubGlobal("window", {}); vi.stubGlobal("navigator", { locks: { request: (_name: string, _options: unknown, run: () => unknown) => release.promise.then(run) } }); vi.stubGlobal("fetch", fetched);
    try {
      const cancellation = new AbortController();
      const selection = selectCheckinPrinter({ stationId: "wts2026station1", stationVersion: 1, systemGeneration: 1, bindingVersion: 0 }, { expectedActorId: "a".repeat(15), signal: cancellation.signal });
      cancellation.abort(); release.resolve();
      await expect(selection).rejects.toMatchObject({ name: "AbortError" });
      expect(fetched).not.toHaveBeenCalled();
    } finally { release.resolve(); vi.unstubAllGlobals(); }
  });
  it("rejects a printer choice from an old tab when a new operator owns the cookie", async () => {
    const deps = dependencies(); deps.authenticate.mockResolvedValue({ id: "b".repeat(15), role: "checkin_operator" });
    const result = await handleCheckinRequest(request({ operation: "select_printer", expectedActorId: "a".repeat(15), confirmation: { stationId: "wts2026station1", stationVersion: 1, systemGeneration: 1, bindingVersion: 0 } }, { cookie: `wts_checkin_client=${token}` }), deps);
    expect(result.status).toBe(403);
    expect(deps.service).not.toHaveBeenCalled();
  });
  it.each(["printers", "legacy preview"])("serializes printer identity setup with %s through the complete response", async kind => {
    // Inject only the platform lock/fetch boundaries; exercise the real clients.
    const queues = new Map<string, Promise<unknown>>();
    const lock = vi.fn((name: string, _options: unknown, run: () => Promise<unknown>) => {
      const next = (queues.get(name) ?? Promise.resolve()).then(run);
      queues.set(name, next.catch(() => undefined));
      return next;
    });
    const body = Promise.withResolvers<unknown>();
    const fetched = vi.fn().mockResolvedValueOnce({ ok: true, json: () => body.promise })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ printers: [] }) });
    vi.stubGlobal("window", {}); vi.stubGlobal("navigator", { locks: { request: lock } }); vi.stubGlobal("fetch", fetched);
    try {
      const first = checkinPrinters();
      await vi.waitFor(() => expect(fetched).toHaveBeenCalledTimes(1));
      const second = kind === "printers" ? checkinPrinters() : previewCheckinStation(token);
      await Promise.resolve(); await Promise.resolve();
      expect(fetched).toHaveBeenCalledTimes(1);
      expect(lock.mock.calls.map(args => args[0])).toEqual(["wts-checkin-client-preview", "wts-checkin-client-preview"]);
      body.resolve({ printers: [] }); await first; await second;
      expect(fetched).toHaveBeenCalledTimes(2);
      expect(fetched.mock.calls.every(([, options]) => options.credentials === "same-origin")).toBe(true);
    } finally { body.resolve({ printers: [] }); vi.unstubAllGlobals(); }
  });
  it("refuses printer identity setup and selection without Web Locks before fetching", async () => {
    const fetched = vi.fn(); vi.stubGlobal("window", {}); vi.stubGlobal("navigator", {}); vi.stubGlobal("fetch", fetched);
    try {
      await expect(checkinPrinters()).rejects.toThrow("current browser over HTTPS");
      await expect(selectCheckinPrinter({ stationId: "wts2026station1", stationVersion: 1, systemGeneration: 1, bindingVersion: 0 })).rejects.toThrow();
      expect(fetched).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it("lists operator printers and establishes identity before a code-free selection", async () => {
    const deps = dependencies();
    const catalogue = await handleCheckinRequest(request({ operation: "printers" }), deps);
    expect(catalogue.status).toBe(200);
    expect(await catalogue.json()).toEqual({ printers: [] });
    const cookie = catalogue.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^wts_checkin_client=[a-f0-9]{64};/);
    expect(cookie).toContain("HttpOnly; SameSite=Strict; Secure");
    expect(deps.target.selectPrinter).not.toHaveBeenCalled();
    const confirmation = { stationId: "wts2026station2", stationVersion: 2, systemGeneration: 2, bindingVersion: 0 };
    const body = { operation: "select_printer", confirmation };
    expect((await handleCheckinRequest(request(body), deps)).status).toBe(400);
    const selected = await handleCheckinRequest(request(body, { cookie: cookie.split(";")[0] }), deps);
    expect(selected.status).toBe(200);
    expect(deps.target.selectPrinter).toHaveBeenCalledWith(cookie.split("=")[1].split(";")[0], confirmation);
    expect(await selected.json()).toEqual({ bindingState: "bound", operationsEnabled: false });
    expect(selected.headers.get("set-cookie")).toBeNull();
    const existing = await handleCheckinRequest(request({ operation: "printers" }, { cookie: `wts_checkin_client=${token}` }), deps);
    expect(existing.headers.get("set-cookie")).toBeNull();
    expect(deps.target.printers).toHaveBeenLastCalledWith(token);
    expect((await handleCheckinRequest(request(body, { origin: "https://foreign.test" }), deps)).status).toBe(403);
    deps.authenticate.mockResolvedValue({ id: "ordinary", role: "user" });
    expect((await handleCheckinRequest(request({ operation: "printers" }), deps)).status).toBe(403);
    expect((await handleCheckinRequest(request(body, { cookie: cookie.split(";")[0] }), deps)).status).toBe(403);
  });
  it("stops reading oversized streamed commands before obtaining privileged access", async () => {
    const deps = dependencies();
    let reads = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads++;
        if (reads > 3) throw new Error("The oversized body must not be fully consumed");
        controller.enqueue(new Uint8Array(4097));
      },
    }, { highWaterMark: 0 });
    const input = new Request("https://wts.example.test/api/checkin", {
      method: "POST",
      headers: { origin: "https://wts.example.test", "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);
    const result = await handleCheckinRequest(input, deps);
    expect(result.status).toBe(413);
    expect(reads).toBe(1);
    expect(deps.service).not.toHaveBeenCalled();
  });

  it("isolates station documents from third-party scripts, framing, caching and referrers", async () => {
    expect(isCheckinPath("/checkin")).toBe(true);
    expect(isCheckinPath("/admin/checkin")).toBe(true);
    expect(isCheckinPath("/api/checkin")).toBe(true);
    expect(isCheckinPath("/checkin-other")).toBe(false);
    const result = protectCheckinResponse(new Response("station shell"));
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.headers.get("referrer-policy")).toBe("no-referrer");
    expect(result.headers.get("content-security-policy")).toContain("connect-src 'self'");
    expect(result.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(await result.text()).toBe("station shell");
  });

  it("distinguishes safe domain failures from unavailable storage without leaking diagnostics", async () => {
    const deps = dependencies();
    vi.mocked(deps.target.preview).mockRejectedValueOnce(new CheckinError("invalid_code", 400));
    const invalid = await handleCheckinRequest(request({ operation: "preview", code: token }), deps);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: "invalid_code" });
    vi.mocked(deps.target.preview).mockRejectedValueOnce(new Error(`private upstream request ${token} attendee@example.test`));
    const failed = await handleCheckinRequest(request({ operation: "preview", code: token }), deps);
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toMatch(/private upstream|attendee@|aaaa/);
  });

  it.each([
    { body: { operation: "scan", code: token }, cookie: undefined },
    { body: { operation: "print" }, cookie: undefined },
    { body: { operation: "status", bindingToken: token }, cookie: undefined },
    { body: { operation: "preview", code: "bad-code" }, cookie: undefined },
    { body: { operation: "status" }, cookie: "wts_checkin_client=bad" },
    { body: { operation: "status" }, cookie: `wts_checkin_client=${token}; wts_checkin_client=${token}` },
  ])("rejects malformed or unfinished capabilities before privileged work: $body.operation", async ({ body, cookie }) => {
    const deps = dependencies();
    const result = await handleCheckinRequest(request(body, { cookie }), deps);
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(deps.service).not.toHaveBeenCalled();
  });

  it("reserves admin controls for admins and returns a local provisioning QR without logging the code", async () => {
    const deps = dependencies();
    const control = { operation: "rotate_provision_code", operationId: "11111111-1111-4111-8111-111111111111", stationId: "wts2026station1", expectedVersion: 1, reason: "security" };
    expect((await handleCheckinRequest(request({ operation: "admin_control", command: control }), deps)).status).toBe(403);
    expect(deps.service).not.toHaveBeenCalled();
    deps.authenticate.mockResolvedValue({ id: "admin", role: "admin" });
    vi.mocked(deps.target.adminControl).mockResolvedValue({ actionId: "action", replayed: false, provisionCode: token });
    const result = await handleCheckinRequest(request({ operation: "admin_control", command: control }), deps);
    expect(result.status).toBe(200);
    expect(deps.target.adminControl).toHaveBeenCalledWith(control);
    expect(deps.provisioningQr).toHaveBeenCalledWith(`https://wts.example.test/checkin#provision=${token}`);
    expect(await result.json()).toMatchObject({ provisionCode: token, qrDataUrl: "data:image/png;base64,test-only" });
  });

  it("previews without binding and confirms using only a persistent HttpOnly client identity", async () => {
    const deps = dependencies();
    const preview = await handleCheckinRequest(request({ operation: "preview", code: token }), deps);
    expect(preview.status).toBe(200);
    const cookie = preview.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^wts_checkin_client=[a-f0-9]{64};/);
    expect(cookie).toContain("HttpOnly; SameSite=Strict; Secure");
    expect(cookie).toContain("Max-Age=31536000");
    expect(deps.target.bind).not.toHaveBeenCalled();
    const confirmation = { stationId: "wts2026station1", stationVersion: 1, systemGeneration: 1, bindingVersion: 0 };
    const confirmed = await handleCheckinRequest(request({ operation: "bind", code: token, confirmation }, { cookie: cookie.split(";")[0] }), deps);
    expect(confirmed.status).toBe(200);
    expect(deps.target.bind).toHaveBeenCalledWith(token, cookie.split("=")[1].split(";")[0], confirmation);
    expect(await confirmed.json()).toEqual({ bindingState: "bound", operationsEnabled: false });
    expect(confirmed.headers.get("cache-control")).toBe("private, no-store");
  });

  it("denies cross-origin and unprivileged requests before obtaining privileged access", async () => {
    const deps = dependencies();
    const response = await handleCheckinRequest(request({ operation: "status" }, { origin: "https://foreign.test" }), deps);
    expect(response.status).toBe(403);
    expect(deps.authenticate).not.toHaveBeenCalled();
    expect(deps.service).not.toHaveBeenCalled();
    deps.authenticate.mockResolvedValue({ id: "ordinary", role: "user" });
    expect((await handleCheckinRequest(request({ operation: "status" }), deps)).status).toBe(403);
    expect(deps.service).not.toHaveBeenCalled();
  });
});
