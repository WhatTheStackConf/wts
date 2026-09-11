import type { MonitoringServiceContract } from "~/lib/checkin-monitoring-contract";
import { monitoringRequestSchema, monitoringAdminSchema, monitoringOperatorSchema, monitoringConfigSchema, monitoringAckSchema } from "~/lib/checkin-monitoring-validation";
import { CheckinError } from "~/lib/checkin-service";
import { protectCheckinResponse } from "~/lib/checkin-privacy";
import { isSameOriginMutation } from "~/lib/session-policy";
interface Actor { id: string; role: string }
export interface CheckinMonitoringHttpDependencies { authenticate(): Promise<Actor>; service(actor: Actor): Promise<MonitoringServiceContract> }
function response(value: unknown, status = 200) { return protectCheckinResponse(new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } })); }
export async function handleCheckinMonitoringRequest(request: Request, deps: CheckinMonitoringHttpDependencies): Promise<Response> {
  if (!isSameOriginMutation(request)) return response({ error: "Monitoring access denied." }, 403);
  let actor: Actor;
  try { actor = await deps.authenticate(); if (!["admin", "checkin_operator"].includes(actor.role)) throw new Error(); }
  catch { return response({ error: "Monitoring access denied." }, 403); }
  if (!request.headers.get("content-type")?.startsWith("application/json")) return response({ error: "Use JSON." }, 415);
  let body;
  try {
    const reader = request.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    if (reader) { try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 8192) { void reader.cancel().catch(() => undefined); return response({ error: "Command too large." }, 413); } chunks.push(value); } } finally { reader.releaseLock(); } }
    body = monitoringRequestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch { return response({ error: "Invalid monitoring command." }, 400); }
  if (body.operation === "configure" && actor.role !== "admin") return response({ error: "Admin required." }, 403);
  const cookies = (request.headers.get("cookie") || "").split(";").map((v) => v.trim()).filter((v) => v.startsWith("wts_checkin_client="));
  if (cookies.length > 1) return response({ error: "Invalid station binding." }, 400);
  const token = cookies[0]?.slice("wts_checkin_client=".length) || null;
  try {
    const service = await deps.service(actor);
    if (body.operation === "dashboard") return response((actor.role === "admin" ? monitoringAdminSchema : monitoringOperatorSchema).parse(await service.dashboard(token, body.offset || 0)));
    if (body.operation === "configure") return response(monitoringConfigSchema.parse(await service.configure(body.command)));
    const result = monitoringAckSchema.parse(await service.acknowledge(body.incidentId, token));
    if (result.incidentId !== body.incidentId) throw new Error();
    return response(result);
  } catch (error) { if (error instanceof CheckinError) return response({ code: error.code, error: "Monitoring command rejected." }, error.status); return response({ error: "Monitoring service unavailable." }, 503); }
}
