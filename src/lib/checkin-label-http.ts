import { z } from "zod";
import { CHECKIN_REASON_CODES, CHECKIN_STATION_IDS } from "~/lib/checkin-contract";
import { validateLabelProfileConfig } from "~/lib/checkin-label-renderer";
import type { CheckinLabelProfileServiceContract } from "~/lib/checkin-label-profile-contract";
import { LABEL_FONT_VERSION, LABEL_RENDERER_VERSION, LABEL_TEXT_MAX_LENGTH, SYNTHETIC_LABEL_CONFIG, LabelRenderError, type LabelProfile, type LabelRenderInput, type LabelRasterResult } from "~/lib/checkin-label-render-contract";
import { CheckinError } from "~/lib/checkin-service";
import { protectCheckinResponse } from "~/lib/checkin-privacy";
import { isSameOriginMutation } from "~/lib/session-policy";

interface Actor { id: string; role: string }
export interface CheckinLabelHttpDependencies {
  authenticate(): Promise<Actor>;
  service(actor: Actor): Promise<CheckinLabelProfileServiceContract>;
  render(input: LabelRenderInput): Promise<LabelRasterResult>;
}
const text = z.strictObject({ name: z.string().min(1).max(LABEL_TEXT_MAX_LENGTH), affiliation: z.string().max(LABEL_TEXT_MAX_LENGTH) });
const commandFields = { operationId: z.uuid(), expectedVersion: z.number().int().nonnegative(), expectedStationVersion: z.number().int().positive(), reason: z.enum(CHECKIN_REASON_CODES), note: z.string().max(240) };
const schema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("list") }),
  z.strictObject({ operation: z.literal("preview_synthetic"), text }),
  z.strictObject({ operation: z.literal("preview"), profileId: z.string().regex(/^[a-z0-9]{15}$/), expectedVersion: z.number().int().positive(), text }),
  z.strictObject({ operation: z.literal("configure"), command: z.strictObject({ ...commandFields, stationId: z.enum(CHECKIN_STATION_IDS), config: z.unknown() }) }),
  z.strictObject({ operation: z.literal("approve"), command: z.strictObject({ ...commandFields, profileId: z.string().regex(/^[a-z0-9]{15}$/), physicalConfirmation: z.literal(true) }) }),
]);
function response(body: unknown, status = 200) {
  return protectCheckinResponse(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}
export async function handleCheckinLabelRequest(request: Request, deps: CheckinLabelHttpDependencies): Promise<Response> {
  if (!isSameOriginMutation(request)) return response({ error: "Name Label access denied." }, 403);
  let actor: Actor;
  try {
    actor = await deps.authenticate();
    if (actor.role !== "admin") return response({ error: "Name Label configuration requires an admin." }, 403);
  } catch { return response({ error: "Name Label access denied." }, 403); }
  if (!request.headers.get("content-type")?.startsWith("application/json")) return response({ error: "Use a JSON Name Label command." }, 415);
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
          if (size > 16384) { void reader.cancel().catch(() => undefined); return response({ error: "Name Label command too large." }, 413); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
    }
    command = schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch { return response({ error: "Invalid Name Label command." }, 400); }
  try {
    const service = await deps.service(actor);
    if (command.operation === "list") return response({ ...await service.list(), syntheticConfig: SYNTHETIC_LABEL_CONFIG });
    if (command.operation === "configure") return response(await service.configure({ ...command.command, config: validateLabelProfileConfig(command.command.config) }));
    if (command.operation === "approve") return response(await service.approve(command.command));
    let profile: LabelProfile;
    if (command.operation === "preview") profile = await service.get(command.profileId);
    else {
      await service.list();
      profile = { id: "synthetic-preview", stationId: "synthetic-preview", version: 1, approval: "unapproved", config: SYNTHETIC_LABEL_CONFIG };
    }
    const rendered = await deps.render({ text: command.text, profile, mode: "preview", expected: { profileId: profile.id, profileVersion: command.operation === "preview" ? command.expectedVersion : 1, printerRef: profile.config.printerRef, stockRef: profile.config.stockRef, rendererVersion: LABEL_RENDERER_VERSION, fontVersion: LABEL_FONT_VERSION } });
    if (command.operation === "preview") await service.get(command.profileId);
    else await service.list();
    return response(rendered);
  } catch (error) {
    if (error instanceof LabelRenderError) return response({ code: error.code, error: error.message }, ["font_unavailable", "raster_failed"].includes(error.code) ? 503 : 400);
    if (error instanceof CheckinError) return response({ code: error.code, error: error.message }, error.status);
    return response({ error: "Name Label service unavailable. Retry explicitly. No admission or printing was attempted." }, 503);
  }
}
