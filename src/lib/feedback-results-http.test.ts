import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
const state = vi.hoisted(() => ({ event: vi.fn(), admin: vi.fn(), load: vi.fn(), role: "admin", token: "valid", verified: true, refreshed: vi.fn() }));
vi.mock("@solidjs/web", () => ({ getRequestEvent: state.event }));
vi.mock("pocketbase", () => ({ default: class {
  authStore = { token: "", record: null as unknown, isValid: true,
    loadFromCookie: () => { this.authStore.token = state.token; }, save: (token: string) => { this.authStore.token = token; } };
  collection() { return { authRefresh: async () => { state.refreshed(); this.authStore.record = { role: state.role, verified: state.verified }; } }; }
} }));
vi.mock("./pocketbase-admin-service", () => ({ getAdminPB: state.admin }));
vi.mock("./feedback-results-store", () => ({ loadFeedbackResults: state.load }));
import { handleFeedbackResults } from "./feedback-results-http";
function request(method = "POST", origin = "https://local.test", cookie = "pb_auth=fixture") {
  const request = new Request("https://local.test/api/admin/feedback", { method, headers: { origin, cookie } });
  state.event.mockReturnValue({ request, response: { headers: new Headers() } });
  return request;
}
beforeEach(() => { vi.clearAllMocks(); state.role = "admin"; state.verified = true; state.token = "valid"; state.admin.mockReturnValue({ getInstance: async () => ({}) }); state.load.mockResolvedValue({ title: "Safe DTO" }); });
describe("feedback results authorization boundary", () => {
  it.each(["user", "reviewer", "speaker", "checkin_operator", "mc"])("denies %s before any privileged query", async role => {
    state.role = role;
    expect((await handleFeedbackResults(request())).status).toBe(403);
    expect(state.admin).not.toHaveBeenCalled(); expect(state.load).not.toHaveBeenCalled();
  });
  it("denies missing authentication without touching feedback", async () => {
    expect((await handleFeedbackResults(request("POST", "https://local.test", ""))).status).toBe(403);
    expect(state.admin).not.toHaveBeenCalled(); expect(state.refreshed).not.toHaveBeenCalled();
  });
  it("denies unverified admins", async () => { state.verified = false; expect((await handleFeedbackResults(request())).status).toBe(403); expect(state.admin).not.toHaveBeenCalled(); });
  it("requires a same-origin POST", async () => {
    expect((await handleFeedbackResults(request("GET"))).status).toBe(405);
    expect((await handleFeedbackResults(request("POST", "https://elsewhere.test"))).status).toBe(403);
    expect(state.admin).not.toHaveBeenCalled();
  });
  it("refreshes admin authority then returns private non-cacheable results", async () => {
    const response = await handleFeedbackResults(request());
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ state: "ready", results: { title: "Safe DTO" } });
    expect(state.refreshed.mock.invocationCallOrder[0]).toBeLessThan(state.admin.mock.invocationCallOrder[0]);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("discards backend exception details instead of logging or serializing them", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    state.load.mockRejectedValue(new Error("private respondent answers and token"));
    const response = await handleFeedbackResults(request());
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ state: "unavailable" }); expect(log).not.toHaveBeenCalled(); log.mockRestore();
  });
});
