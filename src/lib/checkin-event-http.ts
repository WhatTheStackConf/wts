import { z } from "zod";
import type { CheckinEventServiceContract } from "~/lib/checkin-event-contract";
import { checkinUpstreamId, configureCheckinEventSchema, selectCheckinEventSchema } from "~/lib/checkin-event-validation";
import { CheckinError } from "~/lib/checkin-service";
import { protectCheckinResponse } from "~/lib/checkin-privacy";
import { isSameOriginMutation } from "~/lib/session-policy";
import { authenticateCheckinActor, checkinClientToken, readCheckinCommand } from "~/lib/checkin-http-request";

const schema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("admin_catalogue") }),
  z.strictObject({ operation: z.literal("admin_options"), upstreamEventId: checkinUpstreamId }),
  z.strictObject({ operation: z.literal("configure"), command: configureCheckinEventSchema }),
  z.strictObject({ operation: z.literal("catalogue") }),
  z.strictObject({ operation: z.literal("select"), selection: selectCheckinEventSchema }),
]);
type EventCommand = z.infer<typeof schema>;
const ADMIN_OPERATIONS: unknown[] = ["admin_catalogue", "admin_options", "configure"];
const REJECTIONS = { 400: "Invalid event command.", 403: "Event configuration requires an admin.", 413: "Event command too large." } as const;
type EventRead = { ok: true; command: EventCommand } | { ok: false; status: keyof typeof REJECTIONS };
interface Actor { id: string; role: string }
export interface CheckinEventHttpDependencies {
  authenticate(): Promise<Actor>;
  service(actor: Actor): Promise<CheckinEventServiceContract>;
}
function response(body: unknown, status = 200) {
  return protectCheckinResponse(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}
/** Operators are denied configuration before the command shape is validated. */
async function readEventCommand(request: Request, role: string): Promise<EventRead> {
  const read = await readCheckinCommand(request, 8192, (value) => value as { operation?: unknown } | null);
  if (!read.ok) return read;
  if (ADMIN_OPERATIONS.includes(read.command?.operation) && role !== "admin") return { ok: false, status: 403 };
  try { return { ok: true, command: schema.parse(read.command) }; } catch { return { ok: false, status: 400 }; }
}
function failure(error: unknown): Response {
  if (error instanceof CheckinError) return response({ code: error.code, error: error.message }, error.status);
  return response({ error: "Event catalogue unavailable. Refresh before retrying. No admission or printing was attempted." }, 503);
}
function run(service: CheckinEventServiceContract, command: EventCommand, token: string | undefined): Promise<unknown> {
  switch (command.operation) {
    case "admin_catalogue": return service.adminCatalogue();
    case "admin_options": return service.adminOptions(command.upstreamEventId);
    case "configure": return service.configure(command.command);
    case "catalogue": return service.catalogue(token);
    case "select": return service.select(token, command.selection);
  }
}
export async function handleCheckinEventRequest(request: Request, deps: CheckinEventHttpDependencies): Promise<Response> {
  if (!isSameOriginMutation(request)) return response({ error: "Check-in access denied." }, 403);
  const actor = await authenticateCheckinActor(() => deps.authenticate(), (actor) => ["admin", "checkin_operator"].includes(actor.role));
  if (!actor) return response({ error: "Check-in access denied." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return response({ error: "Use a JSON event command." }, 415);
  const read = await readEventCommand(request, actor.role);
  if (!read.ok) return response({ error: REJECTIONS[read.status] }, read.status);
  const client = checkinClientToken(request);
  if (!client.valid) return response({ error: "Invalid station client identity." }, 403);
  try {
    const service = await deps.service(actor);
    return response(await run(service, read.command, client.token));
  } catch (error) { return failure(error); }
}
