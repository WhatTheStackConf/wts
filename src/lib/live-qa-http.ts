import PocketBase from "pocketbase";
import { isSameOriginMutation, sessionUser } from "~/lib/session-policy";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: {
    "Content-Type": "application/json",
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
  } });
}

/** Same-origin cookie adapter; all business authority stays in the PB hook.
 * Never use the superuser client or trust the cookie's embedded user record. */
export async function handleLiveQaRequest(request: Request, baseUrl = process.env.POCKETBASE_URL || "http://localhost:8090"): Promise<Response> {
  if (!isSameOriginMutation(request)) return response({ error: "Q&A access denied." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return response({ error: "Use a JSON Q&A command." }, 415);
  }
  const pb = new PocketBase(baseUrl);
  pb.autoCancellation(false);
  pb.authStore.loadFromCookie(request.headers.get("cookie") || "");
  if (!pb.authStore.isValid) return response({ error: "Log in to use Q&A." }, 401);
  let body: unknown;
  const reader = request.body?.getReader();
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8192) {
          void reader.cancel().catch(() => undefined);
          return response({ error: "Q&A command too large." }, 413);
        }
        chunks.push(value);
      }
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return response({ error: "Invalid Q&A command." }, 400);
  } finally {
    reader?.releaseLock();
  }
  try {
    const refreshed = await pb.collection("users").authRefresh({ signal: AbortSignal.timeout(10_000) });
    const actor = sessionUser(refreshed.record);
    if (!actor.verified) return response({ error: "Log in to use Q&A." }, 401);
    // Cookies are shared across tabs; a mounted panel's private draft is not.
    // This is a rejection fence, never a caller-supplied source of authority.
    if (request.headers.get("x-wts-qa-user") !== actor.id) {
      return response({ error: "Your account changed. Reload this page before using Q&A." }, 403);
    }
  } catch (error) {
    const status = Number((error as { status?: number })?.status);
    if (status === 401 || status === 403 || (error instanceof Error && error.message === "Unauthorized")) {
      return response({ error: "Log in to use Q&A." }, 401);
    }
    return response({ error: "Q&A unavailable. Try again." }, 503);
  }
  try {
    const result: unknown = await pb.send("/api/wts/live-qa", { method: "POST", body, signal: AbortSignal.timeout(10_000) });
    return response(result);
  } catch (error) {
    // Never expose PB diagnostics, tokens, request bodies, or private record fields.
    const status = Number((error as { status?: number })?.status);
    const messages: Record<number, string> = {
      400: "Invalid Q&A command. Questions must contain 1–1000 characters.",
      401: "Log in to use Q&A.",
      403: "Q&A access denied.",
      404: "This talk or question is unavailable.",
      409: "Questions are closed, or this request conflicts with an earlier submission. Refresh and try again.",
      429: "Please wait 10 seconds before asking another question.",
    };
    return response({ error: messages[status] || "Q&A unavailable. Try again." }, messages[status] ? status : 503);
  }
}
