import { z } from "zod";
import { checkinEventContextSchema } from "~/lib/checkin-event-validation";

/** Browser-safe, exact case-sensitive QR identity. Pinned Hi.Events IdHelper
 * publicId('a') produces A- plus seven uppercase alphanumerics; AttendeeTicket
 * encodes it verbatim. Never trim, case-fold or extract a URL wrapper. */
export function isCheckinArrivalQrIdentity(value: unknown): value is string {
  return typeof value === "string" && /^A-[A-Z0-9]{7}$/.test(value);
}
export const checkinArrivalQrIdentitySchema = z.string().refine(isCheckinArrivalQrIdentity);
export const checkinArrivalInputSchema = z.strictObject({
  operationId: z.uuid().regex(/^[a-f0-9-]+$/), context: checkinEventContextSchema,
  // Bounded malformed identities still receive a durable rejected command.
  qrIdentity: z.string().max(2048), affiliationChoice: z.enum(["fetch", "blank"]),
  priorOperationId: z.uuid().regex(/^[a-f0-9-]+$/).optional(),
});
export const checkinArrivalHistoryQuerySchema = z.strictObject({
  scope: z.enum(["station", "all"]).default("station"),
  cursor: z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?\|[a-z0-9]{15}$/).optional(),
  limit: z.number().int().min(1).max(100).default(30),
});
