import { requireCheckinOperatorSession } from "~/lib/server-auth-core";
import { getAdminPB } from "~/lib/pocketbase-admin-service";
import { CheckinLabelProfileService } from "~/lib/checkin-label-profile-service";
import { renderNameLabel } from "~/lib/checkin-label-renderer";
import { handleCheckinLabelRequest } from "~/lib/checkin-label-http";

/** Admin profile configuration and memory-only preview. No print/intake operation. */
export async function POST(event: { request: Request }) {
  return handleCheckinLabelRequest(event.request, {
    authenticate: async () => (await requireCheckinOperatorSession()).user,
    service: async (actor) => new CheckinLabelProfileService(await getAdminPB().getInstance(), { userId: actor.id, role: actor.role }),
    render: renderNameLabel,
  });
}
