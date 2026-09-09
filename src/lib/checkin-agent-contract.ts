import type { CheckinActor, CheckinReasonCode, CheckinStationId } from "~/lib/checkin-contract";
export interface AgentReadinessDTO {
  stationId: CheckinStationId; stationLabel: string; stationVersion: number; agentId: string | null;
  credentialState: "not_issued" | "active" | "expired" | "revoked"; credentialExpiresAt: string | null;
  connection: "never_seen" | "connected" | "stale"; compatibility: "unknown" | "compatible" | "mismatch";
  profile: "unconfigured" | "unapproved" | "approved" | "mismatch"; journal: "unknown" | "healthy" | "quarantined";
  stopped: boolean; coordinator: "unavailable" | "connected"; readyForAuthorization: boolean; operationsEnabled: false;
  reasons: string[]; lastHeartbeatAt: string | null; heartbeatIntervalMs: number; heartbeatTimeoutMs: number; authorizationTtlMs: number;
}
export interface AgentAdminListDTO { stations: AgentReadinessDTO[] }
export interface AgentIssueCommand {
  operationId: string; stationId: CheckinStationId; expectedStationVersion: number; reason: CheckinReasonCode; note: string;
  agentIdentity: string; printerIdentity: string; journalIdentity: string; profileId: string; credentialLifetimeHours: number;
}
export interface AgentRevokeCommand { operationId: string; stationId: CheckinStationId; expectedStationVersion: number; reason: CheckinReasonCode; note: string; agentId: string }
export interface AgentControlResult { actionId: string; replayed: boolean; station: AgentReadinessDTO; credential?: string }
export interface CheckinAgentServiceContract {
  status(bindingToken?: string | null): Promise<{ station: AgentReadinessDTO | null }>;
  adminList(): Promise<AgentAdminListDTO>;
  issue(command: AgentIssueCommand): Promise<AgentControlResult>;
  revoke(command: AgentRevokeCommand): Promise<AgentControlResult>;
}
export type AgentActor = CheckinActor;
