import { requireCheckinOperatorSession } from "~/lib/server-auth-core";
import { getAdminPB } from "~/lib/pocketbase-admin-service";
import { CheckinEventService } from "~/lib/checkin-event-service";
import { createCheckinEventSource } from "~/lib/checkin-event-source";
import { handleCheckinEventRequest } from "~/lib/checkin-event-http";

/** Only event configuration/selection. No intake or server snapshot is exposed. */
export async function POST(event: { request: Request }) {
  return handleCheckinEventRequest(event.request, {
    authenticate: async () => (await requireCheckinOperatorSession()).user,
    service: async (actor) => new CheckinEventService(await getAdminPB().getInstance(), { userId: actor.id, role: actor.role }, createCheckinEventSource()),
  });
}
