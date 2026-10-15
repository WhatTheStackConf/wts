import PocketBase from "pocketbase";
import { isSameOriginMutation, sessionUser } from "~/lib/session-policy";
import { parseLiveQaProgramme } from "~/lib/live-qa-programme";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: {
    "Content-Type": "application/json",
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
  } });
}

/** Public stage directory: no cookies, user tokens or private questions are forwarded. */
export async function handleLiveQaProgramme(request: Request, baseUrl = process.env.POCKETBASE_URL || "http://localhost:8090"): Promise<Response> {
  if (request.method !== "GET") return response({ error: "Use GET for the stage programme." }, 405);
  try {
    const pb = new PocketBase(baseUrl);
    const result: unknown = await pb.send("/api/wts/live-qa/programme", { method: "GET", signal: AbortSignal.timeout(10_000) });
    return response(parseLiveQaProgramme(result));
  } catch {
    return response({ error: "The main-day stage programme is unavailable. Please try again." }, 503);
  }
}

const COMMAND_LIMIT_BYTES = 8192;

const COMMAND_ERROR_MESSAGES: Record<number, string> = {
  400: "Invalid Q&A command. Questions must contain 1–1000 characters.",
  401: "Log in to use Q&A.",
  403: "Q&A access denied.",
  404: "This talk or question is unavailable.",
  409: "Questions are closed, or this request conflicts with an earlier submission. Refresh and try again.",
  429: "Please wait 10 seconds before asking another question.",
};

function errorStatus(error: unknown): number {
  return Number((error as { status?: number })?.status);
}

function cookieClient(baseUrl: string, request: Request): PocketBase {
  const pb = new PocketBase(baseUrl);
  pb.autoCancellation(false);
  pb.authStore.loadFromCookie(request.headers.get("cookie") || "");
  return pb;
}

/** Returns undefined once the command exceeds the size limit. */
async function readCommandChunks(reader?: ReadableStreamDefaultReader<Uint8Array>): Promise<Uint8Array[] | undefined> {
  const chunks: Uint8Array[] = [];
  if (!reader) return chunks;
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    size += value.byteLength;
    if (size > COMMAND_LIMIT_BYTES) {
      void reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
}

async function readCommand(request: Request): Promise<{ body: unknown } | Response> {
  const reader = request.body?.getReader();
  try {
    const chunks = await readCommandChunks(reader);
    if (!chunks) return response({ error: "Q&A command too large." }, 413);
    return { body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return response({ error: "Invalid Q&A command." }, 400);
  } finally {
    reader?.releaseLock();
  }
}

function sessionRefreshFailure(error: unknown): Response {
  const status = errorStatus(error);
  if (status === 401 || status === 403 || (error instanceof Error && error.message === "Unauthorized")) {
    return response({ error: "Log in to use Q&A." }, 401);
  }
  return response({ error: "Q&A unavailable. Try again." }, 503);
}

async function actorRejection(pb: PocketBase, request: Request): Promise<Response | undefined> {
  try {
    const refreshed = await pb.collection("users").authRefresh({ signal: AbortSignal.timeout(10_000) });
    const actor = sessionUser(refreshed.record);
    if (!actor.verified) return response({ error: "Log in to use Q&A." }, 401);
    // Cookies are shared across tabs; a mounted panel's private draft is not.
    // This is a rejection fence, never a caller-supplied source of authority.
    if (request.headers.get("x-wts-qa-user") !== actor.id) {
      return response({ error: "Your account changed. Reload this page before using Q&A." }, 403);
    }
    return undefined;
  } catch (error) {
    return sessionRefreshFailure(error);
  }
}

// Never expose PB diagnostics, tokens, request bodies, or private record fields.
function commandFailure(error: unknown): Response {
  const status = errorStatus(error);
  const message = COMMAND_ERROR_MESSAGES[status];
  return response({ error: message || "Q&A unavailable. Try again." }, message ? status : 503);
}

/** Same-origin cookie adapter; all business authority stays in the PB hook.
 * Never use the superuser client or trust the cookie's embedded user record. */
export async function handleLiveQaRequest(request: Request, baseUrl = process.env.POCKETBASE_URL || "http://localhost:8090"): Promise<Response> {
  if (!isSameOriginMutation(request)) return response({ error: "Q&A access denied." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return response({ error: "Use a JSON Q&A command." }, 415);
  }
  const pb = cookieClient(baseUrl, request);
  if (!pb.authStore.isValid) return response({ error: "Log in to use Q&A." }, 401);
  const command = await readCommand(request);
  if (command instanceof Response) return command;
  const rejection = await actorRejection(pb, request);
  if (rejection) return rejection;
  try {
    const result: unknown = await pb.send("/api/wts/live-qa", { method: "POST", body: command.body, signal: AbortSignal.timeout(10_000) });
    return response(result);
  } catch (error) {
    return commandFailure(error);
  }
}
