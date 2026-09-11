import { createHash } from "node:crypto";

export interface AgentIdentity {
  stationId: string;
  agentIdentity: string;
  printerIdentity: string;
  journalIdentity: string;
  profileId: string;
}
export type JournalState = "healthy" | "lost" | "corrupt" | "restored";
export type Operation = "policy" | "purge_complete" | "heartbeat" | "status" | "work" | "ack" | "authorize" | "start" | "outcome" | "cancellations" | "neutralized";
export interface PrintPayload {
  purpose: "initial" | "replacement";
  text: { name: string; affiliation: string };
  profile: Record<string, unknown>;
  rendererVersion: string;
  fontVersion: string;
  pngBase64?: string;
}
export interface Work { attemptId: string; profileId: string; payloadHash: string; payload?: PrintPayload }
export interface Authorization {
  attemptId: string; stationId: string; agentId: string; payloadHash: string; expiresAt: string;
  stationGeneration: number; systemGeneration: number; coordinatorGeneration: number;
}
export type Outcome = "output_uncertain" | "protocol_complete";
export interface JournalAttempt extends Work {
  state: "received" | "authorized" | "possibly_starting" | "started" | "possibly_printing" | "reported" | "cancelled";
  cancellation?: { cancellationId: string; disposition: "neutralized" | "settled"; acknowledged: boolean; startState?: "not_started" };
  authorizationHash?: string;
  authorization?: Authorization;
  reportUntil?: string;
  outcome?: Outcome;
}
export interface Cancellation { cancellationId: string; work: Work; startState?: "not_started" | "started" }
export interface ResetJob {
  workflowId: string; sourceKey: string; upstreamEventId: string; upstreamListId: string;
  upstreamAttendeeId: string; resetId: string; checkinId: string; fingerprint: string;
}
export type ResetOutcome = "deleted" | "uncertain" | "identity_changed";
/** Invoke once after fresh exact identity/fingerprint inspection, immediately before DELETE.
 * Rejection (including response loss) forbids DELETE. Never retry a grant or DELETE. */
export type BeforeResetDelete = () => Promise<void>;
export interface ResetTransport { reset(job: ResetJob, beforeDelete: BeforeResetDelete): Promise<ResetOutcome> }
export function validResetJob(value: unknown): ResetJob {
  const v = object(value);
  const ids = ["workflowId", "resetId"], hashes = ["sourceKey", "fingerprint"], upstream = ["upstreamEventId", "upstreamListId", "upstreamAttendeeId", "checkinId"];
  if (Object.keys(v).length !== 8 || !ids.every(k => typeof v[k] === "string" && /^[a-z0-9]{15}$/.test(v[k] as string)) || !hashes.every(k => typeof v[k] === "string" && /^[a-f0-9]{64}$/.test(v[k] as string)) || !upstream.every(k => typeof v[k] === "string" && /^[1-9][0-9]{0,15}$/.test(v[k] as string) && Number.isSafeInteger(Number(v[k])))) throw new AgentError("invalid_response");
  return v as unknown as ResetJob;
}
export function validCancellation(value: unknown): Cancellation {
  const v = object(value);
  if (!Object.keys(v).every(key => ["cancellationId", "work", "startState"].includes(key)) || typeof v.cancellationId !== "string" || !/^[a-z0-9]{15}$/.test(v.cancellationId)) throw new AgentError("invalid_response");
  if (v.startState !== undefined && v.startState !== "not_started" && v.startState !== "started") throw new AgentError("invalid_response");
  return { cancellationId: v.cancellationId, work: validWork(v.work), ...(v.startState ? { startState: v.startState } : {}) };
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
  const keys = Object.keys(v);
  if (!keys.every((key) => ["attemptId", "profileId", "payloadHash", "payload"].includes(key)) || (keys.length !== 3 && keys.length !== 4) || typeof v.attemptId !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(v.attemptId) || typeof v.profileId !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(v.profileId) || typeof v.payloadHash !== "string" || !/^[a-f0-9]{64}$/.test(v.payloadHash)) throw new AgentError("invalid_response");
  if (v.payload !== undefined) {
    const payload = validPrintPayload(v.payload);
    if (printPayloadHash(v.profileId as string, payload) !== v.payloadHash) throw new AgentError("payload_hash_mismatch");
  }
  return v as unknown as Work;
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
export function printPayloadHash(profileId: string, payload: PrintPayload): string {
  return createHash("sha256").update(canonical({ profileId, payload })).digest("hex");
}
export function validPrintPayload(value: unknown): PrintPayload {
  const v = object(value); const text = object(v.text); const profile = object(v.profile);
  if (!Object.keys(v).every((key) => ["purpose", "text", "profile", "rendererVersion", "fontVersion", "pngBase64"].includes(key)) || (Object.keys(v).length !== 5 && Object.keys(v).length !== 6) || !["initial", "replacement"].includes(String(v.purpose)) || Object.keys(text).length !== 2 || typeof text.name !== "string" || !text.name.trim() || text.name.length > 200 || typeof text.affiliation !== "string" || text.affiliation.length > 200 || Object.keys(profile).length > 32 || typeof v.rendererVersion !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(v.rendererVersion) || typeof v.fontVersion !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(v.fontVersion) || (v.pngBase64 !== undefined && (typeof v.pngBase64 !== "string" || !/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(v.pngBase64) || v.pngBase64.length > 12_000_000)) || JSON.stringify(profile).length > 8192) throw new AgentError("invalid_response");
  return v as unknown as PrintPayload;
}
export function safeUrl(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new AgentError("invalid_config"); }
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)))) throw new AgentError("invalid_config");
  return url;
}
