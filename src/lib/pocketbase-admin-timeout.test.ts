import { afterEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ auth: vi.fn(), fallback: vi.fn(), store: { isValid: false } }));
vi.mock("pocketbase", () => ({ default: class {
  authStore = state.store;
  autoCancellation() {}
  collection() { return { authWithPassword: state.auth }; }
  admins = { authWithPassword: state.fallback };
} }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetModules(); state.auth.mockReset(); state.fallback.mockReset(); state.store.isValid = false; });

it("a stalled shared admin login aborts, avoids expired fallback and recovers next request", async () => {
  vi.stubEnv("POCKETBASE_SUPERUSER_EMAIL", "fixture@example.test");
  vi.stubEnv("POCKETBASE_SUPERUSER_PASSWORD", "fixture-only");
  const timeout = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.auth.mockImplementationOnce((_email, _password, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
  }));
  const { getAdminPB } = await import("~/lib/pocketbase-admin-service");
  const service = getAdminPB();
  const first = service.getInstance();
  const second = service.getInstance();
  const settled = Promise.allSettled([first, second]);
  expect(state.auth).toHaveBeenCalledTimes(1);
  timeout.abort(new DOMException("Timeout", "TimeoutError"));
  expect((await settled).map(result => result.status)).toEqual(["rejected", "rejected"]);
  expect(state.fallback).not.toHaveBeenCalled();
  vi.mocked(AbortSignal.timeout).mockReturnValue(new AbortController().signal);
  state.auth.mockImplementationOnce(async () => { state.store.isValid = true; });
  await expect(service.getInstance()).resolves.toBeDefined();
  expect(state.auth).toHaveBeenCalledTimes(2);
  await service.getInstance();
  expect(state.auth).toHaveBeenCalledTimes(2);
});
