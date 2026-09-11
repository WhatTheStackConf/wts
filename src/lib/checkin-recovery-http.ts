import type { CheckinRecoveryService } from "./checkin-recovery-service";
import { CheckinError } from "./checkin-service";
import { protectCheckinResponse } from "./checkin-privacy";
import { isSameOriginMutation } from "./session-policy";
import { recoveryAttemptHistorySchema, recoveryRequestSchema, recoveryWorkflowSchema, recoveryHistorySchema, recoveryResultSchema, recoveryPreviewSchema, recoveryReadSchema, isRecoveryTruthCommand } from "./checkin-recovery-client-contract";
interface Actor { id: string; role: string }
export interface RecoveryHttpDependencies {
  authenticate(): Promise<Actor>;
  service(actor: Actor): Promise<Pick<CheckinRecoveryService, "get" | "history" | "attemptHistory" | "reconcile" | "command" | "preview">>;
}
function response(body: unknown, status = 200) { return protectCheckinResponse(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })); }
export async function handleCheckinRecoveryRequest(request: Request, deps: RecoveryHttpDependencies): Promise<Response> {
  if (!isSameOriginMutation(request)) return response({ error: "Recovery access denied." }, 403);
  let actor: Actor;
  try { actor = await deps.authenticate(); if (!actor.id || !["admin", "checkin_operator"].includes(actor.role)) throw new Error(); }
  catch { return response({ error: "Recovery access denied." }, 403); }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return response({ error: "JSON required." }, 415);
  let input;
  try {
    const chunks: Uint8Array[] = []; let size = 0; const reader = request.body?.getReader();
    if (reader) try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 8192) { void reader.cancel().catch(() => undefined); return response({ error: "Command too large." }, 413); } chunks.push(value); } } finally { reader.releaseLock(); }
    input = recoveryRequestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch { return response({ error: "Invalid recovery command." }, 400); }
  const truth = input.operation === "reconcile" || (input.operation === "command" && isRecoveryTruthCommand(input.command.operation));
  if (truth && actor.role !== "admin") return response({ error: "Admin required." }, 403);
  const cookies = (request.headers.get("cookie") ?? "").split(";").map(p => p.trim()).filter(p => p.startsWith("wts_checkin_client="));
  const token = cookies[0]?.slice("wts_checkin_client=".length);
  if (cookies.length > 1 || (token !== undefined && !/^[a-f0-9]{64}$/.test(token)) || (actor.role !== "admin" && !token)) return response({ error: "Station binding required." }, 403);
  try {
    const service = await deps.service(actor);
    if (input.operation === "get") return response(recoveryWorkflowSchema.parse(await service.get(token, input.workflowId)));
    if (input.operation === "history") return response(recoveryHistorySchema.parse(await service.history(token, input.offset)));
    if (input.operation === "attempt_history") return response(recoveryAttemptHistorySchema.parse(await service.attemptHistory(token, input.workflowId, input.offset)));
    if (input.operation === "reconcile") return response(recoveryReadSchema.parse(await service.reconcile(input.workflowId)));
    if (input.operation === "preview") return response(recoveryPreviewSchema.parse(await service.preview(token, input.workflowId, input.name, input.affiliation)));
    return response(recoveryResultSchema.parse(await service.command(token, input.command)));
  } catch (error) {
    // Fixed errors only: neither upstream diagnostics nor mutable messages escape.
    if (error instanceof CheckinError && [400, 403, 409].includes(error.status)) return response({ error: "Recovery request rejected." }, error.status);
    return response({ error: "Recovery unavailable. Preserve and retry the exact command; its outcome may be unknown." }, 503);
  }
}
