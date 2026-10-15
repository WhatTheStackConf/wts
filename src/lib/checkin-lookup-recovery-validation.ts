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

type Recovery = z.infer<typeof recoverySchema>;
const rules: [message: string, violated: (r: Recovery, operationId: string) => boolean][] = [
  ["Mismatched recovery identity", (r, operationId) => r.operationId !== operationId || new Set(r.actions).size !== r.actions.length],
  ["Changed context cannot grant recovery", (r) => r.recovery === "context_changed" && r.actions.length > 0],
  ["Invalid blank continuation", (r) => r.actions.includes("blank") && r.state !== "needs_affiliation_choice"],
  ["Invalid read continuation", (r) => r.actions.includes("retry") && !["needs_affiliation_choice", "dependency_unavailable"].includes(r.state)],
  ["Mismatched recovered outcome", (r, operationId) => !!r.result && (r.result.operationId !== operationId || r.result.state !== r.state)],
  ["Mismatched recovered origin", (r) => !!r.result && "workflow" in r.result && (r.result.workflow.stationId !== r.context.stationId || r.result.workflow.eventId !== r.context.eventId)],
];

export function parseCheckinLookupRecovery(value: unknown, operationId: string): CheckinLookupRecovery {
  const result = recoverySchema.parse(value);
  const broken = rules.find(([, violated]) => violated(result, operationId));
  if (broken) throw new Error(broken[0]);
  return result;
}
