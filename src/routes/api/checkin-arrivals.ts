import { requireCheckinOperatorSession } from "~/lib/server-auth-core";
import { getAdminPB } from "~/lib/pocketbase-admin-service";
import { CheckinArrivalService } from "~/lib/checkin-arrival-service";
import { createCheckinArrivalSource } from "~/lib/checkin-arrival-source";
import { handleCheckinArrivalRequest } from "~/lib/checkin-arrival-http";

/** Authenticated preflight and scoped history only; no admission or print API. */
export async function POST(event: { request: Request }) {
  return handleCheckinArrivalRequest(event.request, {
    authenticate: async () => (await requireCheckinOperatorSession()).user,
    service: async (actor) => new CheckinArrivalService(await getAdminPB().getInstance(), { userId: actor.id, role: actor.role }, createCheckinArrivalSource()),
  });
}
