import { z } from "zod";
import { CHECKIN_REASON_CODES, CHECKIN_STATION_IDS } from "~/lib/checkin-contract";
import type { CheckinAgentServiceContract } from "~/lib/checkin-agent-contract";
import { CheckinError } from "~/lib/checkin-service";
import { protectCheckinResponse } from "~/lib/checkin-privacy";
import { isSameOriginMutation } from "~/lib/session-policy";
import { authenticateCheckinActor, checkinClientCookies, readCheckinCommand } from "~/lib/checkin-http-request";
const base = { operationId: z.uuid(), stationId: z.enum(CHECKIN_STATION_IDS), expectedStationVersion: z.number().int().positive(), reason: z.enum(CHECKIN_REASON_CODES), note: z.string().max(240) };
const identity = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/);
const schema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("status") }), z.strictObject({ operation: z.literal("admin_list") }),
  z.strictObject({ operation: z.literal("admin_issue"), command: z.strictObject({ ...base, agentIdentity: identity, printerIdentity: identity, journalIdentity: identity, profileId: z.union([z.literal(""), z.string().regex(/^[a-z0-9]{15}$/)]), credentialLifetimeHours: z.number().int().min(1).max(720) }) }),
  z.strictObject({ operation: z.literal("admin_revoke"), command: z.strictObject({ ...base, agentId: z.string().regex(/^[a-z0-9]{15}$/) }) }),
]);
type AgentCommand = z.infer<typeof schema>;
const REJECTIONS = { 400: "Invalid agent command.", 413: "Command too large." } as const;
interface Actor { id: string; role: string }
export interface CheckinAgentHttpDependencies { authenticate(): Promise<Actor>; service(actor: Actor): Promise<CheckinAgentServiceContract> }
function response(value: unknown, status = 200) { return protectCheckinResponse(new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } })); }
function failure(error: unknown): Response {
  if (error instanceof CheckinError) return response({ code: error.code, error: error.message }, error.status);
  return response({ error: "Agent service unavailable." }, 503);
}
function run(service: CheckinAgentServiceContract, body: AgentCommand, request: Request): Promise<unknown> {
  if (body.operation === "status") {
    const cookies = checkinClientCookies(request);
    return service.status(cookies.length === 1 ? cookies[0] : null);
  }
  if (body.operation === "admin_list") return service.adminList();
  if (body.operation === "admin_issue") return service.issue(body.command);
  return service.revoke(body.command);
}
export async function handleCheckinAgentRequest(request: Request, deps: CheckinAgentHttpDependencies): Promise<Response> {
  if (!isSameOriginMutation(request)) return response({ error: "Agent access denied." }, 403);
  const actor = await authenticateCheckinActor(() => deps.authenticate(), (actor) => ["admin", "checkin_operator"].includes(actor.role));
  if (!actor) return response({ error: "Agent access denied." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return response({ error: "Use JSON." }, 415);
  const read = await readCheckinCommand(request, 8192, (value) => schema.parse(value));
  if (!read.ok) return response({ error: REJECTIONS[read.status] }, read.status);
  const body = read.command;
  if (body.operation !== "status" && actor.role !== "admin") return response({ error: "Admin required." }, 403);
  try {
    const service = await deps.service(actor);
    return response(await run(service, body, request));
  } catch (error) { return failure(error); }
}
