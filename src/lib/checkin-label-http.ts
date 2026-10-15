import { z } from "zod";
import { CHECKIN_REASON_CODES, CHECKIN_STATION_IDS } from "~/lib/checkin-contract";
import { validateLabelProfileConfig } from "~/lib/checkin-label-renderer";
import type { CheckinLabelProfileServiceContract } from "~/lib/checkin-label-profile-contract";
import { LABEL_FONT_VERSION, LABEL_RENDERER_VERSION, LABEL_TEXT_MAX_LENGTH, SYNTHETIC_LABEL_CONFIG, LabelRenderError, type LabelProfile, type LabelRenderInput, type LabelRasterResult } from "~/lib/checkin-label-render-contract";
import { CheckinError } from "~/lib/checkin-service";
import { protectCheckinResponse } from "~/lib/checkin-privacy";
import { isSameOriginMutation } from "~/lib/session-policy";
import { readCheckinCommand } from "~/lib/checkin-http-request";

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
type LabelCommand = z.infer<typeof schema>;
const REJECTIONS = { 400: "Invalid Name Label command.", 413: "Name Label command too large." } as const;
type PreviewCommand = Extract<LabelCommand, { operation: "preview" | "preview_synthetic" }>;
function response(body: unknown, status = 200) {
  return protectCheckinResponse(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}
function failure(error: unknown): Response {
  if (error instanceof LabelRenderError) return response({ code: error.code, error: error.message }, ["font_unavailable", "raster_failed"].includes(error.code) ? 503 : 400);
  if (error instanceof CheckinError) return response({ code: error.code, error: error.message }, error.status);
  return response({ error: "Name Label service unavailable. Retry explicitly. No admission or printing was attempted." }, 503);
}
async function preview(command: PreviewCommand, service: CheckinLabelProfileServiceContract, deps: CheckinLabelHttpDependencies): Promise<LabelRasterResult> {
  let profile: LabelProfile;
  if (command.operation === "preview") profile = await service.get(command.profileId);
  else {
    await service.list();
    profile = { id: "synthetic-preview", stationId: "synthetic-preview", version: 1, approval: "unapproved", config: SYNTHETIC_LABEL_CONFIG };
  }
  const rendered = await deps.render({ text: command.text, profile, mode: "preview", expected: { profileId: profile.id, profileVersion: command.operation === "preview" ? command.expectedVersion : 1, printerRef: profile.config.printerRef, stockRef: profile.config.stockRef, rendererVersion: LABEL_RENDERER_VERSION, fontVersion: LABEL_FONT_VERSION } });
  if (command.operation === "preview") await service.get(command.profileId);
  else await service.list();
  return rendered;
}
async function run(command: LabelCommand, service: CheckinLabelProfileServiceContract, deps: CheckinLabelHttpDependencies): Promise<unknown> {
  if (command.operation === "list") return { ...await service.list(), syntheticConfig: SYNTHETIC_LABEL_CONFIG };
  if (command.operation === "configure") return service.configure({ ...command.command, config: validateLabelProfileConfig(command.command.config) });
  if (command.operation === "approve") return service.approve(command.command);
  return preview(command, service, deps);
}
export async function handleCheckinLabelRequest(request: Request, deps: CheckinLabelHttpDependencies): Promise<Response> {
  if (!isSameOriginMutation(request)) return response({ error: "Name Label access denied." }, 403);
  let actor: Actor;
  try {
    actor = await deps.authenticate();
    if (actor.role !== "admin") return response({ error: "Name Label configuration requires an admin." }, 403);
  } catch { return response({ error: "Name Label access denied." }, 403); }
  if (!request.headers.get("content-type")?.startsWith("application/json")) return response({ error: "Use a JSON Name Label command." }, 415);
  const read = await readCheckinCommand(request, 16384, (value) => schema.parse(value));
  if (!read.ok) return response({ error: REJECTIONS[read.status] }, read.status);
  try {
    const service = await deps.service(actor);
    return response(await run(read.command, service, deps));
  } catch (error) { return failure(error); }
}
