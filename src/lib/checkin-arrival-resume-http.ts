import { checkinArrivalResumeRequestSchema as schema, type CheckinArrivalResumeServiceContract } from "~/lib/checkin-arrival-resume-contract";
import { CheckinError } from "~/lib/checkin-service";
import { protectCheckinResponse } from "~/lib/checkin-privacy";
import { isSameOriginMutation } from "~/lib/session-policy";
import { authenticateCheckinActor, checkinClientToken, readCheckinCommand } from "~/lib/checkin-http-request";

const REJECTIONS = { 400: "Invalid arrival command.", 413: "Arrival command too large." } as const;
interface Actor { id: string; role: string }
export interface CheckinArrivalResumeHttpDependencies {
  authenticate(): Promise<Actor>;
  service(actor: Actor): Promise<CheckinArrivalResumeServiceContract>;
}
function response(body: unknown, status = 200) {
  return protectCheckinResponse(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}
function failure(error: unknown): Response {
  // Reconstruct even known errors: do not trust a mutable Error.message.
  if (error instanceof CheckinError) return response({ code: error.code, error: new CheckinError(error.code, error.status).message }, error.status);
  return response({ error: "Arrival service unavailable. Retry the same preflight; no admission or printing was attempted." }, 503);
}
export async function handleCheckinArrivalResumeRequest(request: Request, deps: CheckinArrivalResumeHttpDependencies): Promise<Response> {
  if (!isSameOriginMutation(request)) return response({ error: "Check-in access denied." }, 403);
  const actor = await authenticateCheckinActor(() => deps.authenticate(), (actor) => Boolean(actor.id) && ["admin", "checkin_operator"].includes(actor.role));
  if (!actor) return response({ error: "Check-in access denied." }, 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return response({ error: "Use a JSON arrival command." }, 415);
  const read = await readCheckinCommand(request, 8192, (value) => schema.parse(value));
  if (!read.ok) return response({ error: REJECTIONS[read.status] }, read.status);
  const command = read.command;
  const client = checkinClientToken(request);
  if (!client.valid) return response({ error: "Invalid station client identity." }, 403);
  try {
    const service = await deps.service(actor);
    if (command.operation === "resume") return response(await service.resume(client.token, command.command));
    return response(await service.get(client.token, command.operationId));
  } catch (error) { return failure(error); }
}
