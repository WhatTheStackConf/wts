import QRCode from "qrcode";
import { requireCheckinOperatorSession } from "~/lib/server-auth-core";
import { getAdminPB } from "~/lib/pocketbase-admin-service";
import { CheckinService } from "~/lib/checkin-service";
import { handleCheckinRequest } from "~/lib/checkin-http";

/** Browser commands use the canonical same-origin, live User session path.
 * No direct collection, attendee admission or printer endpoint is exposed. */
export async function POST(event: { request: Request }) {
  return handleCheckinRequest(event.request, {
    authenticate: async () => (await requireCheckinOperatorSession()).user,
    service: async (actor) => new CheckinService(await getAdminPB().getInstance(), { userId: actor.id, role: actor.role }),
    provisioningQr: (url) => QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 4, width: 640 }),
  });
}
