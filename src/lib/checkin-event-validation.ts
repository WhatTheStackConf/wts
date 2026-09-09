import { z } from "zod";
import { CHECKIN_REASON_CODES, CHECKIN_STATION_IDS } from "~/lib/checkin-contract";

/** Upstream integer IDs are exact decimal strings, never trimmed/coerced. */
export const checkinUpstreamId = z.string().regex(/^[1-9][0-9]{0,15}$/).refine((value) => Number.isSafeInteger(Number(value)));
const generation = z.number().int().positive();
const localId = z.string().regex(/^[a-z0-9]{15}$/);
export const configureCheckinEventSchema = z.strictObject({
  operationId: z.uuid(), expectedGeneration: z.number().int().nonnegative(),
  upstreamEventId: checkinUpstreamId, member: z.boolean(), enabled: z.boolean(),
  listId: z.union([checkinUpstreamId, z.literal("")]),
  affiliation: z.strictObject({ questionId: checkinUpstreamId, productIds: z.array(checkinUpstreamId).max(50).refine((ids) => new Set(ids).size === ids.length) }).nullable(),
  reason: z.enum(CHECKIN_REASON_CODES), note: z.string().max(240).optional(),
});
export const selectCheckinEventSchema = z.strictObject({
  eventId: localId, eventGeneration: generation, bindingVersion: generation,
  selectionVersion: z.number().int().nonnegative(), stationGeneration: generation, systemGeneration: generation,
});
export const checkinEventContextSchema = z.strictObject({
  ...selectCheckinEventSchema.shape,
  protocolVersion: z.literal(1), edition: z.literal("WTS2026"), bindingId: localId, stationId: z.enum(CHECKIN_STATION_IDS),
});
