import { z } from "zod";
import { checkinArrivalResumeRequestSchema as schema, type CheckinArrivalResumeServiceContract } from "~/lib/checkin-arrival-resume-contract";
import { CheckinError } from "~/lib/checkin-service";
import { protectCheckinResponse } from "~/lib/checkin-privacy";
import { isSameOriginMutation } from "~/lib/session-policy";

interface Actor { id: string; role: string }
export interface CheckinArrivalResumeHttpDependencies {
  authenticate(): Promise<Actor>;
  service(actor: Actor): Promise<CheckinArrivalResumeServiceContract>;
}
function response(body: unknown, status = 200) {
  return protectCheckinResponse(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}
export async function handleCheckinArrivalResumeRequest(request: Request, deps: CheckinArrivalResumeHttpDependencies): Promise<Response> {
  if (!isSameOriginMutation(request)) return response({ error: "Check-in access denied." }, 403);
  let actor: Actor;
  try {
    actor = await deps.authenticate();
    if (!actor.id || !["admin", "checkin_operator"].includes(actor.role)) return response({ error: "Check-in access denied." }, 403);
  } catch { return response({ error: "Check-in access denied." }, 403); }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return response({ error: "Use a JSON arrival command." }, 415);
  let command: z.infer<typeof schema>;
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = request.body?.getReader();
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 8192) { void reader.cancel().catch(() => undefined); return response({ error: "Arrival command too large." }, 413); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
    }
    command = schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch { return response({ error: "Invalid arrival command." }, 400); }
  const cookies = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim()).filter((part) => part.startsWith("wts_checkin_client="));
  const token = cookies[0]?.slice("wts_checkin_client=".length);
  if (cookies.length > 1 || (token !== undefined && !/^[a-f0-9]{64}$/.test(token))) return response({ error: "Invalid station client identity." }, 403);
  try {
    const service = await deps.service(actor);
    if (command.operation === "resume") return response(await service.resume(token, command.command));
    return response(await service.get(token, command.operationId));
  } catch (error) {
    // Reconstruct even known errors: do not trust a mutable Error.message.
    if (error instanceof CheckinError) return response({ code: error.code, error: new CheckinError(error.code, error.status).message }, error.status);
    return response({ error: "Arrival service unavailable. Retry the same preflight; no admission or printing was attempted." }, 503);
  }
}
