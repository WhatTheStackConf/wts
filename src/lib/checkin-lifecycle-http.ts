import { CheckinError } from "./checkin-service";
import { protectCheckinResponse } from "./checkin-privacy";
import { isSameOriginMutation } from "./session-policy";
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
export async function handleCheckinLifecycleRequest(request: Request, deps: CheckinLifecycleHttpDependencies): Promise<Response> {
  if (!isSameOriginMutation(request)) return response({ error: "Lifecycle access denied." }, 403);
  let actor: Actor;
  try {
    actor = await deps.authenticate();
    if (!actor.id || actor.role !== "admin") return response({ error: "Lifecycle access requires an admin." }, 403);
  } catch { return response({ error: "Lifecycle access denied." }, 403); }
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return response({ error: "Use a JSON lifecycle command." }, 415);
  let command: LifecycleRequest;
  try {
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 4096) { void reader.cancel().catch(() => undefined); return response({ error: "Lifecycle command too large." }, 413); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
    }
    command = lifecycleRequestSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))));
  } catch { return response({ error: "Invalid lifecycle command." }, 400); }
  try {
    const service = await deps.service(actor);
    const result = command.operation === "status" ? await service.status() : command.operation === "close" ? await service.close(command.command) : await service.approveRestore(command.command);
    return response(validateLifecycleResponse(result, command));
  } catch (error) {
    // Never echo raw backend diagnostics, submitted text, credentials or PII.
    if (error instanceof CheckinError && [400, 403, 409].includes(error.status)) return response({ error: error.status === 403 ? "Lifecycle access denied." : "Lifecycle command rejected. Refresh the lifecycle state." }, error.status);
    return response({ error: "Lifecycle outcome unavailable. A mutation may have been saved; retry the same command." }, 503);
  }
}
