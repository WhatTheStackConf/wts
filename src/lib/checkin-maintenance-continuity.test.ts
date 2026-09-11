import { afterEach, expect, it, vi } from "vite-plus/test";
import { runCentralMaintenance } from "../../runtime/checkin/central-maintenance";

const state = vi.hoisted(() => ({ tick: vi.fn(), compact: vi.fn(), observe: vi.fn(), deliver: vi.fn(), clear: vi.fn() }));
vi.mock("../../runtime/checkin/private-configuration", () => ({ readPrivateObject: () => ({ email: "synthetic@example.test", password: "synthetic" }) }));
vi.mock("../../runtime/checkin/schema-readiness", () => ({ verifyCheckinSchema: async () => undefined }));
vi.mock("~/lib/checkin-monitoring-worker", () => ({ CheckinMonitoringWorker: class { observe = state.observe; deliver = state.deliver; } }));
vi.mock("pocketbase", () => ({ default: class {
  authStore = { clear: state.clear }; autoCancellation() {};
  collection() { return { authWithPassword: async () => undefined }; }
  async send(_path: string, options: { body: { operation: string } }) { return options.body.operation === "compact" ? state.compact() : state.tick(); }
} }));
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

for (const fault of ["observe", "deliver", "tick"] as const) {
  it(`keeps fixed-deadline retention scheduling alive after transient ${fault} failure`, async () => {
    const stop = new AbortController();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    let passes = 0;
    state.observe.mockResolvedValue(undefined); state.deliver.mockResolvedValue(undefined);
    if (fault !== "tick") state[fault].mockRejectedValueOnce(new Error("synthetic transient outage"));
    state.tick.mockImplementation(async () => {
      passes++;
      if (fault === "tick" && passes === 1) throw new Error("synthetic transient outage");
      return { centralDeletedAt: passes >= 3 ? "2030-01-01T00:00:00Z" : null, centralCompactedAt: null };
    });
    state.compact.mockImplementation(async () => { stop.abort(); });
    await runCentralMaintenance({ pocketbaseUrl: "http://127.0.0.1:1", superuserCredentialFile: "synthetic", pollIntervalMs: 1, once: false }, stop.signal);
    expect(state.tick).toHaveBeenCalledTimes(3);
    expect(state.compact).toHaveBeenCalledTimes(1);
    expect(state.clear).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith("maintenance_tick_degraded");
  });
}
it("keeps explicit once-mode failure observable rather than claiming a successful tick", async () => {
  state.tick.mockResolvedValue({ centralDeletedAt: null, centralCompactedAt: null });
  state.observe.mockRejectedValue(new Error("synthetic read failure")); state.deliver.mockResolvedValue(undefined);
  await expect(runCentralMaintenance({ pocketbaseUrl: "http://127.0.0.1:1", superuserCredentialFile: "synthetic", once: true }, new AbortController().signal)).rejects.toMatchObject({ category: "maintenance_failed" });
  expect(state.clear).toHaveBeenCalledTimes(1);
});
