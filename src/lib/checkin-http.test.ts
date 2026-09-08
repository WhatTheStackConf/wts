import { describe, expect, it, vi } from "vite-plus/test";
import type { CheckinServiceContract } from "~/lib/checkin-contract";
import { handleCheckinRequest } from "~/lib/checkin-http";
import { CheckinError } from "~/lib/checkin-service";
import { isCheckinPath, protectCheckinResponse } from "~/lib/checkin-privacy";

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
