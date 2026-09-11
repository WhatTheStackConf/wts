/** Durable browser handoff contains only an opaque operation UUID, never lookup PII.
 * Parents must keep lookup mounted (or honor onBusy) until reconciled. A restored
 * reference is NOT proof of an outcome: connect onRecoverHeld to authenticated
 * server recovery and return reconciled only after an authoritative terminal result.
 * No Park/discard action is offered for unknown work.
 */
export const LOOKUP_HOLD_KEY = "wts.checkin.lookup.held-operation";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export type LookupHeldRecovery = { state: "held" } | { state: "reconciled"; operationId: string };
export function readLookupHold(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const value = window.localStorage.getItem(LOOKUP_HOLD_KEY);
  if (value !== null && !uuid.test(value)) throw new Error("Invalid held operation reference. Recovery is required.");
  return value ?? undefined;
}
export function persistLookupHold(operationId: string, priorOperationId?: string): void {
  if (!uuid.test(operationId)) throw new Error("Invalid operation reference.");
  const existing = readLookupHold();
  if (existing && existing !== operationId && existing !== priorOperationId) throw new Error("Another lookup operation is held. Recover it first.");
  window.localStorage.setItem(LOOKUP_HOLD_KEY, operationId);
  if (readLookupHold() !== operationId) throw new Error("Could not retain operation reference. Confirmation was not sent.");
}
export function releaseLookupHold(operationId: string): void {
  if (readLookupHold() === operationId) window.localStorage.removeItem(LOOKUP_HOLD_KEY);
}
