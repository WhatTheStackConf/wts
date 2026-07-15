import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  getRequestEvent: vi.fn(),
  authWithPassword: vi.fn(),
  authRefresh: vi.fn(),
  refreshedRecord: {
    id: "user-00000000001",
    email: "user@example.test",
    name: "Test User",
    avatar: "",
    role: "reviewer" as const,
    verified: true,
  },
  token: "",
}));

vi.mock("solid-js/web", () => ({ getRequestEvent: state.getRequestEvent }));
vi.mock("@solidjs/start/server", () => ({ createServerReference: (fn: unknown) => fn }));
vi.mock("pocketbase", () => ({
  default: class MockPocketBase {
    authStore = {
      token: "",
      record: null as Record<string, unknown> | null,
      get isValid() {
        return this.token.length > 0;
      },
      save: (token: string, record: Record<string, unknown> | null) => {
        this.authStore.token = token;
        this.authStore.record = record;
      },
      loadFromCookie: () => {
        this.authStore.token = state.token;
        this.authStore.record = null;
      },
    };

    collection() {
      return {
        authWithPassword: async (email: string, password: string) => {
          const result = await state.authWithPassword(email, password);
          this.authStore.token = result.token;
          this.authStore.record = result.record;
          return result;
        },
        authRefresh: async () => {
          await state.authRefresh();
          this.authStore.record = state.refreshedRecord;
          return { token: this.authStore.token, record: this.authStore.record };
        },
      };
    }
  },
}));

import {
  getSessionCore as getSession,
  requireAuth,
  serverLoginCore as serverLogin,
  serverLoginWithTokenCore as serverLoginWithToken,
  serverLogoutCore as serverLogout,
} from "~/lib/server-auth-core";

function validToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `header.${btoa(JSON.stringify({ exp }))}.signature`;
}

function requestEvent(options: { cookie?: string; origin?: string; method?: string } = {}) {
  const headers = new Headers({
    host: "wts.example.test",
    origin: options.origin || "https://wts.example.test",
    "sec-fetch-site": "same-origin",
  });
  if (options.cookie) headers.set("cookie", options.cookie);
  return {
    request: new Request("https://wts.example.test/_server", {
      method: options.method || "POST",
      headers,
    }),
    response: { headers: new Headers() },
  };
}

describe("server authentication", () => {
  beforeEach(() => {
    state.token = validToken();
    state.getRequestEvent.mockReset();
    state.authWithPassword.mockReset();
    state.authRefresh.mockReset();
    state.authRefresh.mockResolvedValue(undefined);
  });

  it("logs in without returning a browser token and sets the secure HttpOnly cookie", async () => {
    const event = requestEvent();
    state.getRequestEvent.mockReturnValue(event);
    state.authWithPassword.mockResolvedValue({ token: state.token, record: state.refreshedRecord });
    const result = await serverLogin("user@example.test", "temporary-password");
    expect(result).toEqual(state.refreshedRecord);
    expect(result).not.toHaveProperty("token");
    const cookie = event.response.headers.get("set-cookie") || "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("pb_auth_managed=1");
  });

  it("validates temporary OAuth or rollout tokens before setting a cookie", async () => {
    const event = requestEvent();
    state.getRequestEvent.mockReturnValue(event);
    const result = await serverLoginWithToken(state.token);
    expect(state.authRefresh).toHaveBeenCalledOnce();
    expect(result.role).toBe("reviewer");
    expect(event.response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("refreshes active cookie sessions and rotates the response cookie", async () => {
    const event = requestEvent({ cookie: "pb_auth=legacy-or-current-value" });
    state.getRequestEvent.mockReturnValue(event);
    await expect(getSession()).resolves.toEqual(state.refreshedRecord);
    expect(state.authRefresh).toHaveBeenCalledOnce();
    expect(event.response.headers.get("set-cookie")).toContain("HttpOnly");

    const secondEvent = requestEvent({ cookie: "pb_auth=current-value" });
    state.getRequestEvent.mockReturnValue(secondEvent);
    await expect(requireAuth()).resolves.toEqual(state.refreshedRecord);
    expect(secondEvent.response.headers.get("set-cookie")).toBeNull();
  });

  it("does not reissue an already managed session during hydration", async () => {
    const event = requestEvent({ cookie: "pb_auth=current-value; pb_auth_managed=1" });
    state.getRequestEvent.mockReturnValue(event);
    await expect(getSession()).resolves.toEqual(state.refreshedRecord);
    expect(event.response.headers.get("set-cookie")).toBeNull();
  });

  it("clears the server cookie on logout", async () => {
    const event = requestEvent();
    state.getRequestEvent.mockReturnValue(event);
    await serverLogout();
    expect(event.response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(event.response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("rejects cross-origin and non-POST cookie mutation requests", async () => {
    state.getRequestEvent.mockReturnValue(requestEvent({ origin: "https://attacker.example" }));
    await expect(serverLogin("user@example.test", "temporary-password")).rejects.toThrow("Unauthorized");
    expect(state.authWithPassword).not.toHaveBeenCalled();

    state.getRequestEvent.mockReturnValue(requestEvent({ method: "GET" }));
    await expect(serverLogout()).rejects.toThrow("Unauthorized");

    state.getRequestEvent.mockReturnValue(requestEvent({
      cookie: "pb_auth=current-value",
      origin: "https://attacker.example",
    }));
    await expect(requireAuth()).rejects.toThrow("Unauthorized");
    expect(state.authRefresh).not.toHaveBeenCalled();
  });

  it("preserves the cookie when PocketBase refresh fails transiently", async () => {
    const event = requestEvent({ cookie: "pb_auth=current-value" });
    state.getRequestEvent.mockReturnValue(event);
    state.authRefresh.mockRejectedValue(new Error("PocketBase unavailable"));
    await expect(getSession()).rejects.toThrow("PocketBase unavailable");
    expect(event.response.headers.get("set-cookie")).toBeNull();
  });

  it("clears the cookie when PocketBase rejects the session", async () => {
    const event = requestEvent({ cookie: "pb_auth=current-value" });
    state.getRequestEvent.mockReturnValue(event);
    state.authRefresh.mockRejectedValue(Object.assign(new Error("Invalid token"), { status: 401 }));
    await expect(getSession()).resolves.toBeNull();
    expect(event.response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
