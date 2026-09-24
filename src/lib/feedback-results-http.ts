import { requireAdmin } from "./server-auth-core";
import { getAdminPB } from "./pocketbase-admin-service";
import { loadFeedbackResults } from "./feedback-results-store";
import { isSameOriginMutation } from "./session-policy";
function reply(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: {
    "Content-Type": "application/json", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive", "Vary": "Cookie, Origin", ...(status === 405 ? { Allow: "POST" } : {}),
  } });
}
export async function handleFeedbackResults(request: Request): Promise<Response> {
  if (request.method !== "POST") return reply({ state: "invalid" }, 405);
  if (!isSameOriginMutation(request)) return reply({ state: "denied" }, 403);
  try {
    await requireAdmin();
    // Never instantiate a privileged client or query feedback before this guard.
    const pb = await getAdminPB().getInstance();
    return reply({ state: "ready", results: await loadFeedbackResults(pb) }, 200);
  } catch (error) {
    // No SDK errors, records, answers or identifiers in logs or browser errors.
    return error instanceof Error && error.message === "Unauthorized"
      ? reply({ state: "denied" }, 403) : reply({ state: "unavailable" }, 503);
  }
}
