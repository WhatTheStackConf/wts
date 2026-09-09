import { z } from "zod";
import { CHECKIN_REASON_CODES, CHECKIN_STATION_IDS } from "~/lib/checkin-contract";
import type { CheckinAgentServiceContract } from "~/lib/checkin-agent-contract";
import { CheckinError } from "~/lib/checkin-service";
import { protectCheckinResponse } from "~/lib/checkin-privacy";
import { isSameOriginMutation } from "~/lib/session-policy";
const base = { operationId: z.uuid(), stationId: z.enum(CHECKIN_STATION_IDS), expectedStationVersion: z.number().int().positive(), reason: z.enum(CHECKIN_REASON_CODES), note: z.string().max(240) };
const identity = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/);
const schema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("status") }), z.strictObject({ operation: z.literal("admin_list") }),
  z.strictObject({ operation: z.literal("admin_issue"), command: z.strictObject({ ...base, agentIdentity: identity, printerIdentity: identity, journalIdentity: identity, profileId: z.union([z.literal(""), z.string().regex(/^[a-z0-9]{15}$/)]), credentialLifetimeHours: z.number().int().min(1).max(720) }) }),
  z.strictObject({ operation: z.literal("admin_revoke"), command: z.strictObject({ ...base, agentId: z.string().regex(/^[a-z0-9]{15}$/) }) }),
]);
interface Actor { id: string; role: string }
export interface CheckinAgentHttpDependencies { authenticate(): Promise<Actor>; service(actor: Actor): Promise<CheckinAgentServiceContract> }
function response(value: unknown, status = 200) { return protectCheckinResponse(new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } })); }
export async function handleCheckinAgentRequest(request: Request, deps: CheckinAgentHttpDependencies): Promise<Response> {
  if (!isSameOriginMutation(request)) return response({ error: "Agent access denied." }, 403);
  let actor: Actor;
  try { actor = await deps.authenticate(); if (!["admin", "checkin_operator"].includes(actor.role)) return response({ error: "Agent access denied." }, 403); }
  catch { return response({ error: "Agent access denied." }, 403); }
  if (!request.headers.get("content-type")?.startsWith("application/json")) return response({ error: "Use JSON." }, 415);
  let body: z.infer<typeof schema>;
  try {
    const reader = request.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    if (reader) { try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 8192) { void reader.cancel().catch(() => undefined); return response({ error: "Command too large." }, 413); } chunks.push(value); } } finally { reader.releaseLock(); } }
    body = schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch { return response({ error: "Invalid agent command." }, 400); }
  if (body.operation !== "status" && actor.role !== "admin") return response({ error: "Admin required." }, 403);
  try {
    const service = await deps.service(actor);
    if (body.operation === "status") {
      const cookies = (request.headers.get("cookie") || "").split(";").map((v) => v.trim()).filter((v) => v.startsWith("wts_checkin_client="));
      const token = cookies.length === 1 ? cookies[0].slice("wts_checkin_client=".length) : null;
      return response(await service.status(token));
    }
    if (body.operation === "admin_list") return response(await service.adminList());
    if (body.operation === "admin_issue") return response(await service.issue(body.command));
    return response(await service.revoke(body.command));
  } catch (error) { if (error instanceof CheckinError) return response({ code: error.code, error: error.message }, error.status); return response({ error: "Agent service unavailable." }, 503); }
}
