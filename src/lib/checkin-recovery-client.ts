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
type Result = ReturnType<typeof recoveryResultSchema.parse>;
type Workflow = Result["workflow"];
type Attempt = Workflow["attempts"][number];
type Projection<K extends RecoveryCommand["operation"]> = [label: string, confirms: (command: Extract<RecoveryCommand, { operation: K }>, workflow: Workflow, last: Attempt | undefined) => boolean];
const projections: { [K in RecoveryCommand["operation"]]?: Projection<K> } = {
  correct: ["draft", (command, workflow) => workflow.name === command.name && workflow.affiliation === command.affiliation],
  park: ["parking", (_command, workflow) => workflow.parked],
  resume: ["parking", (_command, workflow) => !workflow.parked],
  observe: ["observation", (command, _workflow, last) => last?.id === command.printId && last.observation === command.outcome],
  replace: ["replacement", (command, _workflow, last) => last?.purpose === "replacement" && last.id !== command.printId && last.predecessorId === command.printId],
  authorize_initial: ["authorization", (_command, workflow, last) => workflow.decision === "authorized" && workflow.attempts.length === 1 && last?.purpose === "initial"],
  handwrite: ["handwriting", (_command, workflow) => ["handwritten", "handwrite_pending"].includes(workflow.fulfillment)],
  reset: ["reset", (command, workflow) => workflow.decision === "reset_pending" && workflow.resets.at(-1)?.checkinId === command.checkinId],
};
function sameCommand(result: Result, submitted: RecoveryCommand, committedVersion: number) {
  return result.operationId === submitted.operationId && result.workflow.workflowId === submitted.workflowId && committedVersion === submitted.expectedVersion + 1 && result.workflow.version >= committedVersion;
}
function confirmedResult(submitted: RecoveryCommand, value: unknown): Result {
  const result = recoveryResultSchema.parse(value);
  // This additive operation always has a bounded ledger receipt. A projection
  // alone cannot acknowledge a grant whose response may have been lost.
  if (submitted.operation === "retry_admission_reads" && result.commandId === undefined) throw new Error("receipt");
  const committedVersion = result.commandVersion ?? result.workflow.version;
  if (!sameCommand(result, submitted, committedVersion)) throw new Error("identity");
  if (result.commandVersion !== undefined && result.workflow.version !== committedVersion) {
    if (!result.replayed) throw new Error("Unexpected fresh projection");
    // An immutable receipt confirms this command; later actions may legitimately
    // change the separately returned current projection.
    return result;
  }
  const projection = projections[submitted.operation] as Projection<RecoveryCommand["operation"]> | undefined;
  if (projection && !projection[1](submitted, result.workflow, result.workflow.attempts.at(-1))) throw new Error(projection[0]);
  return result;
}
export function commandRecovery(command: RecoveryCommand) {
  const submitted = recoveryCommandSchema.parse(structuredClone(command));
  return request({ operation: "command", command: submitted }, value => confirmedResult(submitted, value));
}
/** Memory-only retry slot. Read failures never change it. Bind to an authenticated
 * session/binding generation; changing that scope destroys private pending data. */
export function createRecoveryCommandSlot() {
  let pending: Readonly<RecoveryCommand> | undefined;
  let generation = 0;
  let running = false;
  let wasAmbiguous = false;
  /** One command at a time; a pending command must be retried exactly, never replaced. */
  function claim(command?: RecoveryCommand): Readonly<RecoveryCommand> {
    if (running || (pending && command)) throw new RecoveryRequestError(false);
    if (pending) return pending;
    if (!command) throw new RecoveryRequestError(false);
    pending = Object.freeze(recoveryCommandSchema.parse(structuredClone(command)));
    return pending;
  }
  return {
    pending: () => pending,
    reset() { generation++; pending = undefined; running = false; wasAmbiguous = false; },
    async submit(command?: RecoveryCommand) {
      const saved = claim(command), current = generation;
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
