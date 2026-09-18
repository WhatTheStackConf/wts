import type { CheckinArrivalResult } from "~/lib/checkin-arrival-contract";
import { checkinArrivalResumeSchema, checkinArrivalResumeInputSchema, checkinArrivalResumeOperationIdSchema, type CheckinArrivalResumeInput, type CheckinArrivalResume } from "~/lib/checkin-arrival-resume-contract";
import { CheckinArrivalRequestError, checkinArrivalResultSchema } from "~/lib/checkin-arrival-client";

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
  const result = checkinArrivalResultSchema.parse(value);
  if (result.operationId !== (command.action === "replay" ? command.operationId : command.nextOperationId)) throw new Error("Mismatched operation");
  return result;
 });
}
export type { CheckinArrivalResume, CheckinArrivalResumeInput } from "~/lib/checkin-arrival-resume-contract";
