import { AgentError } from "./protocol.js";

interface CoordinatorSupervision {
  signal: AbortSignal;
  heartbeatIntervalMs: number;
  pollIntervalMs: number;
  pulse(): Promise<unknown>;
  /** One admission per call: a shutdown must not claim the next item in a batch. */
  processAdmission(): Promise<unknown>;
  dispatchPrints(): Promise<unknown>;
  processReset?(): Promise<unknown>;
}
function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** Keep the ownership lease alive independently of slow upstream work. Stop new
 * claims immediately, drain existing calls, and release ownership only afterward. */
export async function runCoordinatorSupervisor(options: CoordinatorSupervision): Promise<void> {
  for (const value of [options.heartbeatIntervalMs, options.pollIntervalMs]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 60000) throw new AgentError("invalid_config");
  }
  if (options.signal.aborted) return;
  const production = new AbortController();
  const heartbeat = new AbortController();
  let failure: AgentError | undefined;
  const stop = () => production.abort();
  options.signal.addEventListener("abort", stop, { once: true });
  async function work(run: () => Promise<unknown>) {
    while (!production.signal.aborted) {
      try { await run(); }
      catch { failure ??= new AgentError("coordinator_work_failed"); production.abort(); }
      if (!production.signal.aborted) await delay(options.pollIntervalMs, production.signal);
    }
  }
  const heartbeats = (async () => {
    while (!heartbeat.signal.aborted) {
      await delay(options.heartbeatIntervalMs, heartbeat.signal);
      if (heartbeat.signal.aborted) break;
      try { await options.pulse(); }
      catch { failure ??= new AgentError("coordinator_heartbeat_failed"); production.abort(); break; }
    }
  })();
  try { await Promise.all([work(options.processAdmission), work(options.dispatchPrints), ...(options.processReset ? [work(options.processReset)] : [])]); }
  finally {
    heartbeat.abort(); await heartbeats;
    options.signal.removeEventListener("abort", stop);
  }
  if (failure) throw failure;
}
