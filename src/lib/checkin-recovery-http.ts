import type { z } from "zod";
import type { CheckinRecoveryService } from "./checkin-recovery-service";
import { CheckinError } from "./checkin-service";
import { protectCheckinResponse } from "./checkin-privacy";
import { isSameOriginMutation } from "./session-policy";
import { authenticateCheckinActor, checkinClientCookies, readCheckinCommand } from "./checkin-http-request";
import { recoveryAttemptHistorySchema, recoveryRequestSchema, recoveryWorkflowSchema, recoveryHistorySchema, recoveryResultSchema, recoveryPreviewSchema, recoveryReadSchema, isRecoveryTruthCommand } from "./checkin-recovery-client-contract";
interface Actor { id: string; role: string }
export interface RecoveryHttpDependencies {
  authenticate(): Promise<Actor>;
  service(actor: Actor): Promise<Pick<CheckinRecoveryService, "get" | "history" | "attemptHistory" | "reconcile" | "command" | "preview">>;
}
function response(body: unknown, status = 200) { return protectCheckinResponse(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })); }
type Service = Awaited<ReturnType<RecoveryHttpDependencies["service"]>>;
type Command = z.infer<typeof recoveryRequestSchema>;
type Operation<K extends Command["operation"]> = (service: Service, token: string | undefined, input: Extract<Command, { operation: K }>) => Promise<unknown>;
const operations: { [K in Command["operation"]]: Operation<K> } = {
  get: async (service, token, input) => recoveryWorkflowSchema.parse(await service.get(token, input.workflowId)),
  history: async (service, token, input) => recoveryHistorySchema.parse(await service.history(token, input.offset)),
  attempt_history: async (service, token, input) => recoveryAttemptHistorySchema.parse(await service.attemptHistory(token, input.workflowId, input.offset)),
  reconcile: async (service, _token, input) => recoveryReadSchema.parse(await service.reconcile(input.workflowId)),
  preview: async (service, token, input) => recoveryPreviewSchema.parse(await service.preview(token, input.workflowId, input.name, input.affiliation)),
  command: async (service, token, input) => recoveryResultSchema.parse(await service.command(token, input.command)),
};
const REJECTIONS = { 413: "Command too large.", 400: "Invalid recovery command." } as const;
function changesTruth(input: Command) {
  return input.operation === "reconcile" || (input.operation === "command" && isRecoveryTruthCommand(input.command.operation));
}
/** Admins may omit the station binding; any supplied binding must be one well-formed token. */
function bindingAdmitted(tokens: string[], actor: Actor) {
  const token = tokens[0];
  return tokens.length <= 1 && (token === undefined || /^[a-f0-9]{64}$/.test(token)) && (actor.role === "admin" || !!token);
}
function recoveryFailure(error: unknown) {
  // Fixed errors only: neither upstream diagnostics nor mutable messages escape.
  if (error instanceof CheckinError && [400, 403, 409].includes(error.status)) return response({ error: "Recovery request rejected." }, error.status);
  return response({ error: "Recovery unavailable. Preserve and retry the exact command; its outcome may be unknown." }, 503);
}
export async function handleCheckinRecoveryRequest(request: Request, deps: RecoveryHttpDependencies): Promise<Response> {
  if (!isSameOriginMutation(request)) return response({ error: "Recovery access denied." }, 403);
  const actor = await authenticateCheckinActor(() => deps.authenticate(), (candidate) => !!candidate.id && ["admin", "checkin_operator"].includes(candidate.role));
  if (!actor) return response({ error: "Recovery access denied." }, 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return response({ error: "JSON required." }, 415);
  const read = await readCheckinCommand(request, 8192, (value) => recoveryRequestSchema.parse(value));
  if (!read.ok) return response({ error: REJECTIONS[read.status] }, read.status);
  if (changesTruth(read.command) && actor.role !== "admin") return response({ error: "Admin required." }, 403);
  const tokens = checkinClientCookies(request);
  if (!bindingAdmitted(tokens, actor)) return response({ error: "Station binding required." }, 403);
  try {
    const service = await deps.service(actor);
    const run = operations[read.command.operation] as Operation<Command["operation"]>;
    return response(await run(service, tokens[0], read.command));
  } catch (error) { return recoveryFailure(error); }
}
