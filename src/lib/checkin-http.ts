import { randomBytes } from "node:crypto";
import { z } from "zod";
import { isSameOriginMutation } from "~/lib/session-policy";
import { CheckinError } from "~/lib/checkin-service";
import { CHECKIN_STATION_IDS, CHECKIN_REASON_CODES, CHECKIN_NOTE_MAX_LENGTH, type CheckinServiceContract } from "~/lib/checkin-contract";

const CLIENT_COOKIE = "wts_checkin_client";
const opaqueToken = z.string().regex(/^[a-f0-9]{64}$/);
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
  z.strictObject({ operation: z.literal("preview"), code: opaqueToken }),
  z.strictObject({ operation: z.literal("bind"), code: opaqueToken, confirmation }),
  z.strictObject({ operation: z.literal("admin_list"), bindingPage: z.number().int().positive().max(10000).optional(), auditPage: z.number().int().positive().max(10000).optional() }),
  z.strictObject({ operation: z.literal("admin_control"), command: adminCommand }),
]);

interface CheckinHttpActor { id: string; role: string }
export interface CheckinHttpDependencies {
  authenticate(): Promise<CheckinHttpActor>;
  service(actor: CheckinHttpActor): Promise<CheckinServiceContract>;
  provisioningQr(url: string): Promise<string>;
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

export async function handleCheckinRequest(request: Request, deps: CheckinHttpDependencies): Promise<Response> {
  if (!isSameOriginMutation(request)) return response({ error: "Check-in access denied." }, 403);
  let actor: CheckinHttpActor;
  try {
    actor = await deps.authenticate();
    if (actor.role !== "admin" && actor.role !== "checkin_operator") {
      return response({ error: "Check-in access denied." }, 403);
    }
  } catch {
    return response({ error: "Check-in access denied." }, 403);
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return response({ error: "Use a JSON check-in command." }, 415);
  }
  let parsed: z.infer<typeof command>;
  try {
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 4096) {
            void reader.cancel().catch(() => undefined);
            return response({ error: "Check-in command too large." }, 413);
          }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
    }
    const text = Buffer.concat(chunks).toString("utf8");
    parsed = command.parse(JSON.parse(text));
  } catch {
    return response({ error: "Invalid check-in command." }, 400);
  }
  if ((parsed.operation === "admin_list" || parsed.operation === "admin_control") && actor.role !== "admin") {
    return response({ error: "Check-in administration requires an admin." }, 403);
  }
  const cookies = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${CLIENT_COOKIE}=`));
  const clientToken = cookies[0]?.slice(CLIENT_COOKIE.length + 1);
  if (cookies.length > 1 || (clientToken !== undefined && !opaqueToken.safeParse(clientToken).success)) {
    return response({ error: "Invalid station client identity. Clear this site's data to reprovision." }, 403);
  }
  try {
    const service = await deps.service(actor);
    if (parsed.operation === "admin_list") {
      return response(await service.adminList({ bindingPage: parsed.bindingPage, auditPage: parsed.auditPage }));
    }
    if (parsed.operation === "admin_control") {
      const result = await service.adminControl(parsed.command);
      if (!result.provisionCode) return response(result);
      // The browser's verified same-origin header gives the public origin behind
      // a reverse proxy. The code stays in the fragment, never the request URL.
      const provisionUrl = `${new URL(request.headers.get("origin")!).origin}/checkin#provision=${result.provisionCode}`;
      return response({ ...result, provisionUrl, qrDataUrl: await deps.provisioningQr(provisionUrl) });
    }
    if (parsed.operation === "status") return response(await service.status(clientToken));
    if (parsed.operation === "preview") {
      const preview = await service.preview(parsed.code, clientToken);
      // Establish identity before confirmation, so concurrent confirmations use
      // the same database-unique client rather than creating independent phones.
      const secure = process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto")?.split(",")[0].trim() === "https";
      const cookie = clientToken ? undefined : `${CLIENT_COOKIE}=${randomBytes(32).toString("hex")}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
      return response(preview, 200, cookie);
    }
    if (!clientToken) return response({ error: "Review the station on this browser before confirming." }, 400);
    const result = await service.bind(parsed.code, clientToken, parsed.confirmation);
    return response(result.status);
  } catch (error) {
    if (error instanceof CheckinError) return response({ code: error.code, error: error.message }, error.status);
    // Never serialize PocketBase errors: they can contain request bodies,
    // provisioning identities or server credentials.
    return response({ error: "Check-in unavailable. Refresh before retrying." }, 503);
  }
}
