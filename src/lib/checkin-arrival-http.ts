import { z } from "zod";
import type { CheckinArrivalServiceContract } from "~/lib/checkin-arrival-contract";
import { CheckinError } from "~/lib/checkin-service";
import { protectCheckinResponse } from "~/lib/checkin-privacy";
import { isSameOriginMutation } from "~/lib/session-policy";
import { authenticateCheckinActor, checkinClientToken, readCheckinCommand } from "~/lib/checkin-http-request";

import { checkinArrivalInputSchema, checkinArrivalHistoryQuerySchema } from "~/lib/checkin-arrival-validation";

const schema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("status"), operationId: z.uuid() }),
  z.strictObject({ operation: z.literal("preflight"), command: checkinArrivalInputSchema }),
  z.strictObject({ operation: z.literal("history"), query: checkinArrivalHistoryQuerySchema.optional() }),
]);
type ArrivalCommand = z.infer<typeof schema>;
const REJECTIONS = { 400: "Invalid arrival command.", 413: "Arrival command too large." } as const;
interface Actor { id: string; role: string }
export interface CheckinArrivalHttpDependencies {
  authenticate(): Promise<Actor>;
  service(actor: Actor): Promise<CheckinArrivalServiceContract>;
}
function response(body: unknown, status = 200) {
  return protectCheckinResponse(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}
function isAllStationWork(command: ArrivalCommand): boolean {
  return command.operation === "history" && command.query?.scope === "all";
}
function failure(error: unknown): Response {
  // Reconstruct even known errors: do not trust a mutable Error.message.
  if (error instanceof CheckinError) return response({ code: error.code, error: new CheckinError(error.code, error.status).message }, error.status);
  return response({ error: "Arrival service unavailable. The outcome remains unknown; do not start a new intake for this attendee." }, 503);
}
function run(service: CheckinArrivalServiceContract, command: ArrivalCommand, token: string | undefined): Promise<unknown> {
  if (command.operation === "status") return service.status(token, command.operationId);
  if (command.operation === "preflight") return service.preflight(token, command.command);
  return service.history(token, command.query);
}
export async function handleCheckinArrivalRequest(request: Request, deps: CheckinArrivalHttpDependencies): Promise<Response> {
  if (!isSameOriginMutation(request)) return response({ error: "Check-in access denied." }, 403);
  const actor = await authenticateCheckinActor(() => deps.authenticate(), (actor) => Boolean(actor.id) && ["admin", "checkin_operator"].includes(actor.role));
  if (!actor) return response({ error: "Check-in access denied." }, 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return response({ error: "Use a JSON arrival command." }, 415);
  const read = await readCheckinCommand(request, 8192, (value) => schema.parse(value));
  if (!read.ok) return response({ error: REJECTIONS[read.status] }, read.status);
  const command = read.command;
  if (isAllStationWork(command) && actor.role !== "admin") return response({ error: "All-station arrival work requires an admin." }, 403);
  const client = checkinClientToken(request);
  if (!client.valid) return response({ error: "Invalid station client identity." }, 403);
  try {
    const service = await deps.service(actor);
    return response(await run(service, command, client.token));
  } catch (error) { return failure(error); }
}
