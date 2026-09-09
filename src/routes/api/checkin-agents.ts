import { requireCheckinOperatorSession } from "~/lib/server-auth-core";
import { getAdminPB } from "~/lib/pocketbase-admin-service";
import { CheckinAgentService } from "~/lib/checkin-agent-service";
import { handleCheckinAgentRequest } from "~/lib/checkin-agent-http";
export async function POST(event: { request: Request }) {
  return handleCheckinAgentRequest(event.request, {
    authenticate: async () => (await requireCheckinOperatorSession()).user,
    service: async (actor) => new CheckinAgentService(await getAdminPB().getInstance(), { userId: actor.id, role: actor.role }),
  });
}
