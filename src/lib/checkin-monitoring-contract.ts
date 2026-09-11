import type { CheckinStationId } from "./checkin-contract.js";
export type MonitoringCategory = "station_unavailable" | "work_stalled" | "admission_uncertain" | "output_uncertain";
export type MonitoringOutcome = "sent" | "failed" | "unknown";
export interface MonitoringConfig { version: number; waitingMs: number; incidentMs: number; repeatMs: number; recipientUserIds: string[] }
export interface MonitoringConfigureCommand { operationId: string; expectedVersion: number; waitingMs: number; incidentMs: number; repeatMs: number; recipientUserIds: string[] }
export interface MonitoringIncident {
  id: string; stationId: CheckinStationId; workflowId: string | null; category: MonitoringCategory;
  sinceMs: number; openedMs: number; recoveredMs: number; acknowledgedMs: number; nextDeliveryMs: number;
  delivery: "none" | "pending" | "possibly_sent" | "sent" | "failed" | "unknown" | "cancelled";
  deliveryKind: "open" | "repeat" | "recovery" | null;
  nextAction: "configure_recipients" | "investigate_delivery_no_retry" | "await_worker" | "none" | "wait_for_repeat";
}
export interface MonitoringDashboard {
  scope: "all" | "unbound" | CheckinStationId; lastTickMs: number; recipientsConfigured: boolean; hasMore: boolean; incidents: MonitoringIncident[];
  config?: MonitoringConfig; adminChoices?: { id: string; email: string }[];
  audit?: { category: string; incidentId: string; deliveryId: string; actorUserId: string; atMs: number }[];
}
export interface MonitoringServiceContract {
  dashboard(bindingToken?: string | null, offset?: number): Promise<MonitoringDashboard>;
  configure(command: MonitoringConfigureCommand): Promise<MonitoringConfig>;
  acknowledge(incidentId: string, bindingToken?: string | null): Promise<{ incidentId: string; acknowledgedMs: number }>;
}
/** Privileged worker-only envelope; NEVER forward this DTO to browser/history. */
export interface MonitoringMail { deliveryId: string; claimToken: string; incidentId: string; kind: "open" | "repeat" | "recovery"; subject: string; text: string; recipients: string[] }
