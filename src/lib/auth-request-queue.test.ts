import { describe, expect, it } from "vitest";
import {
  createAuthRequestQueue,
  type AuthRequestLock,
} from "~/lib/auth-request-queue";

function sharedAuthLock(): AuthRequestLock {
  let lock: Promise<void> = Promise.resolve();
  return {
    run<T>(request: () => Promise<T>): Promise<T> {
      const result = lock.then(request, request);
      lock = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}

describe("auth request queue", () => {
  it("keeps logout behind an in-flight login response", async () => {
    const enqueue = createAuthRequestQueue();
    const events: string[] = [];
    let finishLogin!: () => void;
    const loginGate = new Promise<void>((resolve) => {
      finishLogin = resolve;
    });

    const login = enqueue(async () => {
      events.push("login:start");
      await loginGate;
      events.push("login:cookie-set");
    });
    const logout = enqueue(async () => {
      events.push("logout:cookie-cleared");
    });

    await Promise.resolve();
    expect(events).toEqual(["login:start"]);
    finishLogin();
    await Promise.all([login, logout]);
    expect(events).toEqual([
      "login:start",
      "login:cookie-set",
      "logout:cookie-cleared",
    ]);
  });

  it("continues after a failed request", async () => {
    const enqueue = createAuthRequestQueue();
    const failed = enqueue(async () => {
      throw new Error("Login failed");
    });
    const logout = enqueue(async () => "cleared");
    await expect(failed).rejects.toThrow("Login failed");
    await expect(logout).resolves.toBe("cleared");
  });

  it("keeps logout behind an in-flight login from another tab", async () => {
    const lock = sharedAuthLock();
    const firstTab = createAuthRequestQueue(lock);
    const secondTab = createAuthRequestQueue(lock);
    const events: string[] = [];
    let finishLogin!: () => void;
    const loginGate = new Promise<void>((resolve) => {
      finishLogin = resolve;
    });

    const login = firstTab(async () => {
      events.push("login:start");
      await loginGate;
      events.push("login:cookie-set");
    });
    const logout = secondTab(async () => {
      events.push("logout:cookie-cleared");
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["login:start"]);
    finishLogin();
    await Promise.all([login, logout]);
    expect(events).toEqual([
      "login:start",
      "login:cookie-set",
      "logout:cookie-cleared",
    ]);
  });
});
