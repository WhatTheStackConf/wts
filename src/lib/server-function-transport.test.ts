import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createServerReference } from "@solidjs/web/server-functions/client";
import { handleServerFunctionRequest, registerServerFunction } from "@solidjs/web/server-functions/server";
import { provideRequestEvent } from "@solidjs/web/storage";
import { initializeServerFunctionTransport } from "./server-function-transport";

// Exercise the actual browser RPC encoder and server decoder, not a JSON mock.
// All requests stay in memory; no app auth, PocketBase, or live endpoint is used.
describe("server-function argument transport", () => {
  const received = vi.fn((...args: unknown[]) => args);
  const requests: Request[] = [];
  const reference = createServerReference("transport-regression", undefined, "http://wts.test/_server");

  beforeEach(() => {
    initializeServerFunctionTransport();
    received.mockClear();
    requests.length = 0;
    registerServerFunction("transport-regression", received);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      request.headers.set("Origin", "http://wts.test");
      requests.push(request.clone());
      return handleServerFunctionRequest(request, { provideEvent: provideRequestEvent });
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("submits a new Achievement with optional fields and nested unlock-rule defaults", async () => {
    const draft = {
      id: undefined,
      key: "transport-achievement",
      badgeName: "Transport Achievement",
      lockedTeaser: undefined,
      icon: undefined,
      unlockRule: { kind: "activity_count", activityKeys: [], count: 1, sourceDiversity: undefined },
      activeFrom: undefined,
      activeUntil: undefined,
    };

    await expect(reference(draft)).resolves.toStrictEqual([draft]);
    expect(received).toHaveBeenCalledExactlyOnceWith(draft);
    expect(requests).toHaveLength(1);
  });

  it("submits an Easter Egg with blank optional icon and reason", async () => {
    const draft = {
      eggKey: "transport-egg",
      badgeName: "Discovery",
      badgeIcon: undefined,
      reason: undefined,
      maxClaims: 100,
      operationId: "transport-egg-operation",
    };
    await expect(reference(draft)).resolves.toStrictEqual([draft]);
    expect(received).toHaveBeenCalledExactlyOnceWith(draft);
  });

  it("preserves optional fields at any depth without changing null or positional arguments", async () => {
    const workflow = {
      id: undefined,
      questions: [{ prompt: "Choose", hint: undefined, options: ["yes", undefined, null] }],
      enabled: false,
      points: 0,
      reason: "",
      endsAt: null,
    };
    await expect(reference(undefined, workflow, undefined)).resolves.toStrictEqual([undefined, workflow, undefined]);
    expect(received).toHaveBeenCalledExactlyOnceWith(undefined, workflow, undefined);
    expect(workflow.questions[0]).toHaveProperty("hint", undefined);
  });

  it("keeps ordinary DTOs on the JSON fast path", async () => {
    const draft = { id: "existing", enabled: false, sortOrder: 0, reason: "", endsAt: null };
    await expect(reference(draft)).resolves.toStrictEqual([draft]);
    expect(requests[0].headers.get("Content-Type")).toBe("application/json");
    expect(await requests[0].json()).toStrictEqual([draft]);
  });

  it("keeps native FormData uploads working", async () => {
    registerServerFunction("transport-upload", (form: FormData) => form.get("title"));
    const upload = createServerReference("transport-upload", undefined, "http://wts.test/_server");
    const form = new FormData();
    form.set("title", "Transport upload");
    await expect(upload(form)).resolves.toBe("Transport upload");
    expect(requests[0].headers.get("Content-Type")).toMatch(/^multipart\/form-data;/);
  });

  it("rejects unsupported class instances rather than exposing their fields via toJSON", async () => {
    const toJSON = vi.fn(() => ({ secret: "synthetic-secret-do-not-send" }));
    class PrivateValue {
      secret = "synthetic-secret-do-not-send";
      toJSON = toJSON;
    }
    await expect(reference({ optional: undefined, privateValue: new PrivateValue() })).rejects.toThrow();
    expect(toJSON).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
    expect(received).not.toHaveBeenCalled();
  });

  it("rejects functions before issuing a request", async () => {
    await expect(reference({ callback: () => "unsupported" })).rejects.toThrow();
    expect(requests).toHaveLength(0);
    expect(received).not.toHaveBeenCalled();
  });

  it("retains server validation results and error propagation", async () => {
    registerServerFunction("transport-validation", () => ({ success: false, error: "Reason required" }));
    const validate = createServerReference("transport-validation", undefined, "http://wts.test/_server");
    await expect(validate({ reason: undefined })).resolves.toStrictEqual({ success: false, error: "Reason required" });
    registerServerFunction("transport-denied", () => { throw new Error("Not authorized"); });
    const denied = createServerReference("transport-denied", undefined, "http://wts.test/_server");
    await expect(denied({ id: undefined })).rejects.toThrow();
    expect(requests).toHaveLength(2);
  });

  it("does not relax the server origin check for rich arguments", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      request.headers.set("Origin", "http://untrusted.test");
      const response = await handleServerFunctionRequest(request, { provideEvent: provideRequestEvent });
      expect(response.status).toBe(403);
      return response;
    });
    await reference({ id: undefined });
    expect(received).not.toHaveBeenCalled();
  });
});