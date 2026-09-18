import { z } from "zod";
import { checkinEventContextSchema } from "~/lib/checkin-event-validation";
import { checkinArrivalInputSchema, checkinArrivalQrIdentitySchema } from "~/lib/checkin-arrival-validation";

export const checkinLookupSearchInputSchema = z.strictObject({
  context: checkinEventContextSchema,
  query: z.string().trim().max(254).refine(value => !/[\u0000-\u001f\u007f]/u.test(value)),
  offset: z.number().int().min(0).max(10000).default(0),
});
export const checkinLookupAttendeeSchema = z.strictObject({
  attendeeId: z.string().regex(/^[1-9][0-9]{0,15}$/),
  publicId: checkinArrivalQrIdentitySchema,
  name: z.string().min(1).max(200),
  email: z.string().min(3).max(254),
  checkedIn: z.boolean().optional(),
  status: z.enum(["ACTIVE", "CANCELLED", "AWAITING_PAYMENT"]).optional(),
});
export const checkinLookupSearchResultSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("complete"), context: checkinEventContextSchema, items: z.array(checkinLookupAttendeeSchema).max(20), nextOffset: z.number().int().min(1).max(10000).nullable(), totalCount: z.number().int().min(0).max(10000).optional() }),
  z.strictObject({ state: z.enum(["partial", "unavailable"]), context: checkinEventContextSchema, items: z.array(checkinLookupAttendeeSchema).length(0), nextOffset: z.null() }),
]);
export const checkinLookupConfirmInputSchema = checkinArrivalInputSchema.extend({ attendeeId: z.string().regex(/^[1-9][0-9]{0,15}$/) });
export type CheckinLookupSearchInput = z.input<typeof checkinLookupSearchInputSchema>;
export type CheckinLookupSearchResult = z.infer<typeof checkinLookupSearchResultSchema>;
export type CheckinLookupConfirmInput = z.infer<typeof checkinLookupConfirmInputSchema>;
