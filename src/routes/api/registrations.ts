import { requireCheckinOperatorSession } from "~/lib/server-auth-core";
import { handleRegistrations } from "~/lib/registrations-http";
import { readRegistrations } from "~/lib/registrations-source";
export async function POST(event: { request: Request }) {
  return handleRegistrations(event.request, { authenticate: async () => (await requireCheckinOperatorSession()).user, read: readRegistrations });
}
