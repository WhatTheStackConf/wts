import type { Coordinator } from "./coordinator.js";
import { runCoordinatorSupervisor } from "./supervision.js";
import { pause } from "./central-maintenance.js";
import { AgentError, type AdmissionProcessor, type ResetTransport } from "./protocol.js";

/** Heartbeat remains independent of admission latency. A lease failure is NOT
 * takeover permission: only a trusted lifecycle read permits reporting mode. */
export async function superviseCentralCoordinator(coordinator: Coordinator, options: { signal: AbortSignal; heartbeatIntervalMs: number; pollIntervalMs: number; admission?: AdmissionProcessor; reset?: ResetTransport; reportingOnly: boolean }): Promise<void> {
  if (!options.reportingOnly) {
    try {
      await runCoordinatorSupervisor({ ...options,
        pulse: () => coordinator.pulse(),
        processAdmission: async () => { if (options.admission) await coordinator.processAdmissions(options.admission, 1); },
        dispatchPrints: () => coordinator.claimPrints(),
        processReset: async () => { if (options.reset) await coordinator.processResets(options.reset, 1); },
      });
    } catch (error) {
      if (options.signal.aborted) return;
      try { await coordinator.enterReportingOnly(); }
      catch { throw error instanceof AgentError ? error : new AgentError("coordinator_work_failed"); }
    }
  }
  if (!options.signal.aborted) console.log("coordinator_reporting_only");
  // Deliberately never reacquire, even after restore approval.
  while (!options.signal.aborted) await pause(60000, options.signal);
}
