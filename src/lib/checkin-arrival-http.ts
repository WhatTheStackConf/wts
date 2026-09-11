import { z } from "zod";
import type { CheckinArrivalServiceContract } from "~/lib/checkin-arrival-contract";
import { CheckinError } from "~/lib/checkin-service";
import { protectCheckinResponse } from "~/lib/checkin-privacy";
import { isSameOriginMutation } from "~/lib/session-policy";

import { checkinArrivalInputSchema, checkinArrivalHistoryQuerySchema } from "~/lib/checkin-arrival-validation";

const schema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("status"), operationId: z.uuid() }),
  z.strictObject({ operation: z.literal("preflight"), command: checkinArrivalInputSchema }),
  z.strictObject({ operation: z.literal("history"), query: checkinArrivalHistoryQuerySchema.optional() }),
]);
interface Actor { id: string; role: string }
export interface CheckinArrivalHttpDependencies {
  authenticate(): Promise<Actor>;
  service(actor: Actor): Promise<CheckinArrivalServiceContract>;
}
function response(body: unknown, status = 200) {
  return protectCheckinResponse(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}
export async function handleCheckinArrivalRequest(request: Request, deps: CheckinArrivalHttpDependencies): Promise<Response> {
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
  if (command.operation === "history" && command.query?.scope === "all" && actor.role !== "admin") return response({ error: "All-station arrival work requires an admin." }, 403);
  const cookies = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim()).filter((part) => part.startsWith("wts_checkin_client="));
  const token = cookies[0]?.slice("wts_checkin_client=".length);
  if (cookies.length > 1 || (token !== undefined && !/^[a-f0-9]{64}$/.test(token))) return response({ error: "Invalid station client identity." }, 403);
  try {
    const service = await deps.service(actor);
    if (command.operation === "status") return response(await service.status(token, command.operationId));
    if (command.operation === "preflight") return response(await service.preflight(token, command.command));
    return response(await service.history(token, command.query));
  } catch (error) {
    // Reconstruct even known errors: do not trust a mutable Error.message.
    if (error instanceof CheckinError) return response({ code: error.code, error: new CheckinError(error.code, error.status).message }, error.status);
    return response({ error: "Arrival service unavailable. The outcome remains unknown; do not start a new intake for this attendee." }, 503);
  }
}
