import { z } from "zod";
import { checkinEventContextSchema } from "~/lib/checkin-event-validation";
import type { CheckinArrivalResult } from "~/lib/checkin-arrival-contract";

export const checkinArrivalResumeOperationIdSchema = z.uuid().regex(/^[a-f0-9-]+$/);
export const checkinArrivalResumeInputSchema = z.discriminatedUnion("action", [
  z.strictObject({ operationId: checkinArrivalResumeOperationIdSchema, action: z.literal("replay"), qrIdentity: z.string().max(2048) }),
  z.strictObject({ operationId: checkinArrivalResumeOperationIdSchema, action: z.enum(["retry", "blank"]), nextOperationId: checkinArrivalResumeOperationIdSchema, qrIdentity: z.string().max(2048) }),
]).refine((v) => !("nextOperationId" in v) || v.nextOperationId !== v.operationId);
export const checkinArrivalResumeSchema = z.strictObject({
  operationId: checkinArrivalResumeOperationIdSchema,
  context: checkinEventContextSchema,
  status: z.enum(["pending", "final"]),
  state: z.enum(["pending", "reserved", "existing", "accepted", "admission_pending", "admission_uncertain", "existing_unattributed", "already_handled", "rejected", "dependency_unavailable", "needs_affiliation_choice"]),
  affiliationChoice: z.enum(["fetch", "blank"]),
  priorOperationId: checkinArrivalResumeOperationIdSchema.optional(),
  recovery: z.enum(["available", "context_changed", "read_only"]),
  actions: z.array(z.enum(["replay", "retry", "blank"])).max(2),
  operationsEnabled: z.literal(false),
});
export const checkinArrivalResumeRequestSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("get"), operationId: checkinArrivalResumeOperationIdSchema }),
  z.strictObject({ operation: z.literal("resume"), command: checkinArrivalResumeInputSchema }),
]);
export type CheckinArrivalResume = z.infer<typeof checkinArrivalResumeSchema>;
export type CheckinArrivalResumeInput = z.infer<typeof checkinArrivalResumeInputSchema>;
export interface CheckinArrivalResumeServiceContract {
  get(bindingToken: string | undefined, operationId: string): Promise<CheckinArrivalResume>;
  resume(bindingToken: string | undefined, input: CheckinArrivalResumeInput): Promise<CheckinArrivalResult>;
}
