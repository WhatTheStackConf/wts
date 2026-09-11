import { afterEach, expect, it, vi } from "vite-plus/test";
import { runCoordinatorSupervisor } from "../../runtime/checkin/supervision";

afterEach(() => vi.useRealTimers());
it("keeps heartbeats and print dispatch alive while a slow admission is in flight", async () => {
  vi.useFakeTimers();
  const stop = new AbortController();
  let release!: () => void;
  let admissionCalls = 0, pulses = 0, dispatches = 0;
  const admission = new Promise<void>(resolve => { release = resolve; });
  const running = runCoordinatorSupervisor({
    signal: stop.signal, heartbeatIntervalMs: 5000, pollIntervalMs: 1000,
    pulse: async () => { pulses++; },
    processAdmission: async () => { admissionCalls++; await admission; },
    dispatchPrints: async () => { dispatches++; },
  });
  await vi.advanceTimersByTimeAsync(16000);
  expect(admissionCalls).toBe(1);
  expect(pulses).toBe(3);
  expect(dispatches).toBeGreaterThan(1);
  stop.abort();
  const beforeStop = dispatches;
  await vi.advanceTimersByTimeAsync(5000);
  expect(dispatches).toBe(beforeStop);
  expect(pulses).toBe(4); // Keep the lease alive while draining in-flight admission.
  release(); await running;
  expect(vi.getTimerCount()).toBe(0);
});
it("does not overlap heartbeat calls and stops production on heartbeat failure", async () => {
  vi.useFakeTimers();
  const stop = new AbortController();
  let rejectPulse!: (error: Error) => void;
  let pulses = 0, claims = 0;
  const pending = new Promise<void>((_resolve, reject) => { rejectPulse = reject; });
  const running = runCoordinatorSupervisor({
    signal: stop.signal, heartbeatIntervalMs: 100, pollIntervalMs: 100,
    pulse: async () => { pulses++; await pending; },
    processAdmission: async () => { claims++; }, dispatchPrints: async () => undefined,
  });
  const failure = expect(running).rejects.toThrow("coordinator_heartbeat_failed");
  await vi.advanceTimersByTimeAsync(500);
  expect(pulses).toBe(1);
  rejectPulse(new Error("private upstream diagnostic"));
  await vi.advanceTimersByTimeAsync(0); await failure;
  const before = claims; await vi.advanceTimersByTimeAsync(500);
  expect(claims).toBe(before); expect(vi.getTimerCount()).toBe(0);
});
it("never starts work for an already stopped supervisor", async () => {
  const stop = new AbortController(); stop.abort();
  const work = vi.fn(async () => undefined);
  await runCoordinatorSupervisor({ signal: stop.signal, heartbeatIntervalMs: 100, pollIntervalMs: 100, pulse: work, processAdmission: work, dispatchPrints: work });
  expect(work).not.toHaveBeenCalled();
});
