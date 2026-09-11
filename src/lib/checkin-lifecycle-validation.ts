import { z } from "zod";
import type { LifecycleStatus } from "./checkin-lifecycle-contract";

const time = z.iso.datetime({ offset: true }).nullable();
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const lifecycleRequestSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("status") }),
  z.strictObject({ operation: z.literal("close"), command: z.strictObject({ operationId: z.uuid(), confirmEdition: z.literal("WTS2026") }) }),
  z.strictObject({ operation: z.literal("approve_restore"), command: z.strictObject({ generation: count, confirmEdition: z.literal("WTS2026") }) }),
]);
export type LifecycleRequest = z.infer<typeof lifecycleRequestSchema>;
export const lifecycleStatusSchema = z.strictObject({
  edition: z.literal("WTS2026"), closedAt: time, purgeDeadline: time, centralDeletedAt: time, centralCompactedAt: time,
  totals: z.strictObject({ workflows: count, prints: count }).nullable(),
  restoreRequired: z.boolean(), restoreGeneration: count, reconciledAt: time, approvedAt: time,
  devices: z.array(z.strictObject({ id: z.string().min(1).max(128), stationId: z.string().min(1).max(128), journalIdentity: z.string().max(256), completedAt: time, method: z.string().min(1).max(80).nullable(), unreachable: z.boolean() })).max(1000),
}).superRefine((s, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
  if (!!s.closedAt !== !!s.purgeDeadline) invalid("Closure requires a fixed deadline");
  if (s.closedAt && s.purgeDeadline && Date.parse(s.purgeDeadline) - Date.parse(s.closedAt) !== 30 * 24 * 60 * 60 * 1000) invalid("Deadline must be thirty days after closure");
  if (s.centralDeletedAt && (!s.purgeDeadline || Date.parse(s.centralDeletedAt) < Date.parse(s.purgeDeadline))) invalid("Deletion cannot precede deadline");
  if (s.centralCompactedAt && (!s.centralDeletedAt || Date.parse(s.centralCompactedAt) < Date.parse(s.centralDeletedAt))) invalid("Compaction requires deletion");
  if (!!s.totals !== !!s.centralDeletedAt) invalid("Anonymous totals accompany central deletion");
  if (s.approvedAt && (!s.reconciledAt || s.restoreRequired || Date.parse(s.approvedAt) < Date.parse(s.reconciledAt))) invalid("Approval requires reconciled state");
  if (new Set(s.devices.map((d) => d.id)).size !== s.devices.length) invalid("Duplicate device identity");
  for (const d of s.devices) if (!!d.completedAt !== !!d.method) invalid("Device completion requires method");
});
/** The saved service contract has no operation-ID echo; verify every identity
 * it does expose, rather than claiming per-command audit acknowledgement. */
export function validateLifecycleResponse(value: unknown, request: LifecycleRequest): LifecycleStatus {
  const status = lifecycleStatusSchema.parse(value);
  if (request.operation === "close" && !status.closedAt) throw new Error("Closure not confirmed");
  if (request.operation === "approve_restore" && (status.restoreGeneration !== request.command.generation || status.restoreRequired || !status.reconciledAt || !status.approvedAt || status.closedAt)) throw new Error("Restore approval not confirmed for this generation");
  return status;
}
