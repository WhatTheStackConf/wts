import { z } from "zod";
import type { CheckinArrivalResult } from "~/lib/checkin-arrival-contract";
import type { CheckinEventContext } from "~/lib/checkin-event-contract";
export const checkinLookupRecoveryOperationIdSchema = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
export const checkinLookupRecoverInputSchema = z.discriminatedUnion("action", [
  z.strictObject({ operationId: checkinLookupRecoveryOperationIdSchema, action: z.literal("replay") }),
  z.strictObject({ operationId: checkinLookupRecoveryOperationIdSchema, action: z.enum(["retry", "blank"]), nextOperationId: checkinLookupRecoveryOperationIdSchema }),
]);
export type CheckinLookupRecoverInput = z.infer<typeof checkinLookupRecoverInputSchema>;
export interface CheckinLookupRecovery {
  operationId: string; context: CheckinEventContext; attendeeId: string; state: "pending" | CheckinArrivalResult["state"];
  recovery: "available" | "context_changed" | "read_only";
  actions: ("replay" | "retry" | "blank")[];
  result?: CheckinArrivalResult;
}
export interface CheckinLookupRecoveryServiceContract {
  getRecovery(token: string | undefined, operationId: string): Promise<CheckinLookupRecovery>;
  recover(token: string | undefined, input: CheckinLookupRecoverInput): Promise<CheckinArrivalResult>;
}
