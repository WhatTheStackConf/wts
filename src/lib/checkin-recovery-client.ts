import type { RecoveryCommand } from "./checkin-recovery-contract";
import { recoveryCommandSchema } from "./checkin-recovery-contract";
import { recoveryAttemptHistorySchema, recoveryRequestSchema, recoveryWorkflowSchema, recoveryHistorySchema, recoveryResultSchema, recoveryPreviewSchema, recoveryReadSchema } from "./checkin-recovery-client-contract";

export class RecoveryRequestError extends Error {
  constructor(readonly ambiguous: boolean, readonly denied = false) { super(denied ? "Recovery access denied. Verify login and station binding." : ambiguous ? "Outcome unknown. Retry the exact saved command; do not create a new command." : "Recovery request rejected. Refresh evidence before a new decision."); }
}
async function request<T>(body: unknown, parse: (value: unknown) => T): Promise<T> {
  const payload = recoveryRequestSchema.parse(body);
  let response: Response;
  try { response = await fetch("/api/checkin-recovery", { method: "POST", credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) }); }
  catch { throw new RecoveryRequestError(true); }
  if (!response.ok) throw new RecoveryRequestError(response.status >= 500 || response.status === 408, response.status === 401 || response.status === 403);
  try { return parse(await response.json()); } catch { throw new RecoveryRequestError(true); }
}
export const getRecovery = (workflowId: string) => request({ operation: "get", workflowId }, value => {
  const result = recoveryWorkflowSchema.parse(value); if (result.workflowId !== workflowId) throw new Error("identity"); return result;
});
export const recoveryHistory = (offset = 0) => request({ operation: "history", offset }, value => {
  const result = recoveryHistorySchema.parse(value); if (result.nextOffset !== null && result.nextOffset !== offset + result.items.length) throw new Error("pagination"); return result;
});
export const recoveryAttemptHistory = (workflowId: string, offset = 0) => request({ operation: "attempt_history", workflowId, offset }, value => {
  const result = recoveryAttemptHistorySchema.parse(value);
  if (result.workflowId !== workflowId || (result.nextOffset !== null && result.nextOffset !== offset + result.items.length)) throw new Error("identity or pagination");
  return result;
});
export const reconcileRecovery = (workflowId: string) => request({ operation: "reconcile", workflowId }, value => recoveryReadSchema.parse(value));
export function previewRecovery(workflowId: string, name: string, affiliation: string) {
  return request({ operation: "preview", workflowId, name, affiliation }, value => { const result = recoveryPreviewSchema.parse(value); if (result.workflowId !== workflowId || result.name !== name || result.affiliation !== affiliation) throw new Error("identity"); return result; });
}
export function commandRecovery(command: RecoveryCommand) {
  const submitted = recoveryCommandSchema.parse(structuredClone(command));
  return request({ operation: "command", command: submitted }, value => {
    const result = recoveryResultSchema.parse(value);
    // This additive operation always has a bounded ledger receipt. A projection
    // alone cannot acknowledge a grant whose response may have been lost.
    if (submitted.operation === "retry_admission_reads" && result.commandId === undefined) throw new Error("receipt");
    const committedVersion = result.commandVersion ?? result.workflow.version;
    if (result.operationId !== submitted.operationId || result.workflow.workflowId !== submitted.workflowId || committedVersion !== submitted.expectedVersion + 1 || result.workflow.version < committedVersion) throw new Error("identity");
    if (result.commandVersion !== undefined && result.workflow.version !== committedVersion) {
      if (!result.replayed) throw new Error("Unexpected fresh projection");
      // An immutable receipt confirms this command; later actions may legitimately
      // change the separately returned current projection.
      return result;
    }
    const w = result.workflow, last = w.attempts.at(-1);
    if (submitted.operation === "correct" && (w.name !== submitted.name || w.affiliation !== submitted.affiliation)) throw new Error("draft");
    if (submitted.operation === "park" && !w.parked || submitted.operation === "resume" && w.parked) throw new Error("parking");
    if (submitted.operation === "observe" && (last?.id !== submitted.printId || last.observation !== submitted.outcome)) throw new Error("observation");
    if (submitted.operation === "replace" && (last?.purpose !== "replacement" || last.id === submitted.printId || last.predecessorId !== submitted.printId)) throw new Error("replacement");
    if (submitted.operation === "authorize_initial" && (w.decision !== "authorized" || w.attempts.length !== 1 || last?.purpose !== "initial")) throw new Error("authorization");
    if (submitted.operation === "handwrite" && !["handwritten", "handwrite_pending"].includes(w.fulfillment)) throw new Error("handwriting");
    if (submitted.operation === "reset" && (w.decision !== "reset_pending" || w.resets.at(-1)?.checkinId !== submitted.checkinId)) throw new Error("reset");
    return result;
  });
}
/** Memory-only retry slot. Read failures never change it. Bind to an authenticated
 * session/binding generation; changing that scope destroys private pending data. */
export function createRecoveryCommandSlot() {
  let pending: Readonly<RecoveryCommand> | undefined;
  let generation = 0;
  let running = false;
  let wasAmbiguous = false;
  return {
    pending: () => pending,
    reset() { generation++; pending = undefined; running = false; wasAmbiguous = false; },
    async submit(command?: RecoveryCommand) {
      if (running) throw new RecoveryRequestError(false);
      if (pending && command) throw new RecoveryRequestError(false);
      if (!pending) {
        if (!command) throw new RecoveryRequestError(false);
        pending = Object.freeze(recoveryCommandSchema.parse(structuredClone(command)));
      }
      const saved = pending, current = generation;
      running = true;
      try {
        const result = await commandRecovery(saved);
        if (current !== generation) return undefined;
        pending = undefined; wasAmbiguous = false;
        return result;
      } catch (error) {
        // Once ambiguous, even a later definitive rejection does not prove that
        // the original request never committed. Keep the slot until validated success.
        if (current === generation) {
          wasAmbiguous ||= !(error instanceof RecoveryRequestError) || error.ambiguous || error.denied;
          if (!wasAmbiguous) pending = undefined;
          throw error;
        }
        return undefined;
      } finally { if (current === generation) running = false; }
    },
  };
}
