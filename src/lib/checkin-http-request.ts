export const CLIENT_COOKIE = "wts_checkin_client";
const CLIENT_TOKEN = /^[a-f0-9]{64}$/;

interface CheckinHttpActor { id: string; role: string }
export type CheckinCommandRead<T> = { ok: true; command: T } | { ok: false; status: 400 | 413 };

/** Resolves null when authentication fails or the actor is not admitted. */
export async function authenticateCheckinActor<A extends CheckinHttpActor>(authenticate: () => Promise<A>, admitted: (actor: A) => boolean): Promise<A | null> {
  try {
    const actor = await authenticate();
    return admitted(actor) ? actor : null;
  } catch { return null; }
}

/** Streams at most `limit` bytes, then parses UTF-8 JSON with `parse`. Any read, JSON or parse failure is a 400. */
export function readCheckinCommand<T>(request: Request, limit: number, parse: (value: unknown) => T): Promise<CheckinCommandRead<T>> {
  return readCheckinCommandBody(request, limit, (body) => parse(JSON.parse(body.toString("utf8"))));
}

/** Streams at most `limit` bytes into `parse`. Any read or parse failure is a 400. */
export async function readCheckinCommandBody<T>(request: Request, limit: number, parse: (body: Buffer) => T): Promise<CheckinCommandRead<T>> {
  try {
    const body = await readBoundedBody(request, limit);
    if (!body) return { ok: false, status: 413 };
    return { ok: true, command: parse(body) };
  } catch { return { ok: false, status: 400 }; }
}

async function readBoundedBody(request: Request, limit: number): Promise<Buffer | null> {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  if (!reader) return Buffer.concat(chunks);
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks);
      size += value.byteLength;
      if (size > limit) { void reader.cancel().catch(() => undefined); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
}

export function checkinClientCookies(request: Request): string[] {
  return (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${CLIENT_COOKIE}=`)).map((part) => part.slice(CLIENT_COOKIE.length + 1));
}

/** A station client identity is absent or exactly one opaque token; anything else is invalid. */
export function checkinClientToken(request: Request): { valid: true; token: string | undefined } | { valid: false } {
  const cookies = checkinClientCookies(request);
  const token = cookies[0];
  if (cookies.length > 1 || (token !== undefined && !CLIENT_TOKEN.test(token))) return { valid: false };
  return { valid: true, token };
}
