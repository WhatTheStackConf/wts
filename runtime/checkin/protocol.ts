export interface AgentIdentity {
  stationId: string;
  agentIdentity: string;
  printerIdentity: string;
  journalIdentity: string;
  profileId: string;
}
export type JournalState = "healthy" | "lost" | "corrupt" | "restored";
export type Operation = "heartbeat" | "status" | "work" | "authorize" | "start" | "outcome";
export interface Work { attemptId: string; profileId: string; payloadHash: string }
export interface Authorization {
  attemptId: string; stationId: string; agentId: string; payloadHash: string; expiresAt: string;
  stationGeneration: number; systemGeneration: number; coordinatorGeneration: number;
}
export type Outcome = "output_uncertain" | "protocol_complete";
export interface JournalAttempt extends Work {
  state: "received" | "authorized" | "possibly_starting" | "started" | "reported";
  authorizationHash?: string;
  authorization?: Authorization;
  reportUntil?: string;
  outcome?: Outcome;
}
export interface AdmissionJob {
  attemptId: string; workflowId: string; commandId: string; stationId: string; eventId: string;
  sourceKey: string; upstreamEventId: string; upstreamAttendeeId: string; upstreamListId: string;
  context: Record<string, unknown>; affiliation: Record<string, unknown> | null; coordinatorGeneration: number;
}
export interface AdmissionAttendee {
  upstreamAttendeeId: string; publicId: string; productId: string; alreadyCheckedIn: boolean; listCapability?: string;
  eligibility?: "eligible" | "not_in_list" | "cancelled" | "awaiting_payment" | "unknown_eligibility";
}
export type AdmissionOutcome =
  | { state: "newly_checked_in"; fingerprint: string }
  | { state: "existing_unattributed"; fingerprint: string }
  | { state: "rejected"; reason: "not_in_list" | "cancelled" | "awaiting_payment" | "unknown_eligibility" }
  | { state: "uncertain" };
export interface AdmissionProcessor {
  attendee(job: AdmissionJob): Promise<AdmissionAttendee | null>;
  admit(job: AdmissionJob, attendee: AdmissionAttendee): Promise<AdmissionOutcome>;
}
export interface AgentReadinessDTO {
  stationId: string; stationLabel: string; stationVersion: number; agentId: string | null;
  credentialState: "not_issued" | "active" | "expired" | "revoked"; credentialExpiresAt: string | null;
  connection: "never_seen" | "connected" | "stale"; compatibility: "unknown" | "compatible" | "mismatch";
  profile: "unconfigured" | "unapproved" | "approved" | "mismatch"; journal: "unknown" | "healthy" | "quarantined";
  stopped: boolean; coordinator: "unavailable" | "connected"; readyForAuthorization: boolean; operationsEnabled: false;
  reasons: string[]; lastHeartbeatAt: string | null; heartbeatIntervalMs: number; heartbeatTimeoutMs: number; authorizationTtlMs: number;
}
export class AgentError extends Error {
  constructor(public readonly category: string, public readonly retryable = false, public readonly retryAfterMs = 0) { super(category); this.name = "AgentError"; }
}
export function journalFailureState(error: unknown): Exclude<JournalState, "healthy"> {
  if (error instanceof AgentError && error.category === "journal_lost") return "lost";
  if (error instanceof AgentError && error.category === "journal_restored") return "restored";
  return "corrupt";
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AgentError("invalid_response");
  return value as Record<string, unknown>;
}
export function validIdentity(value: unknown): AgentIdentity {
  const v = object(value);
  if (Object.keys(v).length !== 5 || !["stationId", "agentIdentity", "printerIdentity", "journalIdentity", "profileId"].every(k => (k === "profileId" && v[k] === "" || typeof v[k] === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(v[k] as string)))) throw new AgentError("invalid_identity");
  return v as unknown as AgentIdentity;
}
export function validWork(value: unknown): Work {
  const v = object(value);
  if (Object.keys(v).length !== 3 || typeof v.attemptId !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(v.attemptId) || typeof v.profileId !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(v.profileId) || typeof v.payloadHash !== "string" || !/^[a-f0-9]{64}$/.test(v.payloadHash)) throw new AgentError("invalid_response");
  return v as unknown as Work;
}
export function safeUrl(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new AgentError("invalid_config"); }
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)))) throw new AgentError("invalid_config");
  return url;
}
