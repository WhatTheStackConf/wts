import { describe, expect, it, vi } from "vite-plus/test";
import { startOAuthLogin, type AuthRequestQueue } from "~/lib/oauth-login";

describe("OAuth login orchestration", () => {
  it("starts OAuth synchronously before the session queue runs", async () => {
    const events: string[] = [];
    const loading: boolean[] = [];
    let runQueuedSession!: () => void;
    let resolveAuthentication!: (auth: { token: string }) => void;
    const authentication = new Promise<{ token: string }>((resolve) => {
      resolveAuthentication = resolve;
    });
    const authenticate = vi.fn(() => {
      events.push("oauth:start");
      return authentication;
    });
    const enqueueSession: AuthRequestQueue = (request) =>
      new Promise((resolve, reject) => {
        runQueuedSession = () => void request().then(resolve, reject);
      });

    const login = startOAuthLogin({
      authenticate,
      enqueueSession,
      establishSession: async ({ token }) => {
        events.push("session:start");
        return token;
      },
      setLoading: (value) => loading.push(value),
      cleanup: () => events.push("cleanup"),
    });

    expect(authenticate).toHaveBeenCalledOnce();
    expect(events).toEqual(["oauth:start"]);
    expect(loading).toEqual([true]);

    resolveAuthentication({ token: "temporary-oauth-token" });
    await Promise.resolve();
    expect(events).toEqual(["oauth:start"]);

    runQueuedSession();
    await expect(login).resolves.toBe("temporary-oauth-token");
    expect(events).toEqual(["oauth:start", "session:start", "cleanup"]);
    expect(loading).toEqual([true, false]);
  });

  it("restores loading state when OAuth fails before returning a promise", async () => {
    const loading: boolean[] = [];
    const cleanup = vi.fn();

    const login = startOAuthLogin({
      authenticate: () => {
        throw new Error("Popup unavailable");
      },
      enqueueSession: async (request) => request(),
      establishSession: async () => "unreachable",
      setLoading: (value) => loading.push(value),
      cleanup,
    });

    await expect(login).rejects.toThrow("Popup unavailable");
    expect(cleanup).toHaveBeenCalledOnce();
    expect(loading).toEqual([true, false]);
  });
});
