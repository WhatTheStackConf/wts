import type { CheckinStationId } from "~/lib/checkin-contract";
import type { CheckinEventContext } from "~/lib/checkin-event-contract";

/** Browser-safe, preflight-only protocol. QR stays in request memory, never history. */
export interface CheckinArrivalInput {
  operationId: string;
  context: CheckinEventContext;
  qrIdentity: string;
  affiliationChoice: "fetch" | "blank";
  /** New UUID required for an explicit retry/blank continuation of a failed read. */
  priorOperationId?: string;
}
export type CheckinArrivalRejection = "invalid_identity" | "not_in_list" | "cancelled" | "awaiting_payment" | "unknown_eligibility" | "already_checked_in";
export interface CheckinArrivalWorkflow {
  id: string;
  stationId: CheckinStationId;
  eventId: string;
  eventTitle: string;
  state: "not_submitted" | "admission_pending" | "accepted" | "existing_unattributed" | "rejected" | "admission_uncertain";
  name: string;
  affiliation: string;
  profileId: string;
  createdAt: string;
}
export type CheckinArrivalDecision =
  | { state: "reserved" | "existing"; workflow: CheckinArrivalWorkflow }
  | { state: "accepted"; workflow: CheckinArrivalWorkflow; printIntentId: string }
  | { state: "admission_pending" | "admission_uncertain" | "existing_unattributed"; workflow: CheckinArrivalWorkflow }
  | { state: "already_handled" }
  | { state: "rejected"; reason: CheckinArrivalRejection }
  | { state: "dependency_unavailable" }
  | { state: "needs_affiliation_choice" };
export type CheckinArrivalResult = CheckinArrivalDecision & {
  operationId: string;
  replayed: boolean;
  operationsEnabled: false;
};
export interface CheckinArrivalHistoryQuery {
  /** Defaults to the bound station; all stations requires live admin authority. */
  scope?: "station" | "all";
  cursor?: string;
  limit?: number;
}
export interface CheckinArrivalHistoryEntry {
  id: string;
  operationId: string;
  stationId: CheckinStationId;
  eventId: string;
  createdAt: string;
  completedAt: string | null;
  /** Derived from an audited terminal continuation; result remains the original
   * immutable decision. Display this exception as resolved, not actionable. */
  resolvedByOperationId?: string;
  result: CheckinArrivalDecision;
}
export interface CheckinArrivalHistory {
  items: CheckinArrivalHistoryEntry[];
  nextCursor: string | null;
  /** Server-local Europe/Skopje day; all unresolved work is included regardless of day. */
  day: string;
  operationsEnabled: false;
}

export interface CheckinArrivalServiceContract {
  preflight(bindingToken: string | undefined, input: CheckinArrivalInput): Promise<CheckinArrivalResult>;
  history(bindingToken: string | undefined, query?: CheckinArrivalHistoryQuery): Promise<CheckinArrivalHistory>;
}
