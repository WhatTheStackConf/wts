import { createHash } from "node:crypto";
import type PocketBase from "pocketbase";
import type { CheckinActor } from "~/lib/checkin-contract";
import type { MonitoringDashboard, MonitoringConfig, MonitoringConfigureCommand, MonitoringServiceContract } from "~/lib/checkin-monitoring-contract";
import type { CheckinErrorCode } from "~/lib/checkin-contract";
import { CheckinError, isCheckinStaff, pocketBaseFailure } from "~/lib/checkin-service";
const forwarded: readonly CheckinErrorCode[] = ["forbidden", "invalid_input", "conflict"];
export class CheckinMonitoringService implements MonitoringServiceContract {
  constructor(private readonly pb: PocketBase, private readonly actor: CheckinActor) {}
  private hash(token?: string | null) {
    if (!token) return "";
    if (!/^[a-f0-9]{64}$/.test(token)) throw new CheckinError("invalid_binding", 400);
    return createHash("sha256").update(`wts2026:binding:${token}`).digest("hex");
  }
  private async request<T>(operation: string, data: object = {}): Promise<T> {
    if (!isCheckinStaff(this.actor) || (operation === "configure" && this.actor.role !== "admin")) throw new CheckinError("forbidden", 403);
    try { return await this.pb.send<T>("/api/wts/checkin-monitoring", { method: "POST", body: { ...data, operation, actorUserId: this.actor.userId }, requestKey: null }); }
    catch (error) {
      const { code, status } = pocketBaseFailure(error);
      if (forwarded.includes(code as CheckinErrorCode)) throw new CheckinError(code as CheckinErrorCode, status || 400);
      throw new CheckinError("unavailable", 503);
    }
  }
  dashboard(token?: string | null, offset = 0): Promise<MonitoringDashboard> { return this.request("dashboard", { identityHash: this.hash(token), offset }); }
  configure(command: MonitoringConfigureCommand): Promise<MonitoringConfig> { return this.request("configure", { command }); }
  acknowledge(incidentId: string, token?: string | null): Promise<{ incidentId: string; acknowledgedMs: number }> { return this.request("acknowledge", { incidentId, identityHash: this.hash(token) }); }
}
