/** Server-only GET transport. One process-local budget per upstream origin and
 * transport (the real fetch singleton in production), shared across accounts,
 * discovery/options and public/detail arrival reads. This is NOT a distributed
 * limiter: multiple web/coordinator processes must not claim a shared IP budget
 * without an external gate. No effect/POST API is exposed by this module.
 */
export class CheckinReadError extends Error {
  readonly status?: number;
  readonly retryAfterMs: number;
  readonly retryBlocked: boolean;
  constructor(readonly reason: "transport" | "http" | "contract" | "limit", metadata: { status?: number; retryAfterMs?: number } = {}) {
    super(reason);
    this.status = Number.isInteger(metadata.status) && metadata.status! >= 100 && metadata.status! <= 599 ? metadata.status : undefined;
    const delay = metadata.retryAfterMs ?? 0;
    this.retryBlocked = !Number.isFinite(delay) || delay > 86400000;
    this.retryAfterMs = this.retryBlocked ? 86400000 : Math.max(0, Math.ceil(delay));
  }
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
function budgetWait(budget: Budget, now: () => number) {
  return Math.max(0, budget.blockedUntil - now(), budget.remaining <= RESERVE ? budget.resetAt - now() : 0);
}
function refill(budget: Budget, now: () => number) {
  if (now() >= budget.resetAt) { budget.remaining = budget.limit; budget.resetAt = now() + 60_000; }
}
function observeRateLimit(budget: Budget, headers: Headers, now: () => number) {
  const remaining = numericHeader(headers, "X-RateLimit-Remaining");
  const reset = numericHeader(headers, "X-RateLimit-Reset");
  const limit = numericHeader(headers, "X-RateLimit-Limit");
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
}
function observeRetryAfter(budget: Budget, headers: Headers, now: () => number) {
  const retryAfter = headers.get("Retry-After");
  if (retryAfter === null) return;
  const until = /^\d+$/.test(retryAfter) ? now() + Number(retryAfter) * 1000 : Date.parse(retryAfter);
  // Malformed delay cannot authorize hot retries.
  budget.blockedUntil = Math.max(budget.blockedUntil, Number.isNaN(until) ? now() + 60_000 : until);
}
function discard(response: Response) { void response.body?.cancel().catch(() => undefined); }

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
    let status: number | undefined;
    const failure = (reason: "transport" | "http" | "contract" | "limit") => new CheckinReadError(reason, { status, retryAfterMs: budgetWait(budget, now) });
    let claimed = false;
    let waited = 0;
    const started = now();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(failure("transport")); }, DEADLINE);
    });
    function ensureLive() { if (controller.signal.aborted) throw failure("transport"); }
    function reserve() {
      ensureLive();
      budget.busy = true;
      claimed = true;
    }
    async function waitForSlot() {
      budget.waiters++;
      try {
        while (budget.busy) {
          ensureLive();
          if (waited >= MAX_WAIT || now() - started >= MAX_WAIT) throw failure("http");
          await sleep(25);
          waited += 25;
        }
        // No await between observing the free slot and reserving it.
        reserve();
      } finally { budget.waiters--; }
    }
    // Real timers can wake before the wall-clock deadline. Recheck and wait
    // only the remainder, within the same total allowance; never send early.
    async function waitForBudget() {
      for (let wait = budgetWait(budget, now); wait > 0; wait = budgetWait(budget, now)) {
        if (waited + wait > MAX_WAIT || now() - started + wait >= DEADLINE) throw failure("http");
        waited += wait;
        await sleep(wait);
        ensureLive();
      }
    }
    function spend() {
      ensureLive();
      if (now() < budget.blockedUntil || (budget.remaining <= RESERVE && now() < budget.resetAt)) throw failure("http");
      refill(budget, now);
      if (budget.remaining <= RESERVE) throw failure("http");
      budget.remaining--;
    }
    /** Resolves null when a network failure leaves another attempt. */
    async function send(attempt: number): Promise<Response | null> {
      ensureLive();
      refill(budget, now);
      if (budgetWait(budget, now) > 0) await waitForBudget();
      spend();
      try {
        return await transport(`${config.base}/${path}`, {
          method: "GET", redirect: "error", credentials: "omit", cache: "no-store",
          headers: { ...(authenticated ? { Authorization: `Bearer ${config.key}` } : {}), Accept: "application/json" }, signal: controller.signal,
        });
      } catch (error) {
        // Native fetch network failures are TypeError; configuration/fixture
        // programmer errors are not automatically retried. Timeout owns deadline.
        if (!(error instanceof TypeError) || controller.signal.aborted) throw failure("transport");
        budget.blockedUntil = Math.max(budget.blockedUntil, now() + backoff(attempt));
        if (attempt === 2) throw failure("transport");
        return null;
      }
    }
    /** Records upstream budget headers; true when a throttled or failed response leaves another attempt. */
    function retryable(response: Response, attempt: number): boolean {
      if (controller.signal.aborted) { discard(response); throw failure("transport"); }
      status = response.status;
      observeRateLimit(budget, response.headers, now);
      observeRetryAfter(budget, response.headers, now);
      if (response.status === 200 && !response.redirected) return false;
      discard(response);
      if (!response.redirected && (response.status === 429 || response.status >= 500)) {
        budget.blockedUntil = Math.max(budget.blockedUntil, now() + backoff(attempt));
        if (attempt < 2) return true;
      }
      throw failure("http");
    }
    async function readBody(response: Response): Promise<Buffer> {
      if (Number(response.headers.get("content-length")) > LIMIT) { discard(response); throw failure("limit"); }
      const reader = response.body?.getReader();
      if (!reader) throw failure("contract");
      // AbortController alone does not cancel a custom/fixture response body.
      // Explicit cancellation also releases pending reads and buffered chunks.
      const cancelBody = () => { void reader.cancel().catch(() => undefined); };
      controller.signal.addEventListener("abort", cancelBody, { once: true });
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          ensureLive();
          if (chunk.done) return Buffer.concat(chunks);
          size += chunk.value.byteLength;
          if (size > LIMIT) { cancelBody(); throw failure("limit"); }
          chunks.push(chunk.value);
        }
      } finally {
        controller.signal.removeEventListener("abort", cancelBody);
        reader.releaseLock();
      }
    }
    function parseObject(body: Buffer): Record<string, unknown> {
      try {
        const value: unknown = JSON.parse(body.toString("utf8"));
        if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error();
        return value as Record<string, unknown>;
      } catch { throw failure("contract"); }
    }
    async function consume(): Promise<Record<string, unknown>> {
      if (budget.busy) await waitForSlot();
      else reserve();
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await send(attempt);
        if (!response || retryable(response, attempt)) continue;
        return parseObject(await readBody(response));
      }
      throw failure("http");
    }
    function backoff(attempt: number) { return 200 * 2 ** attempt + Math.floor(Math.max(0, Math.min(1, random())) * 100); }
    try { return await Promise.race([consume(), timeout]); }
    finally { clearTimeout(timer); if (claimed) budget.busy = false; }
  };
}
