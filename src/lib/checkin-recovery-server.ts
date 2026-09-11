import { requireCheckinOperatorSession } from "./server-auth-core";
import { getAdminPB } from "./pocketbase-admin-service";
import { CheckinRecoveryService } from "./checkin-recovery-service";
import type { RecoverySource } from "./checkin-recovery-contract";
import { handleCheckinRecoveryRequest } from "./checkin-recovery-http";
/** Parent route wiring: export const POST = createCheckinRecoveryPOST(realSource).
 * Source performs exact original-list reads only; no admission/DELETE in HTTP. */
export function createCheckinRecoveryPOST(source: RecoverySource) {
  return (event: { request: Request }) => handleCheckinRecoveryRequest(event.request, {
    authenticate: async () => (await requireCheckinOperatorSession()).user,
    service: async actor => new CheckinRecoveryService(await getAdminPB().getInstance(), { userId: actor.id, role: actor.role }, source),
  });
}
