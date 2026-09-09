import { z } from "zod";
import { CHECKIN_STATION_IDS } from "~/lib/checkin-contract";
import type { AgentAdminListDTO, AgentControlResult, AgentIssueCommand, AgentReadinessDTO, AgentRevokeCommand } from "~/lib/checkin-agent-contract";

export type AgentMutation = { operation: "admin_issue"; command: AgentIssueCommand } | { operation: "admin_revoke"; command: AgentRevokeCommand };
const readiness = z.strictObject({
  stationId: z.enum(CHECKIN_STATION_IDS), stationLabel: z.string().max(80), stationVersion: z.number().int().positive(),
  agentId: z.string().min(1).max(80).nullable(), credentialState: z.enum(["not_issued", "active", "expired", "revoked"]),
  credentialExpiresAt: z.string().max(40).nullable(), connection: z.enum(["never_seen", "connected", "stale"]),
  compatibility: z.enum(["unknown", "compatible", "mismatch"]), profile: z.enum(["unconfigured", "unapproved", "approved", "mismatch"]),
  journal: z.enum(["unknown", "healthy", "quarantined"]), stopped: z.boolean(), coordinator: z.enum(["unavailable", "connected"]),
  readyForAuthorization: z.boolean(), operationsEnabled: z.literal(false), reasons: z.array(z.string().regex(/^[a-z_]+$/).max(80)).max(30),
  lastHeartbeatAt: z.string().max(40).nullable(), heartbeatIntervalMs: z.number().int().positive(),
  heartbeatTimeoutMs: z.number().int().positive(), authorizationTtlMs: z.number().int().positive().max(10000),
});
const controlResult = z.strictObject({ actionId: z.string().min(1).max(80), replayed: z.boolean(), station: readiness, credential: z.string().regex(/^wts_agent_[a-f0-9]{64}$/).optional() });

export class CheckinAgentRequestError extends Error {
  constructor(message: string, readonly ambiguous: boolean, readonly retryable = true) { super(message); this.name = "CheckinAgentRequestError"; }
}
async function request<T>(body: object, parse: (value: unknown) => T): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/checkin-agents", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), cache: "no-store", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(10000),
    });
  } catch { throw new CheckinAgentRequestError("Agent service could not be reached. A submitted action may have been saved; retry the same action.", true); }
  if (!response.ok) {
    // Never forward raw diagnostics or response bodies into the admin/operator UI.
    const message = response.status === 403 || response.status === 401 ? "Agent access denied. Verify your current login and role."
      : response.status === 409 ? "Station state changed. Refresh agent readiness before reviewing a new action."
      : response.status === 400 ? "Agent action rejected. Check the station, identity and profile configuration."
      : "Agent service unavailable. Refresh readiness or retry the same submitted action.";
    throw new CheckinAgentRequestError(message, response.status >= 500 || response.status === 408, response.status >= 500 || response.status === 408);
  }
  try { return parse(await response.json()); }
  catch { throw new CheckinAgentRequestError("Agent response was unreadable or did not match the action. Its outcome is unknown; retry the same action.", true); }
}
export const agentAdminList = (): Promise<AgentAdminListDTO> => request({ operation: "admin_list" }, (value) => z.strictObject({ stations: z.array(readiness).length(3) }).parse(value));
export const agentStatus = (): Promise<{ station: AgentReadinessDTO | null }> => request({ operation: "status" }, (value) => z.strictObject({ station: readiness.nullable() }).parse(value));
export function mutateAgent(mutation: AgentMutation): Promise<AgentControlResult> {
  const submitted = structuredClone(mutation);
  return request(submitted, (value) => {
    const result = controlResult.parse(value);
    if (result.station.stationId !== submitted.command.stationId || result.station.stationVersion !== submitted.command.expectedStationVersion + 1) throw new Error("Mismatched station result");
    if (result.replayed && result.credential) throw new Error("Replay exposed a credential");
    if (submitted.operation === "admin_issue") {
      if (result.station.credentialState !== "active" || !result.station.agentId || (!result.replayed && !result.credential)) throw new Error("Mismatched issuance");
    } else if (result.credential || result.station.credentialState !== "revoked" || result.station.agentId !== submitted.command.agentId) throw new Error("Mismatched revocation");
    return result;
  });
}
