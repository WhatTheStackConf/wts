import PocketBase, { BaseAuthStore } from "pocketbase";
import { z } from "zod";
import { FEEDBACK_TOKEN_PATTERN } from "~/lib/feedback-contract";
import { isSameOriginMutation } from "~/lib/session-policy";

const command = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("inspect"), token: z.string().regex(FEEDBACK_TOKEN_PATTERN) }),
  z.strictObject({ action: z.literal("submit"), token: z.string().regex(FEEDBACK_TOKEN_PATTERN), version: z.unknown().optional(), answers: z.unknown().optional() }),
]);
const result = z.union([
  z.strictObject({ state: z.literal("ready"), survey: z.strictObject({
    title: z.string().max(300), version: z.string().max(80), closesAt: z.string().max(40),
    sessions: z.array(z.strictObject({ id: z.string().max(100), title: z.string().max(300) })).max(200),
  }) }),
  z.strictObject({ state: z.enum(["invalid", "used", "expired", "closed", "unavailable", "invalid_answers", "submitted"]) }),
]);

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: {
    "Content-Type": "application/json", "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow",
    ...(status === 405 ? { Allow: "POST" } : {}),
  } });
}

const MAX_BODY_BYTES = 4 * 1024 * 1024;

function mediaType(request: Request): string | undefined {
  return request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
}

/** Returns undefined once the body exceeds the size limit. */
async function readBoundedBody(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array[] | undefined> {
  const reader = body?.getReader();
  const chunks: Uint8Array[] = [];
  if (!reader) return chunks;
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return chunks;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
}

/** This public bearer-capability boundary is deliberately independent of WTS auth.
 * Fresh memory-only PB client per request; never load cookies/auth/forwarded IP.
 * Do not log request bodies, tokens, answers or PocketBase exception objects.
 * Existing infrastructure access logs remain a separate deployment review gate.
 */
export async function handleFeedbackRequest(request: Request, pocketBaseUrl = process.env.POCKETBASE_URL || "http://localhost:8090"): Promise<Response> {
  if (request.method !== "POST") return response({ state: "invalid" }, 405);
  if (!isSameOriginMutation(request)) return response({ state: "invalid" }, 403);
  if (mediaType(request) !== "application/json") return response({ state: "invalid" }, 415);
  let parsed: z.infer<typeof command>;
  try {
    const chunks = await readBoundedBody(request.body);
    if (!chunks) return response({ state: "invalid_answers" }, 413);
    parsed = command.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch { return response({ state: "invalid" }, 400); }
  try {
    const pb = new PocketBase(pocketBaseUrl, new BaseAuthStore());
    const received: unknown = await pb.send("/api/wts/feedback", { method: "POST", body: parsed, requestKey: null, signal: AbortSignal.timeout(10_000) });
    const safe = result.parse(received);
    return response(safe, safe.state === "unavailable" ? 503 : 200);
  } catch {
    // Intentionally discard rich SDK errors, including their request payloads.
    return response({ state: "unavailable" }, 503);
  }
}
