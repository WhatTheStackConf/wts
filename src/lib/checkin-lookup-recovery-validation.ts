import { z } from "zod";
import { checkinEventContextSchema } from "~/lib/checkin-event-validation";
import { checkinArrivalResultSchema } from "~/lib/checkin-arrival-client";
import { checkinLookupAttendeeSchema } from "~/lib/checkin-lookup-contract";
import { checkinLookupRecoveryOperationIdSchema, type CheckinLookupRecovery } from "~/lib/checkin-lookup-recovery-contract";

const recoverySchema = z.strictObject({
  operationId: checkinLookupRecoveryOperationIdSchema,
  context: checkinEventContextSchema,
  attendeeId: checkinLookupAttendeeSchema.shape.attendeeId,
  state: z.enum(["pending", "reserved", "existing", "accepted", "admission_pending", "admission_uncertain", "existing_unattributed", "already_handled", "rejected", "dependency_unavailable", "needs_affiliation_choice"]),
  recovery: z.enum(["available", "context_changed", "read_only"]),
  actions: z.array(z.enum(["replay", "retry", "blank"])).max(3),
  result: checkinArrivalResultSchema.optional(),
});

export function parseCheckinLookupRecovery(value: unknown, operationId: string): CheckinLookupRecovery {
  const result = recoverySchema.parse(value);
  if (result.operationId !== operationId || new Set(result.actions).size !== result.actions.length) throw new Error("Mismatched recovery identity");
  if (result.recovery === "context_changed" && result.actions.length) throw new Error("Changed context cannot grant recovery");
  if (result.actions.includes("blank") && result.state !== "needs_affiliation_choice") throw new Error("Invalid blank continuation");
  if (result.actions.includes("retry") && !["needs_affiliation_choice", "dependency_unavailable"].includes(result.state)) throw new Error("Invalid read continuation");
  const outcome = result.result;
  if (outcome && (outcome.operationId !== operationId || outcome.state !== result.state)) throw new Error("Mismatched recovered outcome");
  if (outcome && "workflow" in outcome && (outcome.workflow.stationId !== result.context.stationId || outcome.workflow.eventId !== result.context.eventId)) throw new Error("Mismatched recovered origin");
  return result;
}
