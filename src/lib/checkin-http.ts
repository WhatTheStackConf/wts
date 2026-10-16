import { randomBytes } from "node:crypto";
import { z } from "zod";
import { isSameOriginMutation } from "~/lib/session-policy";
import { CheckinError } from "~/lib/checkin-service";
import { CLIENT_COOKIE, authenticateCheckinActor, checkinClientToken, readCheckinCommand } from "~/lib/checkin-http-request";
import { CHECKIN_STATION_IDS, CHECKIN_REASON_CODES, CHECKIN_NOTE_MAX_LENGTH, type CheckinServiceContract } from "~/lib/checkin-contract";

const confirmation = z.strictObject({
  stationId: z.enum(CHECKIN_STATION_IDS),
  stationVersion: z.number().int().positive(),
  systemGeneration: z.number().int().positive(),
  bindingVersion: z.number().int().nonnegative(),
});
const controlBase = {
  operationId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  reason: z.enum(CHECKIN_REASON_CODES),
  note: z.string().max(CHECKIN_NOTE_MAX_LENGTH).optional(),
};
const stationId = z.enum(CHECKIN_STATION_IDS);
const adminCommand = z.discriminatedUnion("operation", [
  z.strictObject({ ...controlBase, operation: z.literal("set_system_enabled"), enabled: z.boolean() }),
  z.strictObject({ ...controlBase, operation: z.literal("set_station_enabled"), stationId, enabled: z.boolean() }),
  z.strictObject({ ...controlBase, operation: z.literal("configure_station"), stationId, label: z.string().min(1).max(80), location: z.string().max(120), printerRef: z.string().max(80) }),
  z.strictObject({ ...controlBase, operation: z.literal("rotate_provision_code"), stationId }),
  z.strictObject({ ...controlBase, operation: z.literal("revoke_binding"), bindingId: z.string().regex(/^[a-z0-9]{15}$/) }),
]);
const command = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("status") }),
  z.strictObject({ operation: z.literal("printers") }),
  z.strictObject({ operation: z.literal("select_printer"), confirmation, expectedActorId: z.string().regex(/^[a-z0-9]{15}$/).optional() }),
  z.strictObject({ operation: z.literal("admin_list"), bindingPage: z.number().int().positive().max(10000).optional(), auditPage: z.number().int().positive().max(10000).optional() }),
  z.strictObject({ operation: z.literal("admin_control"), command: adminCommand }),
]);

interface CheckinHttpActor { id: string; role: string }
export interface CheckinHttpDependencies {
  authenticate(): Promise<CheckinHttpActor>;
  service(actor: CheckinHttpActor): Promise<CheckinServiceContract>;
}

function response(body: unknown, status = 200, cookie?: string) {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
  });
  if (cookie) headers.set("Set-Cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

type CheckinCommand = z.infer<typeof command>;
const REJECTIONS = { 400: "Invalid check-in command.", 413: "Check-in command too large." } as const;

/** The 403 message for a command this actor may not send, or null. */
function commandRejection(parsed: CheckinCommand, actor: CheckinHttpActor): string | null {
  if ((parsed.operation === "admin_list" || parsed.operation === "admin_control") && actor.role !== "admin") {
    return "Check-in administration requires an admin.";
  }
  // Cookies are shared across tabs; the old operator's intent must not be sent
  // as a newly signed-in human. This is only a rejection fence, never authority.
  if (parsed.operation === "select_printer" && parsed.expectedActorId && parsed.expectedActorId !== actor.id) {
    return "Operator changed. Refresh before choosing a printer.";
  }
  return null;
}

function clientCookie(request: Request): string {
  const secure = process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto")?.split(",")[0].trim() === "https";
  return `${CLIENT_COOKIE}=${randomBytes(32).toString("hex")}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

async function run(service: CheckinServiceContract, parsed: CheckinCommand, clientToken: string | undefined, request: Request): Promise<Response> {
  if (parsed.operation === "admin_list") {
    return response(await service.adminList({ bindingPage: parsed.bindingPage, auditPage: parsed.auditPage }));
  }
  if (parsed.operation === "admin_control") return response(await service.adminControl(parsed.command));
  if (parsed.operation === "status") return response(await service.status(clientToken));
  // The browser serializes catalogue requests across tabs until the response
  // arrives. Establish identity before selection; never replace an existing cookie.
  if (parsed.operation === "printers") return response(await service.printers(clientToken), 200, clientToken ? undefined : clientCookie(request));
  if (!clientToken) return response({ error: "Load the printer list on this browser before choosing a printer." }, 400);
  return response((await service.selectPrinter(clientToken, parsed.confirmation)).status);
}

function failure(error: unknown): Response {
  if (error instanceof CheckinError) return response({ code: error.code, error: error.message }, error.status);
  // Never serialize PocketBase errors: they can contain request bodies,
  // client identities or server credentials.
  return response({ error: "Check-in unavailable. Refresh before retrying." }, 503);
}

export async function handleCheckinRequest(request: Request, deps: CheckinHttpDependencies): Promise<Response> {
  if (!isSameOriginMutation(request)) return response({ error: "Check-in access denied." }, 403);
  const actor = await authenticateCheckinActor(() => deps.authenticate(), (actor) => actor.role === "admin" || actor.role === "checkin_operator");
  if (!actor) return response({ error: "Check-in access denied." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return response({ error: "Use a JSON check-in command." }, 415);
  }
  const read = await readCheckinCommand(request, 4096, (value) => command.parse(value));
  if (!read.ok) return response({ error: REJECTIONS[read.status] }, read.status);
  const rejection = commandRejection(read.command, actor);
  if (rejection) return response({ error: rejection }, 403);
  const client = checkinClientToken(request);
  if (!client.valid) {
    return response({ error: "Invalid station client identity. Clear this site's data, then choose the station again from the Printer dropdown." }, 403);
  }
  try {
    const service = await deps.service(actor);
    return await run(service, read.command, client.token, request);
  } catch (error) { return failure(error); }
}
