import { createHash } from "node:crypto";

export interface HiEventsRelease {
  id: number;
  title: string;
  description: string | null;
  price: number | null;
  currency: string;
  is_available: boolean;
  sales_start_date: string | null;
  sales_end_date: string | null;
  quantity_sold: number;
  quantity_available: number | null;
  purchase_link: string;
}

export interface HiEventsEvent {
  id: number;
  title: string;
  tickets: HiEventsRelease[];
}

export interface HiEventsAttendee {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  locale: string;
  checked_in_at: string | null;
  ticket: {
    id: number;
    title: string;
    price: number;
    currency: string;
  };
  public_url: string;
  admin_url: string;
}

export type HiEventsAttendeeEligibility = "eligible" | "ineligible" | "unknown";
export type HiEventsAdapterFailureReason = "configuration" | "authentication" | "request" | "malformed_data" | "malformed_pagination";

export interface HiEventsPaginationState {
  requestedPages: number;
  completedPages: number;
  totalPages?: number;
  complete: boolean;
}

/** Raw source facts stay in the adapter and must never be returned from a public DTO. */
export interface HiEventsSourceAttendee {
  stableId: string;
  email: string;
  normalizedEmail: string;
  eligibility: HiEventsAttendeeEligibility;
  sourceStatus?: string;
  checkedIn: boolean;
  checkInStableId?: string;
  checkedInAt?: string;
  sourceUpdatedAt?: string;
  productId?: string;
  firstName?: string;
  lastName?: string;
  locale?: string;
  ticketTitle?: string;
  ticketPrice?: number;
  ticketCurrency?: string;
  publicUrl?: string;
}

export interface HiEventsAttendeeSnapshotSuccess {
  state: "success";
  eventId: string;
  fetchedAt: string;
  pagination: HiEventsPaginationState;
  attendees: HiEventsSourceAttendee[];
  sourceUpdatedAt?: string;
}

export interface HiEventsAttendeeSnapshotUnavailable {
  state: "unavailable";
  eventId?: string;
  fetchedAt: string;
  pagination: HiEventsPaginationState;
  reason: HiEventsAdapterFailureReason;
}

export interface HiEventsAttendeeSnapshotPartial {
  state: "partial";
  eventId: string;
  fetchedAt: string;
  pagination: HiEventsPaginationState;
  reason: Exclude<HiEventsAdapterFailureReason, "configuration" | "authentication">;
}

export type HiEventsAttendeeSnapshot =
  | HiEventsAttendeeSnapshotSuccess
  | HiEventsAttendeeSnapshotUnavailable
  | HiEventsAttendeeSnapshotPartial;

export interface HiEventsAdapterOptions {
  apiUrl?: string;
  eventId?: string;
  accessToken?: string;
  fetcher?: typeof fetch;
  now?: () => string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseMs?: number;
}

let cachedToken: string | null = null;
let tokenExpiry: number | null = null;

function getApiBaseUrl(baseUrl: string): string {
  if (baseUrl.endsWith("/api") || baseUrl.endsWith("/api/")) return baseUrl.replace(/\/$/, "");
  return `${baseUrl.replace(/\/$/, "")}/api`;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteDate(value: unknown): string | undefined {
  const candidate = text(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : undefined;
}

function numberValue(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

/** Normalization intentionally does not strip aliases or apply provider-specific rules. */
export function normalizeHiEventsEmail(email: string | undefined): string {
  return email?.trim().toLocaleLowerCase() || "";
}

function isUsableHiEventsEmail(value: string): boolean {
  if (!value || value.length > 254 || /\s/.test(value)) return false;
  const parts = value.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((label) =>
    label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
  );
}

async function getAuthToken(baseUrl: string, fetcher: typeof fetch, timeoutMs: number): Promise<string | null> {
  if (process.env.HIEVENTS_API_KEY) return process.env.HIEVENTS_API_KEY;

  const email = process.env.HIEVENTS_EMAIL;
  const password = process.env.HIEVENTS_PASSWORD;
  const accountId = process.env.HIEVENTS_ACCOUNT_ID;
  if (!email || !password || !accountId) return null;

  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) return cachedToken;
  try {
    const response = await fetcher(`${getApiBaseUrl(baseUrl)}/auth/login`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, account_id: accountId }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const data = await response.json() as { token?: unknown; expires_in?: unknown };
    const token = text(data.token);
    if (!token) return null;
    cachedToken = token;
    tokenExpiry = Date.now() + (numberValue(data.expires_in) || 3600) * 1000 - 300000;
    return token;
  } catch {
    return null;
  }
}

function eligibilityFor(raw: Record<string, unknown>): { eligibility: HiEventsAttendeeEligibility; sourceStatus?: string } {
  const sourceStatus = text(raw.status) || text(raw.order_status) || text(raw.ticket_status);
  const status = sourceStatus?.toLocaleLowerCase();
  const explicitlyIneligible = raw.cancelled === true || raw.is_cancelled === true || raw.refunded === true || raw.is_refunded === true ||
    ["cancelled", "canceled", "refunded", "transferred", "transferred_away", "voided", "deleted", "inactive", "ineligible"].includes(status || "");
  if (explicitlyIneligible) return { eligibility: "ineligible", sourceStatus };
  // Older Hi.Events attendee responses omit status. Being present in that response is its supported eligibility signal.
  if (!status || ["active", "confirmed", "completed", "paid", "valid", "issued", "checked_in"].includes(status)) {
    return { eligibility: "eligible", sourceStatus };
  }
  return { eligibility: "unknown", sourceStatus };
}

function stableIdFor(raw: Record<string, unknown>, eventId: string, normalizedEmail: string): string {
  const stable = text(raw.id) || text(raw.public_id) || text(raw.short_id);
  if (stable) return stable;
  return createHash("sha256")
    .update(`${eventId}:${normalizedEmail}:${text(raw.product_id) || ""}`)
    .digest("hex");
}

function checkInFor(raw: Record<string, unknown>): { checkedIn: boolean; checkInStableId?: string; checkedInAt?: string } {
  const rows = Array.isArray(raw.check_ins) ? raw.check_ins : [];
  const checks = rows
    .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value)))
    .map((value) => ({
      stableId: text(value.id) || text(value.public_id) || text(value.uuid),
      occurredAt: finiteDate(value.created_at) || finiteDate(value.checked_in_at),
    }))
    .filter((value) => value.stableId || value.occurredAt)
    .sort((left, right) => Date.parse(right.occurredAt || "") - Date.parse(left.occurredAt || ""));
  const first = checks[0];
  const checkedInAt = first?.occurredAt || finiteDate(raw.checked_in_at);
  return { checkedIn: Boolean(first || checkedInAt), checkInStableId: first?.stableId, checkedInAt };
}

function sourceAttendee(raw: Record<string, unknown>, eventId: string): HiEventsSourceAttendee {
  const email = text(raw.email) || "";
  const normalizedCandidate = normalizeHiEventsEmail(email);
  const normalizedEmail = isUsableHiEventsEmail(normalizedCandidate) ? normalizedCandidate : "";
  const sourceEligibility = eligibilityFor(raw);
  const eligibility = !normalizedEmail && sourceEligibility.eligibility === "eligible"
    ? { ...sourceEligibility, eligibility: "unknown" as const }
    : sourceEligibility;
  const checkIn = checkInFor(raw);
  const productId = text(raw.product_id);
  const product = raw.product && typeof raw.product === "object" && !Array.isArray(raw.product)
    ? raw.product as Record<string, unknown>
    : {};
  return {
    stableId: stableIdFor(raw, eventId, normalizedEmail),
    email,
    normalizedEmail,
    eligibility: eligibility.eligibility,
    sourceStatus: eligibility.sourceStatus,
    ...checkIn,
    sourceUpdatedAt: finiteDate(raw.updated_at) || finiteDate(raw.created_at),
    productId,
    firstName: text(raw.first_name),
    lastName: text(raw.last_name),
    locale: text(raw.locale),
    ticketTitle: text(product.title),
    ticketPrice: numberValue(product.price),
    ticketCurrency: text(product.currency),
    publicUrl: text(raw.public_url),
  };
}

function pageState(requestedPages: number, completedPages: number, totalPages?: number, complete = false): HiEventsPaginationState {
  return { requestedPages, completedPages, totalPages, complete };
}

function retryDelay(response: Response | undefined, attempt: number, baseMs: number): number {
  const retryAfter = response?.headers.get("retry-after");
  const retryAfterMs = retryAfter && Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1000 : 0;
  const exponential = baseMs * 2 ** attempt;
  return Math.min(3000, Math.max(retryAfterMs, exponential) + Math.floor(Math.random() * Math.max(1, baseMs)));
}

async function fetchWithRetry(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  maxRetries: number,
  retryBaseMs: number,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let response: Response | undefined;
    try {
      response = await fetcher(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok || response.status < 500 && response.status !== 429) return response;
    } catch (error) {
      lastError = error;
    }
    if (attempt === maxRetries) {
      if (response) return response;
      throw lastError;
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt, retryBaseMs)));
  }
  throw lastError;
}

function pageInfo(json: Record<string, unknown>, currentPage: number): { totalPages?: number; nextUrl?: string; malformed: boolean } {
  const data = json.data && typeof json.data === "object" && !Array.isArray(json.data)
    ? json.data as Record<string, unknown>
    : {};
  const meta = json.meta && typeof json.meta === "object" && !Array.isArray(json.meta) ? json.meta as Record<string, unknown> : {};
  const nestedMeta = data.meta && typeof data.meta === "object" && !Array.isArray(data.meta)
    ? data.meta as Record<string, unknown>
    : {};
  const pagination = meta.pagination && typeof meta.pagination === "object" && !Array.isArray(meta.pagination)
    ? meta.pagination as Record<string, unknown>
    : json.pagination && typeof json.pagination === "object" && !Array.isArray(json.pagination)
    ? json.pagination as Record<string, unknown>
    : Object.keys(nestedMeta).length > 0 ? nestedMeta : data;
  const totalPages = numberValue(meta.last_page) || numberValue(meta.total_pages) || numberValue(pagination.last_page) || numberValue(pagination.total_pages);
  const reportedPage = numberValue(meta.current_page) || numberValue(pagination.current_page);
  const links = json.links && typeof json.links === "object" && !Array.isArray(json.links) ? json.links as Record<string, unknown> : {};
  const nextUrl = text(links.next) || text(meta.next_page_url) || text(pagination.next_page_url);
  const paginationKnown = Object.keys(meta).length > 0 ||
    Object.keys(nestedMeta).length > 0 ||
    Object.keys(links).length > 0 ||
    ["last_page", "total_pages", "current_page", "next_page_url"].some((key) => key in pagination);
  if (
    !paginationKnown ||
    reportedPage !== undefined && reportedPage !== currentPage ||
    totalPages !== undefined && (!Number.isInteger(totalPages) || totalPages < currentPage)
  ) {
    return { malformed: true };
  }
  return { totalPages, nextUrl, malformed: false };
}

/**
 * Read-only paginated attendee adapter. A partial or unavailable traversal is
 * deliberately never represented as an empty attendee list.
 */
export async function fetchHiEventsAttendeeSnapshot(options: HiEventsAdapterOptions = {}): Promise<HiEventsAttendeeSnapshot> {
  const fetchedAt = (options.now || (() => new Date().toISOString()))();
  const rawApiUrl = options.apiUrl || process.env.HIEVENTS_API_URL;
  const eventId = options.eventId || process.env.HIEVENTS_EVENT_ID;
  const fetcher = options.fetcher || fetch;
  const configuredTimeout = Number(options.timeoutMs ?? process.env.HIEVENTS_REQUEST_TIMEOUT_MS ?? 10000);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 10000;
  const configuredRetries = Number(options.maxRetries ?? process.env.HIEVENTS_MAX_RETRIES ?? 2);
  const maxRetries = Number.isInteger(configuredRetries) ? Math.min(3, Math.max(0, configuredRetries)) : 2;
  const configuredRetryBaseMs = Number(options.retryBaseMs ?? process.env.HIEVENTS_RETRY_BASE_MS ?? 200);
  const retryBaseMs = Number.isFinite(configuredRetryBaseMs) ? Math.min(1000, Math.max(10, configuredRetryBaseMs)) : 200;
  if (!rawApiUrl || !eventId) {
    return { state: "unavailable", fetchedAt, pagination: pageState(0, 0), reason: "configuration" };
  }
  const token = options.accessToken || await getAuthToken(rawApiUrl, fetcher, timeoutMs);
  if (!token) {
    return { state: "unavailable", eventId, fetchedAt, pagination: pageState(0, 0), reason: "authentication" };
  }

  const headers: HeadersInit = { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const apiUrl = getApiBaseUrl(rawApiUrl);
  const apiOrigin = new URL(apiUrl).origin;
  const attendeePath = `${new URL(apiUrl).pathname.replace(/\/$/, "")}/events/${encodeURIComponent(eventId)}/attendees`;
  const attendees: HiEventsSourceAttendee[] = [];
  let requestedPages = 0;
  let completedPages = 0;
  let totalPages: number | undefined;
  let currentPage = 1;
  let nextUrl: string | undefined = `${apiUrl}/events/${encodeURIComponent(eventId)}/attendees?page=1&per_page=100`;
  const seenUrls = new Set<string>();

  while (nextUrl) {
    if (seenUrls.has(nextUrl) || requestedPages >= 10000) {
      return { state: "partial", eventId, fetchedAt, pagination: pageState(requestedPages, completedPages, totalPages), reason: "malformed_pagination" };
    }
    seenUrls.add(nextUrl);
    requestedPages += 1;
    let response: Response;
    try {
      response = await fetchWithRetry(
        fetcher,
        nextUrl,
        { headers },
        timeoutMs,
        maxRetries,
        retryBaseMs,
      );
    } catch {
      return completedPages === 0
        ? { state: "unavailable", eventId, fetchedAt, pagination: pageState(requestedPages, completedPages, totalPages), reason: "request" }
        : { state: "partial", eventId, fetchedAt, pagination: pageState(requestedPages, completedPages, totalPages), reason: "request" };
    }
    if (!response.ok) {
      const reason: HiEventsAdapterFailureReason = response.status === 401 || response.status === 403 ? "authentication" : "request";
      return completedPages === 0
        ? { state: "unavailable", eventId, fetchedAt, pagination: pageState(requestedPages, completedPages, totalPages), reason }
        : { state: "partial", eventId, fetchedAt, pagination: pageState(requestedPages, completedPages, totalPages), reason: "request" };
    }
    let json: Record<string, unknown>;
    try {
      const value = await response.json();
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Malformed response");
      json = value as Record<string, unknown>;
    } catch {
      return completedPages === 0
        ? { state: "unavailable", eventId, fetchedAt, pagination: pageState(requestedPages, completedPages, totalPages), reason: "malformed_data" }
        : { state: "partial", eventId, fetchedAt, pagination: pageState(requestedPages, completedPages, totalPages), reason: "malformed_data" };
    }
    const rows = Array.isArray(json.data)
      ? json.data
      : json.data && typeof json.data === "object" && Array.isArray((json.data as Record<string, unknown>).data)
      ? (json.data as Record<string, unknown>).data as unknown[]
      : undefined;
    if (!rows) {
      return { state: "partial", eventId, fetchedAt, pagination: pageState(requestedPages, completedPages, totalPages), reason: "malformed_pagination" };
    }
    const info = pageInfo(json, currentPage);
    if (info.malformed) {
      return { state: "partial", eventId, fetchedAt, pagination: pageState(requestedPages, completedPages, totalPages), reason: "malformed_pagination" };
    }
    if (rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
      return { state: "partial", eventId, fetchedAt, pagination: pageState(requestedPages, completedPages, totalPages), reason: "malformed_data" };
    }
    attendees.push(...(rows as Record<string, unknown>[]).map((row) => sourceAttendee(row, eventId)));
    completedPages += 1;
    totalPages = info.totalPages || totalPages;
    if (info.nextUrl) {
      const candidate = new URL(info.nextUrl, apiUrl);
      if (candidate.origin !== apiOrigin || candidate.pathname !== attendeePath) {
        return { state: "partial", eventId, fetchedAt, pagination: pageState(requestedPages, completedPages, totalPages), reason: "malformed_pagination" };
      }
      nextUrl = candidate.toString();
      currentPage += 1;
      continue;
    }
    if (totalPages && currentPage < totalPages) {
      currentPage += 1;
      nextUrl = `${apiUrl}/events/${encodeURIComponent(eventId)}/attendees?page=${currentPage}&per_page=100`;
      continue;
    }
    nextUrl = undefined;
  }

  const sourceUpdatedAt = attendees
    .map((attendee) => attendee.sourceUpdatedAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
  return {
    state: "success",
    eventId,
    fetchedAt,
    pagination: pageState(requestedPages, completedPages, totalPages || completedPages, true),
    attendees,
    sourceUpdatedAt,
  };
}

export async function fetchHiEventsReleases(): Promise<HiEventsRelease[]> {
  const rawApiUrl = process.env.HIEVENTS_API_URL;
  const eventId = process.env.HIEVENTS_EVENT_ID;
  if (!rawApiUrl || !eventId) return [];
  const timeoutMs = 10000;
  const token = await getAuthToken(rawApiUrl, fetch, timeoutMs);
  if (!token) return [];
  try {
    const response = await fetch(`${getApiBaseUrl(rawApiUrl)}/events/${encodeURIComponent(eventId)}/`, {
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return [];
    const json = await response.json() as { data?: { product_categories?: Array<{ products?: unknown[] }>; slug?: string } };
    const products = json.data?.product_categories?.[0]?.products;
    if (!Array.isArray(products)) return [];
    const eventUrl = json.data?.slug
      ? `${rawApiUrl.replace(/\/$/, "")}/event/${eventId}/${json.data.slug}`
      : `${rawApiUrl.replace(/\/$/, "")}/event/${eventId}`;
    return products
      .filter((ticket): ticket is Record<string, unknown> => Boolean(ticket && typeof ticket === "object" && !Array.isArray(ticket)))
      .map((ticket) => ({
        id: numberValue(ticket.id) || 0,
        title: text(ticket.title) || "Ticket",
        description: text(ticket.description) || null,
        price: numberValue(ticket.price) || null,
        currency: text(ticket.currency) || "EUR",
        is_available: true,
        sales_start_date: null,
        sales_end_date: null,
        quantity_sold: numberValue(ticket.quantity_sold) || 0,
        quantity_available: null,
        purchase_link: eventUrl,
      }));
  } catch {
    return [];
  }
}

/** Legacy admin-ticket read. Gamification evidence must use the typed snapshot above. */
export async function fetchHiEventsAttendees(filterEmail?: string): Promise<HiEventsAttendee[]> {
  const { requireAdmin } = await import("~/lib/admin-security");
  // Raw attendee details are an admin ticket-operation concern, never a profile DTO.
  await requireAdmin();
  const snapshot = await fetchHiEventsAttendeeSnapshot();
  if (snapshot.state !== "success") return [];
  return snapshot.attendees
    .filter((attendee) => !filterEmail || attendee.normalizedEmail === normalizeHiEventsEmail(filterEmail))
    .map((attendee) => ({
      id: attendee.stableId,
      first_name: attendee.firstName || "",
      last_name: attendee.lastName || "",
      email: attendee.email,
      locale: attendee.locale || "",
      checked_in_at: attendee.checkedInAt || null,
      ticket: {
        id: numberValue(attendee.productId) || 0,
        title: attendee.ticketTitle || "Ticket",
        price: attendee.ticketPrice || 0,
        currency: attendee.ticketCurrency || "EUR",
      },
      public_url: attendee.publicUrl || "",
      admin_url: "",
    }));
}
