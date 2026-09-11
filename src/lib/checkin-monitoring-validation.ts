import { z } from "zod";
import { CHECKIN_STATION_IDS } from "~/lib/checkin-contract";
const id = z.string().regex(/^[a-z0-9]{15}$/);
const ms = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const thresholds = { waitingMs: z.number().int().min(1000).max(3600000), incidentMs: z.number().int().min(1000).max(3600000), repeatMs: z.number().int().min(900000).max(86400000), recipientUserIds: z.array(id).max(20).refine((ids) => new Set(ids).size === ids.length) };
export const monitoringConfigSchema = z.strictObject({ version: z.number().int().positive(), ...thresholds }).refine((c) => c.incidentMs >= c.waitingMs);
export const monitoringCommandSchema = z.strictObject({ operationId: z.uuid(), expectedVersion: z.number().int().positive(), ...thresholds }).refine((c) => c.incidentMs >= c.waitingMs);
const incident = z.strictObject({
  id, stationId: z.enum(CHECKIN_STATION_IDS), workflowId: id.nullable(),
  category: z.enum(["station_unavailable", "work_stalled", "admission_uncertain", "output_uncertain"]),
  sinceMs: ms, openedMs: ms, recoveredMs: ms, acknowledgedMs: ms, nextDeliveryMs: ms,
  delivery: z.enum(["none", "pending", "possibly_sent", "sent", "failed", "unknown", "cancelled"]),
  deliveryKind: z.enum(["open", "repeat", "recovery"]).nullable(),
  nextAction: z.enum(["configure_recipients", "investigate_delivery_no_retry", "await_worker", "none", "wait_for_repeat"]),
});
const base = { lastTickMs: ms, recipientsConfigured: z.boolean(), hasMore: z.boolean(), incidents: z.array(incident).max(100) };
export const monitoringOperatorSchema = z.strictObject({ ...base, scope: z.enum(["unbound", ...CHECKIN_STATION_IDS]) }).refine((d) => d.incidents.every((i) => i.stationId === d.scope));
export const monitoringAdminSchema = z.strictObject({ ...base, scope: z.literal("all"), config: monitoringConfigSchema, adminChoices: z.array(z.strictObject({ id, email: z.email().max(254) })).max(1000), audit: z.array(z.strictObject({ category: z.enum(["configured", "acknowledged", "opened", "recovered", "delivery_boundary", "delivery_sent", "delivery_failed", "delivery_unknown"]), incidentId: z.union([id, z.literal("")]), deliveryId: z.union([id, z.literal("")]), actorUserId: z.union([id, z.literal("")]), atMs: ms })).max(100) });
export const monitoringDashboardSchema = z.union([monitoringOperatorSchema, monitoringAdminSchema]);
export const monitoringAckSchema = z.strictObject({ incidentId: id, acknowledgedMs: ms.refine((v) => v > 0) });
export const monitoringRequestSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("dashboard"), offset: z.number().int().min(0).max(1000000).optional() }),
  z.strictObject({ operation: z.literal("configure"), command: monitoringCommandSchema }),
  z.strictObject({ operation: z.literal("acknowledge"), incidentId: id }),
]);
