import type PocketBase from "pocketbase";
import type { AgentReadinessDTO } from "./checkin-agent-contract.js";
import type { MonitoringMail, MonitoringOutcome } from "./checkin-monitoring-contract.js";
export interface MonitoringWorkerOptions {
  /** Use the existing CheckinAgentService.adminList().stations projection. */
  readReadiness(): Promise<AgentReadinessDTO[]>;
  now?: () => number;
  /** Test/alternate transport seam. Throw means unknown, NEVER definitely failed.
   * Return failed only with positive evidence no email was accepted. */
  transport?: (mail: MonitoringMail) => Promise<MonitoringOutcome>;
  deliveryLimit?: number;
}
/** Independently supervised tick; not a web-request/cron-owned worker.
 * Server-only PB superuser client. No admission coordinator lease needed. */
export class CheckinMonitoringWorker {
  constructor(private readonly pb: PocketBase, private readonly options: MonitoringWorkerOptions) {}
  private request<T>(operation: string, data: object = {}): Promise<T> {
    return this.pb.send<T>("/api/wts/checkin-monitoring", { method: "POST", body: { ...data, operation, nowMs: (this.options.now || Date.now)() }, requestKey: null });
  }
  async observe(): Promise<{ observed: boolean }> {
    // Reserve centrally before the asynchronous snapshot. Client clocks cannot
    // establish ordering between competing workers (or delayed HTTP requests).
    const { observationSequence } = await this.request<{ observationSequence: number }>("machine_observe_begin");
    const readiness = await this.options.readReadiness();
    // Only authority boolean + bounded station identity cross the storage seam.
    return this.request("machine_tick", { observationSequence, readiness: readiness.map((s) => ({ stationId: s.stationId, readyForAuthorization: s.readyForAuthorization })) });
  }
  /** Separately callable so delivery can continue while a readiness read fails. */
  async deliver(): Promise<{ claimed: number; sent: number; failed: number; unknown: number }> {
    const totals = { claimed: 0, sent: 0, failed: 0, unknown: 0 };
    const limit = Math.min(100, Math.max(1, this.options.deliveryLimit || 10));
    for (let n = 0; n < limit; n++) {
      // A lost claim response leaves possibly_sent; it is not reclaimed on restart.
      const { job } = await this.request<{ job: MonitoringMail | null }>("machine_claim");
      if (!job) break;
      totals.claimed++;
      let outcome: MonitoringOutcome = "unknown";
      try {
        if (this.options.transport) outcome = await this.options.transport(job);
        else outcome = (await this.request<{ outcome: MonitoringOutcome }>("machine_send", { deliveryId: job.deliveryId, claimToken: job.claimToken })).outcome;
        if (!["sent", "failed", "unknown"].includes(outcome)) outcome = "unknown";
      } catch { /* Never retain raw provider diagnostics or retry the envelope. */ }
      // A production send endpoint persists its own result. If its HTTP response
      // was lost, do not overwrite its known result with our unknown observation.
      if (this.options.transport) await this.request("machine_result", { deliveryId: job.deliveryId, claimToken: job.claimToken, outcome });
      totals[outcome]++;
    }
    return totals;
  }
  async tick() { const observation = await this.observe(); return { ...observation, ...await this.deliver() }; }
}
