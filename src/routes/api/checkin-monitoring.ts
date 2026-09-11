import { requireCheckinOperatorSession } from "~/lib/server-auth-core";
import { getAdminPB } from "~/lib/pocketbase-admin-service";
import { CheckinMonitoringService } from "~/lib/checkin-monitoring-service";
import { handleCheckinMonitoringRequest } from "~/lib/checkin-monitoring-http";
export async function POST(event: { request: Request }) {
  return handleCheckinMonitoringRequest(event.request, {
    authenticate: async () => (await requireCheckinOperatorSession()).user,
    service: async (actor) => new CheckinMonitoringService(await getAdminPB().getInstance(), { userId: actor.id, role: actor.role }),
  });
}
