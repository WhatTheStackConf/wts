import { CheckinError } from "./checkin-service";
import { protectCheckinResponse } from "./checkin-privacy";
import { isSameOriginMutation } from "./session-policy";
import { readCheckinCommandBody } from "./checkin-http-request";
import type { LifecycleService } from "./checkin-lifecycle-contract";
import { lifecycleRequestSchema, validateLifecycleResponse, type LifecycleRequest } from "./checkin-lifecycle-validation";

interface Actor { id: string; role: string }
export interface CheckinLifecycleHttpDependencies {
  authenticate(): Promise<Actor>;
  service(actor: Actor): Promise<LifecycleService>;
}
function response(body: unknown, status = 200) {
  return protectCheckinResponse(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff", "Vary": "Cookie" } }));
}
const REJECTIONS = { 413: "Lifecycle command too large.", 400: "Invalid lifecycle command." } as const;
async function admitAdmin(deps: CheckinLifecycleHttpDependencies): Promise<Actor | Response> {
  try {
    const actor = await deps.authenticate();
    return actor.id && actor.role === "admin" ? actor : response({ error: "Lifecycle access requires an admin." }, 403);
  } catch { return response({ error: "Lifecycle access denied." }, 403); }
}
function isJsonCommand(request: Request) {
  return request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() === "application/json";
}
function runLifecycleCommand(service: LifecycleService, command: LifecycleRequest) {
  if (command.operation === "status") return service.status();
  return command.operation === "close" ? service.close(command.command) : service.approveRestore(command.command);
}
function lifecycleFailure(error: unknown) {
  // Never echo raw backend diagnostics, submitted text, credentials or PII.
  if (!(error instanceof CheckinError) || ![400, 403, 409].includes(error.status)) return response({ error: "Lifecycle outcome unavailable. A mutation may have been saved; retry the same command." }, 503);
  return response({ error: error.status === 403 ? "Lifecycle access denied." : "Lifecycle command rejected. Refresh the lifecycle state." }, error.status);
}
export async function handleCheckinLifecycleRequest(request: Request, deps: CheckinLifecycleHttpDependencies): Promise<Response> {
  if (!isSameOriginMutation(request)) return response({ error: "Lifecycle access denied." }, 403);
  const actor = await admitAdmin(deps);
  if (actor instanceof Response) return actor;
  if (!isJsonCommand(request)) return response({ error: "Use a JSON lifecycle command." }, 415);
  const read = await readCheckinCommandBody(request, 4096, (body) => lifecycleRequestSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body))));
  if (!read.ok) return response({ error: REJECTIONS[read.status] }, read.status);
  try {
    const service = await deps.service(actor);
    return response(validateLifecycleResponse(await runLifecycleCommand(service, read.command), read.command));
  } catch (error) { return lifecycleFailure(error); }
}
