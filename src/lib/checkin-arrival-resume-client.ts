import { z } from "zod";
import { CHECKIN_STATION_IDS } from "~/lib/checkin-contract";
import type { CheckinArrivalResult } from "~/lib/checkin-arrival-contract";
import { checkinArrivalResumeSchema, checkinArrivalResumeInputSchema, checkinArrivalResumeOperationIdSchema, type CheckinArrivalResumeInput, type CheckinArrivalResume } from "~/lib/checkin-arrival-resume-contract";
import { CheckinArrivalRequestError } from "~/lib/checkin-arrival-client";

const localId = z.string().regex(/^[a-z0-9]{15}$/);
const timestamp = z.string().min(1).max(40);
const workflow = z.strictObject({ id: localId, stationId: z.enum(CHECKIN_STATION_IDS), eventId: localId, eventTitle: z.string().max(300), state: z.enum(["not_submitted", "admission_pending", "accepted", "existing_unattributed", "rejected", "admission_uncertain"]), printState: z.enum(["queued", "dispatched", "completed", "uncertain", "cancelled"]).nullable().optional(), name: z.string().max(300), affiliation: z.string().max(300), profileId: z.string().min(1).max(100), createdAt: timestamp });
const variants = [
  z.strictObject({ state: z.enum(["reserved", "existing"]), workflow }),
  z.strictObject({ state: z.literal("accepted"), workflow, printIntentId: localId }),
  z.strictObject({ state: z.enum(["admission_pending", "admission_uncertain", "existing_unattributed"]), workflow }),
  z.strictObject({ state: z.literal("already_handled") }),
  z.strictObject({ state: z.literal("rejected"), reason: z.enum(["invalid_identity", "not_in_list", "cancelled", "awaiting_payment", "unknown_eligibility", "already_checked_in"]) }),
  z.strictObject({ state: z.literal("dependency_unavailable") }),
  z.strictObject({ state: z.literal("needs_affiliation_choice") }),
] as const;
const envelope = { operationId: z.uuid(), replayed: z.boolean(), operationsEnabled: z.literal(false) };
const resultSchema = z.discriminatedUnion("state", [
  variants[0].extend(envelope), variants[1].extend(envelope), variants[2].extend(envelope),
  variants[3].extend(envelope), variants[4].extend(envelope), variants[5].extend(envelope), variants[6].extend(envelope),
]);

async function request<T>(body: object, parse: (value: unknown) => T): Promise<T> {
 let response: Response;
 try { response = await fetch("/api/checkin-arrival-resume", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(30000) }); }
 catch { throw new CheckinArrivalRequestError("Arrival recovery response lost. Keep the same operation references and reacquire the same QR.", true); }
 if (!response.ok) throw new CheckinArrivalRequestError(response.status === 409 ? "Bound recovery unavailable. Do not retarget this arrival or reset an unknown admission outcome." : "Arrival recovery unavailable. Verify login and the original station binding.", response.status >= 500 || response.status === 408);
 try { return parse(await response.json()); }
 catch { throw new CheckinArrivalRequestError("Arrival recovery response did not match. Keep the same operation references.", true); }
}
/** Read only: safe across reload and authorized login handoff; no QR required. */
export function getCheckinArrivalResume(operationId: string): Promise<CheckinArrivalResume> {
 const id = checkinArrivalResumeOperationIdSchema.parse(operationId);
 return request({ operation: "get", operationId: id }, value => {
  const result = checkinArrivalResumeSchema.parse(value);
  if (result.operationId !== id) throw new Error("Mismatched operation");
  return result;
 });
}
/** QR is request-memory-only. Persist ONLY opaque operationId/nextOperationId.
 * replay retains the original UUID; retry/blank require a caller-created UUID,
 * reused verbatim on transport failure. Neither API starts an admission POST. */
export function resumeCheckinArrival(input: CheckinArrivalResumeInput): Promise<CheckinArrivalResult> {
 const command = checkinArrivalResumeInputSchema.parse(structuredClone(input));
 return request({ operation: "resume", command }, value => {
  const result = resultSchema.parse(value);
  if (result.operationId !== (command.action === "replay" ? command.operationId : command.nextOperationId)) throw new Error("Mismatched operation");
  return result;
 });
}
export type { CheckinArrivalResume, CheckinArrivalResumeInput } from "~/lib/checkin-arrival-resume-contract";
