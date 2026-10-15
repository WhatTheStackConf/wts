import type { z } from "zod";
import type { MonitoringServiceContract } from "~/lib/checkin-monitoring-contract";
import { monitoringRequestSchema, monitoringAdminSchema, monitoringOperatorSchema, monitoringConfigSchema, monitoringAckSchema } from "~/lib/checkin-monitoring-validation";
import { CheckinError } from "~/lib/checkin-service";
import { protectCheckinResponse } from "~/lib/checkin-privacy";
import { isSameOriginMutation } from "~/lib/session-policy";
import { authenticateCheckinActor, checkinClientCookies, readCheckinCommand } from "~/lib/checkin-http-request";
interface Actor { id: string; role: string }
export interface CheckinMonitoringHttpDependencies { authenticate(): Promise<Actor>; service(actor: Actor): Promise<MonitoringServiceContract> }
function response(value: unknown, status = 200) { return protectCheckinResponse(new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } })); }
type Command = z.infer<typeof monitoringRequestSchema>;
interface Call { service: MonitoringServiceContract; actor: Actor; token: string | null }
type Operation<K extends Command["operation"]> = (call: Call, command: Extract<Command, { operation: K }>) => Promise<unknown>;
const operations: { [K in Command["operation"]]: Operation<K> } = {
  dashboard: async ({ service, actor, token }, command) => (actor.role === "admin" ? monitoringAdminSchema : monitoringOperatorSchema).parse(await service.dashboard(token, command.offset || 0)),
  configure: async ({ service }, command) => monitoringConfigSchema.parse(await service.configure(command.command)),
  acknowledge: async ({ service, token }, command) => {
    const result = monitoringAckSchema.parse(await service.acknowledge(command.incidentId, token));
    if (result.incidentId !== command.incidentId) throw new Error();
    return result;
  },
};
const REJECTIONS = { 413: "Command too large.", 400: "Invalid monitoring command." } as const;
function permits(actor: Actor, command: Command) { return command.operation !== "configure" || actor.role === "admin"; }
function monitoringFailure(error: unknown) {
  if (error instanceof CheckinError) return response({ code: error.code, error: "Monitoring command rejected." }, error.status);
  return response({ error: "Monitoring service unavailable." }, 503);
}
export async function handleCheckinMonitoringRequest(request: Request, deps: CheckinMonitoringHttpDependencies): Promise<Response> {
  if (!isSameOriginMutation(request)) return response({ error: "Monitoring access denied." }, 403);
  const actor = await authenticateCheckinActor(() => deps.authenticate(), (candidate) => ["admin", "checkin_operator"].includes(candidate.role));
  if (!actor) return response({ error: "Monitoring access denied." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return response({ error: "Use JSON." }, 415);
  const read = await readCheckinCommand(request, 8192, (value) => monitoringRequestSchema.parse(value));
  if (!read.ok) return response({ error: REJECTIONS[read.status] }, read.status);
  if (!permits(actor, read.command)) return response({ error: "Admin required." }, 403);
  const tokens = checkinClientCookies(request);
  if (tokens.length > 1) return response({ error: "Invalid station binding." }, 400);
  try {
    const service = await deps.service(actor);
    const run = operations[read.command.operation] as Operation<Command["operation"]>;
    return response(await run({ service, actor, token: tokens[0] || null }, read.command));
  } catch (error) { return monitoringFailure(error); }
}
