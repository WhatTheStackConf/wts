import { z } from "zod";
import { CHECKIN_STATION_IDS } from "~/lib/checkin-contract";
import { LABEL_FONT_VERSION, LABEL_RENDERER_VERSION, LABEL_TEXT_MAX_LENGTH } from "~/lib/checkin-label-render-contract";

/** Browser-safe structural schemas shared with the server renderer. Geometric
 * fitting and live approval authority are still enforced on the server. */
export const labelAssetReferenceSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/).refine((value) => !/[a-f0-9]{64}|wts_mcp_|bearer|password|secret/i.test(value));
const dots = z.number().int().min(0).max(2048);
const dimension = z.number().int().min(1).max(2048);
const localId = z.string().regex(/^[a-z0-9]{15}$/);
export const labelProfileConfigSchema = z.strictObject({
  rendererVersion: z.literal(LABEL_RENDERER_VERSION), fontVersion: z.literal(LABEL_FONT_VERSION),
  printerRef: labelAssetReferenceSchema, stockRef: labelAssetReferenceSchema, synthetic: z.boolean(),
  media: z.strictObject({ widthMm: z.literal(50), heightMm: z.literal(30), kind: z.literal("precut-gap") }),
  raster: z.strictObject({ width: dimension, height: dimension }),
  printable: z.strictObject({ x: dots, y: dots, width: dimension, height: dimension }),
  margins: z.strictObject({ top: dots, right: dots, bottom: dots, left: dots }),
  offset: z.strictObject({ x: z.number().int().min(-2048).max(2048), y: z.number().int().min(-2048).max(2048) }),
  direction: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  feed: z.strictObject({ mode: z.literal("gap"), gapDots: dimension, advanceDots: dots }),
  density: z.number().int().min(1).max(5), threshold: z.number().int().min(1).max(254),
});
const profile = z.strictObject({ id: labelAssetReferenceSchema, stationId: labelAssetReferenceSchema, version: z.number().int().positive(), approval: z.enum(["unapproved", "approved"]), config: labelProfileConfigSchema });
const storedProfile = profile.extend({ id: localId, stationId: z.enum(CHECKIN_STATION_IDS) });
export const labelProfileResultSchema = z.strictObject({ actionId: localId, replayed: z.boolean(), profile: storedProfile });
export const labelCatalogueSchema = z.strictObject({
  profiles: z.array(storedProfile).max(3),
  profileStationVersions: z.record(localId, z.number().int().positive()),
  stations: z.array(z.strictObject({ id: z.enum(CHECKIN_STATION_IDS), label: z.string().max(80), printerRef: z.string().max(80), version: z.number().int().positive() })).max(3),
  operationsEnabled: z.literal(false), syntheticConfig: labelProfileConfigSchema.refine((config) => config.synthetic),
}).refine((value) => value.profiles.every((profile) => value.profileStationVersions[profile.id] !== undefined));
const text = z.strictObject({ name: z.string().min(1).max(LABEL_TEXT_MAX_LENGTH), affiliation: z.string().max(LABEL_TEXT_MAX_LENGTH) });
const row = z.strictObject({ text: z.string().max(LABEL_TEXT_MAX_LENGTH + 1), fontSize: z.number().int().min(1).max(64), shortened: z.boolean() });
export const labelRasterResultSchema = z.strictObject({
  pngBase64: z.string().max(12_000_000).regex(/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/),
  width: dimension, height: dimension, payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  snapshot: z.strictObject({ text, profile, rendererVersion: z.literal(LABEL_RENDERER_VERSION), fontVersion: z.literal(LABEL_FONT_VERSION) }),
  rows: z.tuple([row, row]),
});
