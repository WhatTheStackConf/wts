import { CheckinArrivalRequestError, checkinArrivalResultSchema } from "~/lib/checkin-arrival-client";
import { checkinLookupSearchInputSchema, checkinLookupSearchResultSchema, checkinLookupConfirmInputSchema, type CheckinLookupSearchInput, type CheckinLookupSearchResult, type CheckinLookupConfirmInput } from "~/lib/checkin-lookup-contract";
import type { CheckinArrivalResult } from "~/lib/checkin-arrival-contract";
import type { CheckinEventContext } from "~/lib/checkin-event-contract";
import { checkinLookupRecoverInputSchema, checkinLookupRecoveryOperationIdSchema, type CheckinLookupRecoverInput } from "~/lib/checkin-lookup-recovery-contract";
import { parseCheckinLookupRecovery } from "~/lib/checkin-lookup-recovery-validation";

export class CheckinLookupRequestError extends CheckinArrivalRequestError {
  constructor(message: string, ambiguous: boolean, readonly kind: "access" | "context" | "transport" | "invalid", readonly status?: number) {
    super(message, ambiguous);
  }
}

export function sameLookupContext(a: CheckinEventContext, b: CheckinEventContext): boolean {
  return (Object.keys(a) as (keyof CheckinEventContext)[]).every(key => a[key] === b[key]);
}
export function parseCheckinLookupSearchResult(value: unknown, input: CheckinLookupSearchInput): CheckinLookupSearchResult {
  const result = checkinLookupSearchResultSchema.parse(value);
  if (!sameLookupContext(result.context, input.context) || (result.nextOffset !== null && result.nextOffset <= (input.offset ?? 0))) throw new Error("Mismatched lookup context or pagination");
  if (new Set(result.items.map(item => item.attendeeId)).size !== result.items.length || new Set(result.items.map(item => item.publicId)).size !== result.items.length) throw new Error("Duplicate lookup identity");
  return result;
}
export function parseCheckinLookupConfirmResult(value: unknown, input: Pick<CheckinLookupConfirmInput, "operationId" | "context">): CheckinArrivalResult {
  const result = checkinArrivalResultSchema.parse(value);
  if (result.operationId !== input.operationId) throw new Error("Mismatched operation");
  if ("workflow" in result && (result.workflow.eventId !== input.context.eventId || result.workflow.stationId !== input.context.stationId)) throw new Error("Mismatched originating context");
  return result;
}
type RejectionKind = "access" | "context" | "transport";
const rejectionKinds: Record<number, RejectionKind> = { 401: "access", 403: "access", 409: "context" };
const rejections: Record<RejectionKind, string> = {
  access: "Lookup access denied. Verify your login and station binding.",
  context: "Lookup context changed. Preserve the original confirmation for recovery.",
  transport: "Lookup unavailable. Retry the same request.",
};
const failures = {
  mutation: { transport: "Confirmation outcome unknown. Retry the same confirmation.", invalid: "Confirmation response invalid. Outcome unknown; retry the same confirmation." },
  read: { transport: "Lookup unavailable. Retry your search.", invalid: "Lookup response invalid. No results can be used; retry your search." },
};
async function request<T>(operation: "search" | "confirm" | "recovery_get" | "recover", input: object, parse: (value: unknown) => T): Promise<T> {
  const mutation = operation === "confirm" || operation === "recover";
  const failure = failures[mutation ? "mutation" : "read"];
  let response: Response;
  try {
    response = await fetch("/api/checkin-lookup", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation, input }), cache: "no-store", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(30000) });
  } catch { throw new CheckinLookupRequestError(failure.transport, mutation, "transport"); }
  // Even 403/409 can follow a committed command (post-commit authorization or
  // an earlier lost response). No HTTP rejection proves a mutation did not run.
  if (!response.ok) {
    const kind = rejectionKinds[response.status] ?? "transport";
    throw new CheckinLookupRequestError(rejections[kind], mutation, kind, response.status);
  }
  try { return parse(await response.json()); }
  catch { throw new CheckinLookupRequestError(failure.invalid, mutation, "invalid"); }
}
export function searchCheckinLookup(input: CheckinLookupSearchInput): Promise<CheckinLookupSearchResult> {
  const submitted = checkinLookupSearchInputSchema.parse(structuredClone(input));
  return request("search", submitted, value => parseCheckinLookupSearchResult(value, submitted));
}
export function confirmCheckinLookup(input: CheckinLookupConfirmInput): Promise<CheckinArrivalResult> {
  const submitted = checkinLookupConfirmInputSchema.parse(structuredClone(input));
  return request("confirm", submitted, value => parseCheckinLookupConfirmResult(value, submitted));
}
export function getCheckinLookupRecovery(operationId: string) {
  const id = checkinLookupRecoveryOperationIdSchema.parse(operationId);
  return request("recovery_get", { operationId: id }, value => parseCheckinLookupRecovery(value, id));
}
export function recoverCheckinLookup(input: CheckinLookupRecoverInput, context: CheckinEventContext): Promise<CheckinArrivalResult> {
  const submitted = checkinLookupRecoverInputSchema.parse(structuredClone(input));
  const expected = { context: structuredClone(context), operationId: submitted.action === "replay" ? submitted.operationId : submitted.nextOperationId };
  return request("recover", submitted, value => parseCheckinLookupConfirmResult(value, expected));
}
