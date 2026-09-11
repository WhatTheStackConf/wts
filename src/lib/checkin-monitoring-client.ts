import type { MonitoringConfigureCommand, MonitoringDashboard } from "~/lib/checkin-monitoring-contract";
import { monitoringAdminSchema, monitoringOperatorSchema, monitoringConfigSchema, monitoringCommandSchema, monitoringAckSchema } from "~/lib/checkin-monitoring-validation";
export class CheckinMonitoringRequestError extends Error {
  constructor(message: string, readonly ambiguous: boolean, readonly status?: number) { super(message); this.name = "CheckinMonitoringRequestError"; }
}
async function request<T>(body: object, parse: (value: unknown) => T): Promise<T> {
  let response: Response;
  try { response = await fetch("/api/checkin-monitoring", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(10000) }); }
  catch { throw new CheckinMonitoringRequestError("Monitoring service unavailable. A submitted change may have been saved; retry the same action.", true); }
  if (!response.ok) throw new CheckinMonitoringRequestError(response.status === 401 || response.status === 403 ? "Monitoring access denied. Verify your current login and role." : response.status === 409 ? "Monitoring configuration changed. Refresh before reviewing a new action." : response.status === 400 ? "Monitoring command rejected. Check the thresholds and designated admins." : "Monitoring service unavailable. Retry the same action.", response.status >= 500 || response.status === 408, response.status);
  try { return parse(await response.json()); }
  catch { throw new CheckinMonitoringRequestError("Monitoring response unreadable or mismatched. A submitted change may have been saved; retry the same action.", true); }
}
/** Expected audience is a response privacy fence, not authorization. Server verifies current role. */
export function monitoringDashboard(audience: "admin" | "operator", offset = 0): Promise<MonitoringDashboard> {
  return request({ operation: "dashboard", offset }, (v) => (audience === "admin" ? monitoringAdminSchema : monitoringOperatorSchema).parse(v));
}
export function configureMonitoring(command: MonitoringConfigureCommand) {
  const submitted = monitoringCommandSchema.parse(structuredClone(command));
  return request({ operation: "configure", command: submitted }, (v) => {
    const r = monitoringConfigSchema.parse(v);
    if (r.version !== submitted.expectedVersion + 1 || r.waitingMs !== submitted.waitingMs || r.incidentMs !== submitted.incidentMs || r.repeatMs !== submitted.repeatMs || JSON.stringify(r.recipientUserIds) !== JSON.stringify(submitted.recipientUserIds)) throw new Error();
    return r;
  });
}
export function acknowledgeMonitoring(incidentId: string) {
  return request({ operation: "acknowledge", incidentId }, (v) => { const r = monitoringAckSchema.parse(v); if (r.incidentId !== incidentId) throw new Error(); return r; });
}
