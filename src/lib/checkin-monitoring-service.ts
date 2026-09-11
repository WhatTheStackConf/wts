import { createHash } from "node:crypto";
import type PocketBase from "pocketbase";
import type { CheckinActor } from "~/lib/checkin-contract";
import type { MonitoringDashboard, MonitoringConfig, MonitoringConfigureCommand, MonitoringServiceContract } from "~/lib/checkin-monitoring-contract";
import { CheckinError } from "~/lib/checkin-service";
export class CheckinMonitoringService implements MonitoringServiceContract {
  constructor(private readonly pb: PocketBase, private readonly actor: CheckinActor) {}
  private hash(token?: string | null) {
    if (!token) return "";
    if (!/^[a-f0-9]{64}$/.test(token)) throw new CheckinError("invalid_binding", 400);
    return createHash("sha256").update(`wts2026:binding:${token}`).digest("hex");
  }
  private async request<T>(operation: string, data: object = {}): Promise<T> {
    if (!this.actor?.userId || !["admin", "checkin_operator"].includes(this.actor.role) || (operation === "configure" && this.actor.role !== "admin")) throw new CheckinError("forbidden", 403);
    try { return await this.pb.send<T>("/api/wts/checkin-monitoring", { method: "POST", body: { ...data, operation, actorUserId: this.actor.userId }, requestKey: null }); }
    catch (error) {
      const e = error as { status?: number; response?: { data?: { code?: { code?: string } | string } } };
      const field = e.response?.data?.code; const code = typeof field === "string" ? field : field?.code;
      if (code === "forbidden" || code === "invalid_input" || code === "conflict") throw new CheckinError(code, e.status || 400);
      throw new CheckinError("unavailable", 503);
    }
  }
  dashboard(token?: string | null, offset = 0): Promise<MonitoringDashboard> { return this.request("dashboard", { identityHash: this.hash(token), offset }); }
  configure(command: MonitoringConfigureCommand): Promise<MonitoringConfig> { return this.request("configure", { command }); }
  acknowledge(incidentId: string, token?: string | null): Promise<{ incidentId: string; acknowledgedMs: number }> { return this.request("acknowledge", { incidentId, identityHash: this.hash(token) }); }
}
