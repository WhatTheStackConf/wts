/** Server-only GET transport. One process-local budget per upstream origin and
 * transport (the real fetch singleton in production), shared across accounts,
 * discovery/options and public/detail arrival reads. This is NOT a distributed
 * limiter: multiple web/coordinator processes must not claim a shared IP budget
 * without an external gate. No effect/POST API is exposed by this module.
 */
export class CheckinReadError extends Error {
  constructor(readonly reason: "transport" | "http" | "contract" | "limit") { super(reason); }
}
export interface CheckinReadDependencies {
  now?: () => number;
  random?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}
interface Budget { busy: boolean; waiters: number; limit: number; observedLimit: boolean; remaining: number; resetAt: number; blockedUntil: number }
const budgets = new WeakMap<typeof fetch, Map<string, Budget>>();
const LIMIT = 2 * 1024 * 1024;
const DEADLINE = 10_000;
const MAX_WAIT = 1500;
const RESERVE = 5;

function numericHeader(headers: Headers, name: string): number | undefined {
  const value = headers.get(name);
  return value !== null && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
}

export function createCheckinUpstreamReader(config: { base: string; key: string }, transport: typeof fetch, dependencies: CheckinReadDependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const random = dependencies.random ?? Math.random;
  const sleep = dependencies.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const origin = new URL(config.base).origin;
  let sources = budgets.get(transport);
  if (!sources) { sources = new Map(); budgets.set(transport, sources); }
  let shared = sources.get(origin);
  if (!shared) { shared = { busy: false, waiters: 0, limit: 180, observedLimit: false, remaining: 180, resetAt: now() + 60_000, blockedUntil: 0 }; sources.set(origin, shared); }
  const budget = shared;
  return async function read(path: string, authenticated = true): Promise<Record<string, unknown>> {
    // Bound both occupancy and time spent waiting; retries share this allowance.
    if (budget.busy && budget.waiters >= 32) throw new CheckinReadError("http");
    let claimed = false;
    let waited = 0;
    const started = now();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new CheckinReadError("transport")); }, DEADLINE);
    });
    async function consume(): Promise<Record<string, unknown>> {
      budget.waiters++;
      try {
        while (budget.busy) {
          if (controller.signal.aborted) throw new CheckinReadError("transport");
          if (waited >= MAX_WAIT || now() - started >= MAX_WAIT) throw new CheckinReadError("http");
          await sleep(25);
          waited += 25;
        }
        if (controller.signal.aborted) throw new CheckinReadError("transport");
        // No await between observing the free slot and reserving it.
        budget.busy = true;
        claimed = true;
      } finally { budget.waiters--; }
      for (let attempt = 0; attempt < 3; attempt++) {
        if (controller.signal.aborted) throw new CheckinReadError("transport");
        if (now() >= budget.resetAt) { budget.remaining = budget.limit; budget.resetAt = now() + 60_000; }
        // Real timers can wake before the wall-clock deadline. Recheck and wait
        // only the remainder, within the same total allowance; never send early.
        while (true) {
          const wait = Math.max(0, budget.blockedUntil - now(), budget.remaining <= RESERVE ? budget.resetAt - now() : 0);
          if (wait <= 0) break;
          if (waited + wait > MAX_WAIT || now() - started + wait >= DEADLINE) throw new CheckinReadError("http");
          waited += wait;
          await sleep(wait);
          if (controller.signal.aborted) throw new CheckinReadError("transport");
        }
        if (controller.signal.aborted) throw new CheckinReadError("transport");
        if (now() < budget.blockedUntil || (budget.remaining <= RESERVE && now() < budget.resetAt)) throw new CheckinReadError("http");
        if (now() >= budget.resetAt) { budget.remaining = budget.limit; budget.resetAt = now() + 60_000; }
        if (budget.remaining <= RESERVE) throw new CheckinReadError("http");
        budget.remaining--;
        let response: Response;
        try {
          response = await transport(`${config.base}/${path}`, {
            method: "GET", redirect: "error", credentials: "omit", cache: "no-store",
            headers: { ...(authenticated ? { Authorization: `Bearer ${config.key}` } : {}), Accept: "application/json" }, signal: controller.signal,
          });
        } catch (error) {
          // Native fetch network failures are TypeError; configuration/fixture
          // programmer errors are not automatically retried. Timeout owns deadline.
          if (!(error instanceof TypeError) || controller.signal.aborted) throw new CheckinReadError("transport");
          budget.blockedUntil = Math.max(budget.blockedUntil, now() + backoff(attempt));
          if (attempt === 2) throw new CheckinReadError("transport");
          continue;
        }
        if (controller.signal.aborted) { void response.body?.cancel().catch(() => undefined); throw new CheckinReadError("transport"); }
        const remaining = numericHeader(response.headers, "X-RateLimit-Remaining");
        const reset = numericHeader(response.headers, "X-RateLimit-Reset");
        const limit = numericHeader(response.headers, "X-RateLimit-Limit");
        if (limit !== undefined) {
          // Replace the fallback once, accounting for tokens already spent. Later
          // headers may tighten this window, never refill it with stale counts.
          budget.remaining = budget.observedLimit
            ? Math.min(budget.remaining, Math.max(0, limit - 1))
            : Math.max(0, budget.remaining + limit - budget.limit);
          budget.limit = limit;
          budget.observedLimit = true;
        }
        if (remaining !== undefined) budget.remaining = Math.min(budget.remaining, remaining);
        if (reset !== undefined && reset * 1000 > now()) budget.resetAt = Math.max(budget.resetAt, reset * 1000);
        else if (remaining !== undefined) budget.resetAt = Math.max(budget.resetAt, now() + 60_000);
        const retryAfter = response.headers.get("Retry-After");
        if (retryAfter !== null) {
          const until = /^\d+$/.test(retryAfter) ? now() + Number(retryAfter) * 1000 : Date.parse(retryAfter);
          // Malformed delay cannot authorize hot retries.
          budget.blockedUntil = Math.max(budget.blockedUntil, Number.isFinite(until) ? until : now() + 60_000);
        }
        if (response.status !== 200 || response.redirected) {
          void response.body?.cancel().catch(() => undefined);
          if (!response.redirected && (response.status === 429 || response.status >= 500)) {
            budget.blockedUntil = Math.max(budget.blockedUntil, now() + backoff(attempt));
            if (attempt < 2) continue;
          }
          throw new CheckinReadError("http");
        }
        if (Number(response.headers.get("content-length")) > LIMIT) { void response.body?.cancel().catch(() => undefined); throw new CheckinReadError("limit"); }
        const reader = response.body?.getReader();
        if (!reader) throw new CheckinReadError("contract");
        // AbortController alone does not cancel a custom/fixture response body.
        // Explicit cancellation also releases pending reads and buffered chunks.
        const cancelBody = () => { void reader.cancel().catch(() => undefined); };
        controller.signal.addEventListener("abort", cancelBody, { once: true });
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const chunk = await reader.read();
            if (controller.signal.aborted) throw new CheckinReadError("transport");
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > LIMIT) { void reader.cancel().catch(() => undefined); throw new CheckinReadError("limit"); }
            chunks.push(chunk.value);
          }
        } finally {
          controller.signal.removeEventListener("abort", cancelBody);
          reader.releaseLock();
        }
        try {
          const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (body === null || typeof body !== "object" || Array.isArray(body)) throw new Error();
          return body as Record<string, unknown>;
        } catch { throw new CheckinReadError("contract"); }
      }
      throw new CheckinReadError("http");
    }
    function backoff(attempt: number) { return 200 * 2 ** attempt + Math.floor(Math.max(0, Math.min(1, random())) * 100); }
    try { return await Promise.race([consume(), timeout]); }
    finally { clearTimeout(timer); if (claimed) budget.busy = false; }
  };
}
