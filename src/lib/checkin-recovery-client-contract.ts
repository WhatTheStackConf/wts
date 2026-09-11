import { z } from "zod";
import { recoveryCommandSchema } from "./checkin-recovery-contract";
import { CHECKIN_STATION_IDS } from "./checkin-contract";
import { labelProfileConfigSchema } from "./checkin-label-validation";

export const recoveryId = z.string().regex(/^[a-z0-9]{15}$/);
const safeText = z.string().max(300).refine(v => !/[\x00-\x1f\x7f<>@]|:\/\/|www\.|[a-f0-9]{64}|bearer|password|secret|token\s*[:=]|\/dev\/|\b[A-Z]-[A-Z0-9]{7}\b/i.test(v));
const state = z.string().max(60).regex(/^[a-z_]*$/);
const timestamp = z.string().max(40).regex(/^[0-9TZ:. +\-]*$/);
const upstream = z.string().regex(/^[1-9][0-9]{0,15}$/).refine(v => Number.isSafeInteger(Number(v)));
const optionalUpstream = z.union([z.literal(""), upstream]);
const readState = z.enum(["absent", "existing", "malformed", "unavailable"]);
const readFields = { id: recoveryId, state: readState, checkinId: optionalUpstream };
export const recoveryReadSchema = z.strictObject(readFields).refine(v => (v.state === "existing") === !!v.checkinId);
export const recoveryAttemptSchema = z.strictObject({ id: recoveryId, purpose: z.enum(["initial", "replacement"]), state: z.enum(["queued", "dispatched", "completed", "uncertain", "cancelled"]), name: safeText, affiliation: safeText, predecessorId: z.union([recoveryId, z.literal("")]), observation: z.enum(["printed", "not_printed"]).nullable(), cancellation: z.enum(["pending", "acknowledged"]).nullable() });
export const recoveryAttemptHistorySchema = z.strictObject({ workflowId: recoveryId, items: z.array(recoveryAttemptSchema).max(25), nextOffset: z.number().int().nonnegative().nullable() }).refine(v => new Set(v.items.map(a => a.id)).size === v.items.length && (v.nextOffset === null || v.items.length === 25));
export type RecoveryAttemptHistory = z.infer<typeof recoveryAttemptHistorySchema>;
export const recoveryWorkflowSchema = z.strictObject({
  workflowId: recoveryId, stationId: z.enum(CHECKIN_STATION_IDS), eventId: recoveryId, eventTitle: safeText,
  admissionState: z.enum(["not_submitted", "admission_pending", "accepted", "existing_unattributed", "rejected", "admission_uncertain"]),
  admissionReadRetryEligible: z.boolean(),
  version: z.number().int().nonnegative(), name: safeText, affiliation: safeText, decision: state, fulfillment: state,
  parked: z.boolean(), completedDay: z.string().regex(/^(?:\d{4}-\d{2}-\d{2})?$/), isolated: z.boolean(),
  profile: z.strictObject({ id: recoveryId, stationId: z.enum(CHECKIN_STATION_IDS), version: z.number().int().positive(), approval: z.enum(["approved", "unapproved"]), config: labelProfileConfigSchema }),
  attempts: z.array(recoveryAttemptSchema).max(25), attemptsTruncated: z.boolean().optional(),
  reads: z.array(z.strictObject({ ...readFields, createdAt: timestamp }).refine(v => (v.state === "existing") === !!v.checkinId)).max(20),
  admissionAttempts: z.array(z.strictObject({ id: recoveryId, state, listId: upstream, attendeeId: upstream, sendBoundaryAt: timestamp, completedAt: timestamp, fingerprint: z.string().regex(/^(?:[a-f0-9]{64})?$/) })).max(20),
  resets: z.array(z.strictObject({ id: recoveryId, state, checkinId: upstream, sendBoundaryAt: timestamp })).max(20), operationsEnabled: z.literal(false),
}).refine(v => v.profile.stationId === v.stationId);
export const recoveryHistorySchema = z.strictObject({ items: z.array(recoveryWorkflowSchema).max(25), nextOffset: z.number().int().nonnegative().nullable() });
export const recoveryResultSchema = z.strictObject({
  operationId: z.uuid(), workflow: recoveryWorkflowSchema,
  replayed: z.boolean().optional(), commandId: recoveryId.optional(), commandVersion: z.number().int().positive().optional(),
  commandOutcome: z.strictObject({ decision: state, fulfillment: state, printId: z.union([recoveryId, z.literal("")]).optional() }).optional(),
}).refine(result => {
  const present = [result.replayed, result.commandId, result.commandVersion, result.commandOutcome].filter(value => value !== undefined).length;
  return present === 0 || present === 4;
});
const labelText = z.strictObject({ name: safeText.min(1).max(200), affiliation: safeText.max(200) });
export const recoveryPreviewSchema = z.strictObject({ workflowId: recoveryId, name: safeText, affiliation: safeText, pngBase64: z.string().max(12_000_000).regex(/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/), width: z.number().int().min(1).max(2048), height: z.number().int().min(1).max(2048), rows: z.tuple([z.strictObject({ text: safeText, fontSize: z.number().int().min(1).max(64), shortened: z.boolean() }), z.strictObject({ text: safeText, fontSize: z.number().int().min(1).max(64), shortened: z.boolean() })]) });
export const recoveryRequestSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("get"), workflowId: recoveryId }),
  z.strictObject({ operation: z.literal("attempt_history"), workflowId: recoveryId, offset: z.number().int().nonnegative() }),
  z.strictObject({ operation: z.literal("history"), offset: z.number().int().min(0).max(1_000_000) }),
  z.strictObject({ operation: z.literal("reconcile"), workflowId: recoveryId }),
  z.strictObject({ operation: z.literal("preview"), workflowId: recoveryId, ...labelText.shape }),
  z.strictObject({ operation: z.literal("command"), command: recoveryCommandSchema }),
]);
export type RecoveryPreview = z.infer<typeof recoveryPreviewSchema>;
export type RecoveryHistory = z.infer<typeof recoveryHistorySchema>;
export const isRecoveryTruthCommand = (operation: string) => ["authorize_initial", "deny", "cancel", "continue", "reset"].includes(operation);
// Keep browser imports free of renderer, privileged client and server secrets.
