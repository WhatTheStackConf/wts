import { requireCheckinOperatorSession } from "~/lib/server-auth-core";
import { getAdminPB } from "~/lib/pocketbase-admin-service";
import { CheckinLifecycleService } from "~/lib/checkin-lifecycle-service";
import { handleCheckinLifecycleRequest } from "~/lib/checkin-lifecycle-http";

/** Uses the existing server-managed HttpOnly session, never station credentials. */
export async function POST(event: { request: Request }) {
  return handleCheckinLifecycleRequest(event.request, {
    authenticate: async () => (await requireCheckinOperatorSession()).user,
    service: async (actor) => new CheckinLifecycleService(await getAdminPB().getInstance(), { userId: actor.id, role: actor.role }),
  });
}
