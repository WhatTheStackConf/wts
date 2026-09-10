import { createHash } from "node:crypto";
import type { AdmissionAttendee, AdmissionJob, AdmissionOutcome, AdmissionProcessor } from "./protocol.js";

interface AdmissionConfig { apiUrl?: string; apiKey?: string; accountId?: string }
interface AdmissionTransportOptions { fetch?: typeof fetch; timeoutMs?: number }
const MAX_BODY = 2 * 1024 * 1024;
const MAX_PAGES = 40;
const MAX_ROWS = 1000;
type ListCapability = string | { eligibility: "not_in_list" } | null;
class AdmissionReadError extends Error {
  constructor(readonly status: number) { super("upstream read failed"); }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid upstream response");
  return value as Record<string, unknown>;
}
function numericId(value: unknown): string {
  if ((typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) && (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value)))) throw new Error("invalid upstream identity");
  return String(value);
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}
function safeName(value: unknown, fallback: string): string {
  const controls = typeof value === "string" && Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
  if (typeof value !== "string" || !value.trim() || value.length > 200 || controls || /[<>@]|:\/\/|www\.|[a-f0-9]{64}|wts_mcp_|bearer\s|password|secret|token\s*[:=]|\/dev\//i.test(value)) throw new Error("unsafe attendee name");
  return value.trim().replace(/\s+/g, " ") || fallback;
}
function sourceKey(config: { base: string; accountId: string }): string {
  return createHash("sha256").update(JSON.stringify(["wts2026:hievents", config.base, config.accountId])).digest("hex");
}
function configured(input: AdmissionConfig): { base: string; key: string; accountId: string; sourceKey: string } | null {
  try {
    if (!input.apiUrl || !input.apiKey || !input.accountId) return null;
    const url = new URL(input.apiUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || input.apiUrl !== input.apiUrl.trim() || !/^\/[^?#%\\\s]*$/.test(url.pathname)) return null;
    const accountId = numericId(input.accountId);
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(input.apiKey) || input.apiKey.length > 16384) return null;
    const claims = record(JSON.parse(Buffer.from(input.apiKey.split(".")[1]!, "base64url").toString("utf8")));
    if (numericId(claims.account_id) !== accountId) return null;
    const base = input.apiUrl.replace(/\/$/, "");
    return { base, key: input.apiKey, accountId, sourceKey: sourceKey({ base, accountId }) };
  } catch { return null; }
}

/** Coordinator-owned Hi.Events mutation processor. It performs all reads before
 * the coordinator's send fence, and never retries the admission POST. */
export class HttpAdmissionProcessor implements AdmissionProcessor {
  private readonly config: ReturnType<typeof configured>;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  constructor(input: AdmissionConfig, options: AdmissionTransportOptions = {}) {
    this.config = configured(input);
    this.fetcher = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 10000) throw new Error("invalid admission timeout");
  }
  get isConfigured(): boolean { return this.config !== null; }
  async attendee(job: AdmissionJob): Promise<AdmissionAttendee | null> {
    if (!this.config || job.sourceKey !== this.config.sourceKey) return null;
    try {
      const body = await this.get(`events/${numericId(job.upstreamEventId)}/attendees/${numericId(job.upstreamAttendeeId)}`);
      const detail = record(body.data);
      if (numericId(detail.id) !== job.upstreamAttendeeId || numericId(detail.event_id) !== job.upstreamEventId) return null;
      if (typeof detail.public_id !== "string" || !/^A-[A-Z0-9]{7,9}$/.test(detail.public_id)) return null;
      if (typeof detail.first_name !== "string" || (detail.last_name !== null && typeof detail.last_name !== "string")) return null;
      const productId = numericId(detail.product_id);
      safeName(`${detail.first_name} ${detail.last_name ?? ""}`, `Hi.Events attendee ${job.upstreamAttendeeId}`);
      if (typeof detail.status !== "string") return null;
      const status = detail.status.toUpperCase();
      const eligibility = status === "CANCELLED" || status === "REFUNDED" ? "cancelled"
        : status === "AWAITING_PAYMENT" || status === "PENDING" ? "awaiting_payment"
        : status === "ACTIVE" || status === "CONFIRMED" || status === "COMPLETED" ? "eligible"
        : "unknown_eligibility";
      const checkIn = detail.check_in;
      if (checkIn !== undefined && checkIn !== null) {
        const row = record(checkIn);
        if (numericId(row.attendee_id) !== job.upstreamAttendeeId || numericId(row.check_in_list_id) !== job.upstreamListId || !numericId(row.order_id) || typeof row.checked_in_at !== "string" || !Number.isFinite(Date.parse(row.checked_in_at))) return null;
        if (typeof row.short_id !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(row.short_id)) return null;
        return { upstreamAttendeeId: job.upstreamAttendeeId, publicId: detail.public_id, productId, alreadyCheckedIn: true, eligibility: "eligible" };
      }
      // Resolve the server-only list capability before the final send fence.
      const capability = eligibility === "eligible" ? await this.listCapability(job, productId) : null;
      if (eligibility !== "eligible") return { upstreamAttendeeId: job.upstreamAttendeeId, publicId: detail.public_id, productId, alreadyCheckedIn: false, eligibility };
      if (!capability) return null;
      if (typeof capability !== "string") return { upstreamAttendeeId: job.upstreamAttendeeId, publicId: detail.public_id, productId, alreadyCheckedIn: false, eligibility: capability.eligibility };
      return { upstreamAttendeeId: job.upstreamAttendeeId, publicId: detail.public_id, productId, alreadyCheckedIn: false, listCapability: capability, eligibility };
    } catch (error) {
      if (error instanceof AdmissionReadError && error.status === 404) return { upstreamAttendeeId: job.upstreamAttendeeId, publicId: "A-NOTFOUND", productId: "0", alreadyCheckedIn: false, eligibility: "not_in_list" };
      return null;
    }
  }
  async admit(job: AdmissionJob, attendee: AdmissionAttendee): Promise<AdmissionOutcome> {
    if (!this.config || job.sourceKey !== this.config.sourceKey || attendee.alreadyCheckedIn || !attendee.listCapability) return { state: "uncertain" };
    try {
      const response = await this.fetcher(`${this.config.base}/public/check-in-lists/${attendee.listCapability}/check-ins`, {
        method: "POST", redirect: "error", credentials: "omit", cache: "no-store",
        headers: { Authorization: `Bearer ${this.config.key}`, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ attendees: [{ public_id: attendee.publicId, action: "check-in" }] }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.status === 429 || response.status >= 500) { void response.body?.cancel(); return { state: "uncertain" }; }
      const body = await this.json(response);
      const errors = body.errors === undefined ? {} : record(body.errors);
      if (Object.hasOwn(errors, attendee.publicId)) {
        const data = body.data;
        let fingerprint: string | null = null;
        if (Array.isArray(data) && data.length === 1) {
          try { fingerprint = this.fingerprint(data[0], job, attendee); } catch { fingerprint = null; }
        }
        return { state: "existing_unattributed", fingerprint: fingerprint ?? createHash("sha256").update(canonical({ attendee: job.upstreamAttendeeId, list: job.upstreamListId })).digest("hex") };
      }
      if (response.status !== 200) return { state: "uncertain" };
      const data = body.data;
      if (!Array.isArray(data) || data.length > 1) return { state: "uncertain" };
      const checkIn = data.length === 1 ? this.fingerprint(data[0], job, attendee) : null;
      if (Object.keys(errors).length || !checkIn) return { state: "uncertain" };
      return { state: "newly_checked_in", fingerprint: checkIn };
    } catch { return { state: "uncertain" }; }
  }
  private async listCapability(job: AdmissionJob, productId: string): Promise<ListCapability> {
    const items: { id: string; capability: string; productIds: string[]; active: boolean; expired: boolean }[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = record(await this.get(`events/${numericId(job.upstreamEventId)}/check-in-lists?page=${page}&per_page=25`));
      if (!Array.isArray(body.data) || body.data.length > 25) return null;
      const meta = record(body.meta);
      const total = meta.total; const current = meta.current_page; const last = meta.last_page;
      if (![total, current, last].every((value) => typeof value === "number" && Number.isSafeInteger(value)) || current !== page || last !== Math.max(1, Math.ceil(Number(total) / 25)) || Number(total) > MAX_ROWS || last > MAX_PAGES || body.data.length !== Math.min(25, Number(total) - items.length)) return null;
      for (const value of body.data) {
        const row = record(value); const id = numericId(row.id);
        if (items.some((item) => item.id === id) || typeof row.short_id !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(row.short_id) || typeof row.is_active !== "boolean" || typeof row.is_expired !== "boolean" || !Array.isArray(row.products)) return null;
        const productIds = row.products.map((product) => numericId(record(product).id));
        if (new Set(productIds).size !== productIds.length) return null;
        items.push({ id, capability: row.short_id, productIds, active: row.is_active, expired: row.is_expired });
      }
      if (page === last) break;
    }
    const found = items.find((item) => item.id === job.upstreamListId);
    return found && found.active && !found.expired && found.productIds.includes(productId) ? found.capability : { eligibility: "not_in_list" };
  }
  private async get(path: string): Promise<Record<string, unknown>> {
    const response = await this.fetcher(`${this.config!.base}/${path}`, { method: "GET", redirect: "error", credentials: "omit", cache: "no-store", headers: { Authorization: `Bearer ${this.config!.key}`, Accept: "application/json" }, signal: AbortSignal.timeout(this.timeoutMs) });
    if (response.status !== 200) { void response.body?.cancel(); throw new AdmissionReadError(response.status); }
    return this.json(response);
  }
  private async json(response: Response): Promise<Record<string, unknown>> {
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) throw new Error("upstream response too large");
    const reader = response.body?.getReader(); if (!reader) throw new Error("missing upstream response");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > MAX_BODY) { await reader.cancel(); throw new Error("upstream response too large"); } chunks.push(part.value); }
    } finally { reader.releaseLock(); }
    return record(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  }
  private fingerprint(value: unknown, job: AdmissionJob, attendee: AdmissionAttendee): string {
    const row = record(value);
    if (numericId(row.id) === "" || numericId(row.attendee_id) !== job.upstreamAttendeeId || numericId(row.check_in_list_id) !== job.upstreamListId || !numericId(row.order_id) || typeof row.checked_in_at !== "string" || !Number.isFinite(Date.parse(row.checked_in_at)) || typeof row.short_id !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(row.short_id)) throw new Error("invalid check-in identity");
    return createHash("sha256").update(canonical({ id: row.id, attendee_id: row.attendee_id, check_in_list_id: row.check_in_list_id, order_id: row.order_id, checked_in_at: row.checked_in_at, publicId: attendee.publicId })).digest("hex");
  }
}

export function createAdmissionProcessorFromEnvironment(fetcher?: typeof fetch): HttpAdmissionProcessor | null {
  const processor = new HttpAdmissionProcessor({ apiUrl: process.env.HIEVENTS_API_URL, apiKey: process.env.HIEVENTS_API_KEY, accountId: process.env.HIEVENTS_ACCOUNT_ID }, { fetch: fetcher });
  return processor.isConfigured ? processor : null;
}
