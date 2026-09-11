import { requireCheckinOperatorSession } from "~/lib/server-auth-core";
import { getAdminPB } from "~/lib/pocketbase-admin-service";
import { CheckinArrivalResumeService } from "~/lib/checkin-arrival-resume-service";
import { createCheckinArrivalSource } from "~/lib/checkin-arrival-source";
import { handleCheckinArrivalResumeRequest } from "~/lib/checkin-arrival-resume-http";

/** Authenticated preflight and scoped history only; no admission or print API. */
export async function POST(event: { request: Request }) {
  return handleCheckinArrivalResumeRequest(event.request, {
    authenticate: async () => (await requireCheckinOperatorSession()).user,
    service: async (actor) => new CheckinArrivalResumeService(await getAdminPB().getInstance(), { userId: actor.id, role: actor.role }, createCheckinArrivalSource()),
  });
}
