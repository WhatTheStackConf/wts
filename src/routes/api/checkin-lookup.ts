import { requireCheckinOperatorSession } from "~/lib/server-auth-core";
import { getAdminPB } from "~/lib/pocketbase-admin-service";
import { createCheckinLookupService } from "~/lib/checkin-lookup-server";
import { handleCheckinLookupRequest } from "~/lib/checkin-lookup-http";

export async function POST(event: { request: Request }) {
  return handleCheckinLookupRequest(event.request, {
    authenticate: async () => (await requireCheckinOperatorSession()).user,
    service: async (actor) => createCheckinLookupService(await getAdminPB().getInstance(), { userId: actor.id, role: actor.role }),
  });
}
