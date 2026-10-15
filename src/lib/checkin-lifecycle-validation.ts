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
const lifecycleStatusShape = z.strictObject({
  edition: z.literal("WTS2026"), closedAt: time, purgeDeadline: time, centralDeletedAt: time, centralCompactedAt: time,
  totals: z.strictObject({ workflows: count, prints: count }).nullable(),
  restoreRequired: z.boolean(), restoreGeneration: count, reconciledAt: time, approvedAt: time,
  devices: z.array(z.strictObject({ id: z.string().min(1).max(128), stationId: z.string().min(1).max(128), journalIdentity: z.string().max(256), completedAt: time, method: z.string().min(1).max(80).nullable(), unreachable: z.boolean() })).max(1000),
});
type Status = z.infer<typeof lifecycleStatusShape>;
/** A timestamp precedes its prerequisite when that prerequisite is missing or later. */
const precedes = (value: string, prerequisite: string | null) => !prerequisite || Date.parse(value) < Date.parse(prerequisite);
const invariants: [message: string, violated: (s: Status) => boolean][] = [
  ["Closure requires a fixed deadline", (s) => !!s.closedAt !== !!s.purgeDeadline],
  ["Deadline must be thirty days after closure", (s) => !!s.closedAt && !!s.purgeDeadline && Date.parse(s.purgeDeadline) - Date.parse(s.closedAt) !== 30 * 24 * 60 * 60 * 1000],
  ["Deletion cannot precede deadline", (s) => !!s.centralDeletedAt && precedes(s.centralDeletedAt, s.purgeDeadline)],
  ["Compaction requires deletion", (s) => !!s.centralCompactedAt && precedes(s.centralCompactedAt, s.centralDeletedAt)],
  ["Anonymous totals accompany central deletion", (s) => !!s.totals !== !!s.centralDeletedAt],
  ["Approval requires reconciled state", (s) => !!s.approvedAt && (s.restoreRequired || precedes(s.approvedAt, s.reconciledAt))],
  ["Duplicate device identity", (s) => new Set(s.devices.map((d) => d.id)).size !== s.devices.length],
];
export const lifecycleStatusSchema = lifecycleStatusShape.superRefine((s, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
  for (const [message, violated] of invariants) if (violated(s)) invalid(message);
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
