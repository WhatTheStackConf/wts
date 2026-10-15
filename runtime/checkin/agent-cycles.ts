import { AgentError } from "./protocol.js";

export function waitForAgent(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}
interface AgentCycles {
  signal: AbortSignal;
  intervalMs: number;
  reconnect: boolean;
  once?: boolean;
  /** Every invocation must reconcile the durable journal before fresh work. */
  cycle(): Promise<void>;
  report(category: string): void;
  pause?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
}
/** The report category for a retryable cycle failure, or null when it stays terminal. */
function reconnectCategory(error: unknown, options: AgentCycles): string | null {
  if (!options.reconnect || options.once || !(error instanceof AgentError)) return null;
  if (["device_missing", "device_ambiguous"].includes(error.category)) return error.category;
  return ["network_unavailable", "coordinator_unavailable"].includes(error.category) ? "agent_reconnecting" : null;
}
/** Retry the recovery-first polling cycle, never an individual print/mutation.
 * Permanent protocol, credential, journal and lifecycle failures stay terminal. */
export async function runAgentCycles(options: AgentCycles): Promise<void> {
  let failures = 0;
  const pause = options.pause ?? waitForAgent;
  while (!options.signal.aborted) {
    let delay = options.intervalMs;
    try { await options.cycle(); failures = 0; }
    catch (error) {
      if (options.signal.aborted) break;
      const category = reconnectCategory(error, options);
      if (category === null) throw error;
      failures = Math.min(failures + 1, 7);
      delay = Math.min(30000, 500 * 2 ** failures) * (0.75 + (options.random ?? Math.random)() * 0.25);
      options.report(category);
    }
    if (options.once || options.signal.aborted) break;
    await pause(delay, options.signal);
  }
}
