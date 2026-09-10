import { z } from "zod";
import { CHECKIN_STATION_IDS } from "~/lib/checkin-contract";
import type { CheckinArrivalHistory, CheckinArrivalHistoryQuery, CheckinArrivalInput, CheckinArrivalResult } from "~/lib/checkin-arrival-contract";

const localId = z.string().regex(/^[a-z0-9]{15}$/);
const timestamp = z.string().min(1).max(40);
const workflow = z.strictObject({ id: localId, stationId: z.enum(CHECKIN_STATION_IDS), eventId: localId, eventTitle: z.string().max(300), state: z.enum(["not_submitted", "admission_pending", "accepted", "existing_unattributed", "rejected", "admission_uncertain"]), name: z.string().max(300), affiliation: z.string().max(300), profileId: z.string().min(1).max(100), createdAt: timestamp });
const variants = [
  z.strictObject({ state: z.enum(["reserved", "existing"]), workflow }),
  z.strictObject({ state: z.literal("accepted"), workflow, printIntentId: localId }),
  z.strictObject({ state: z.enum(["admission_pending", "admission_uncertain", "existing_unattributed"]), workflow }),
  z.strictObject({ state: z.literal("already_handled") }),
  z.strictObject({ state: z.literal("rejected"), reason: z.enum(["invalid_identity", "not_in_list", "cancelled", "awaiting_payment", "unknown_eligibility", "already_checked_in"]) }),
  z.strictObject({ state: z.literal("dependency_unavailable") }),
  z.strictObject({ state: z.literal("needs_affiliation_choice") }),
] as const;
const decision = z.discriminatedUnion("state", variants);
const envelope = { operationId: z.uuid(), replayed: z.boolean(), operationsEnabled: z.literal(false) };
const resultSchema = z.discriminatedUnion("state", [
  variants[0].extend(envelope), variants[1].extend(envelope), variants[2].extend(envelope),
  variants[3].extend(envelope), variants[4].extend(envelope), variants[5].extend(envelope), variants[6].extend(envelope),
]);
const historySchema = z.strictObject({
  items: z.array(z.strictObject({ id: localId, operationId: z.uuid(), stationId: z.enum(CHECKIN_STATION_IDS), eventId: localId, createdAt: timestamp, completedAt: timestamp.nullable(), resolvedByOperationId: z.uuid().optional(), result: decision })).max(100),
  nextCursor: z.string().max(200).nullable(), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), operationsEnabled: z.literal(false),
});

export class CheckinArrivalRequestError extends Error {
  constructor(message: string, readonly ambiguous: boolean) { super(message); this.name = "CheckinArrivalRequestError"; }
}
async function request<T>(body: object, parse: (value: unknown) => T): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/checkin-arrivals", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(30000) });
  } catch { throw new CheckinArrivalRequestError("Arrival service could not be reached. The preflight may have been saved; retry the same preflight.", true); }
  if (!response.ok) {
    const message = response.status === 401 || response.status === 403 ? "Arrival access denied. Verify your current login, role and station binding."
      : response.status === 409 ? "Arrival context or command conflicts with current state. Refresh context before intentionally starting a new attempt."
      : response.status === 400 ? "Arrival command rejected. Check the exact QR identity and event context."
      : "Arrival service unavailable. Retry the same preflight.";
    throw new CheckinArrivalRequestError(message, response.status >= 500 || response.status === 408);
  }
  try { return parse(await response.json()); }
  catch { throw new CheckinArrivalRequestError("Arrival response was unreadable or did not match the command. The preflight may have been saved; retry the same preflight.", true); }
}
/** Clone before yielding: caller edits cannot change the request or its expected identity. */
export function preflightCheckinArrival(command: CheckinArrivalInput): Promise<CheckinArrivalResult> {
  const submitted = structuredClone(command);
  return request({ operation: "preflight", command: submitted }, (value) => {
    const result = resultSchema.parse(value);
    if (result.operationId !== submitted.operationId) throw new Error("Mismatched operation");
    if ((result.state === "reserved" || result.state === "existing") && (result.workflow.eventId !== submitted.context.eventId || result.workflow.stationId !== submitted.context.stationId)) throw new Error("Mismatched originating context");
    return result;
  });
}
export function checkinArrivalHistory(query: CheckinArrivalHistoryQuery = {}): Promise<CheckinArrivalHistory> {
  return request({ operation: "history", query: structuredClone(query) }, (value) => {
    const result = historySchema.parse(value);
    for (const item of result.items) {
      if (item.resolvedByOperationId && (!item.completedAt || !["needs_affiliation_choice", "dependency_unavailable"].includes(item.result.state))) throw new Error("Invalid exception resolution");
      if ((item.result.state === "reserved" || item.result.state === "existing") && (item.result.workflow.stationId !== item.stationId || item.result.workflow.eventId !== item.eventId)) throw new Error("Mismatched history context");
    }
    return result;
  });
}
