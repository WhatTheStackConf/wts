import { z } from "zod";
import type { CheckinEventServiceContract } from "~/lib/checkin-event-contract";
import { checkinUpstreamId, configureCheckinEventSchema, selectCheckinEventSchema } from "~/lib/checkin-event-validation";
import { CheckinError } from "~/lib/checkin-service";
import { protectCheckinResponse } from "~/lib/checkin-privacy";
import { isSameOriginMutation } from "~/lib/session-policy";

const schema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("admin_catalogue") }),
  z.strictObject({ operation: z.literal("admin_options"), upstreamEventId: checkinUpstreamId }),
  z.strictObject({ operation: z.literal("configure"), command: configureCheckinEventSchema }),
  z.strictObject({ operation: z.literal("catalogue") }),
  z.strictObject({ operation: z.literal("select"), selection: selectCheckinEventSchema }),
]);
interface Actor { id: string; role: string }
export interface CheckinEventHttpDependencies {
  authenticate(): Promise<Actor>;
  service(actor: Actor): Promise<CheckinEventServiceContract>;
}
function response(body: unknown, status = 200) {
  return protectCheckinResponse(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}
export async function handleCheckinEventRequest(request: Request, deps: CheckinEventHttpDependencies): Promise<Response> {
  if (!isSameOriginMutation(request)) return response({ error: "Check-in access denied." }, 403);
  let actor: Actor;
  try {
    actor = await deps.authenticate();
    if (!["admin", "checkin_operator"].includes(actor.role)) return response({ error: "Check-in access denied." }, 403);
  } catch { return response({ error: "Check-in access denied." }, 403); }
  if (!request.headers.get("content-type")?.startsWith("application/json")) return response({ error: "Use a JSON event command." }, 415);
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
          if (size > 8192) { void reader.cancel().catch(() => undefined); return response({ error: "Event command too large." }, 413); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (["admin_catalogue", "admin_options", "configure"].includes(body?.operation) && actor.role !== "admin") return response({ error: "Event configuration requires an admin." }, 403);
    command = schema.parse(body);
  } catch { return response({ error: "Invalid event command." }, 400); }
  const cookies = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim()).filter((part) => part.startsWith("wts_checkin_client="));
  const token = cookies[0]?.slice("wts_checkin_client=".length);
  if (cookies.length > 1 || (token !== undefined && !/^[a-f0-9]{64}$/.test(token))) return response({ error: "Invalid station client identity." }, 403);
  try {
    const service = await deps.service(actor);
    switch (command.operation) {
      case "admin_catalogue": return response(await service.adminCatalogue());
      case "admin_options": return response(await service.adminOptions(command.upstreamEventId));
      case "configure": return response(await service.configure(command.command));
      case "catalogue": return response(await service.catalogue(token));
      case "select": return response(await service.select(token, command.selection));
    }
  } catch (error) {
    if (error instanceof CheckinError) return response({ code: error.code, error: error.message }, error.status);
    return response({ error: "Event catalogue unavailable. Refresh before retrying. No admission or printing was attempted." }, 503);
  }
}
