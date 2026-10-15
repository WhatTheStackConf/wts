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

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

/** The first non-zero number; otherwise the last value's number, so a trailing zero survives. */
function firstNumber(...values: unknown[]): number | undefined {
  let candidate: number | undefined;
  for (const value of values) {
    candidate = numberValue(value);
    if (candidate) return candidate;
  }
  return candidate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function hasKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).length > 0;
}

function flag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const candidate = text(value)?.toLowerCase();
  return candidate === "true" || candidate === "1";
}

/** Hidden products are reachable only by direct link or promo code, never from the public listing. */
function isHiddenProduct(ticket: Record<string, unknown>): boolean {
  return flag(ticket.is_hidden ?? ticket.hidden) || flag(ticket.is_hidden_without_promo_code);
}

/** Normalization intentionally does not strip aliases or apply provider-specific rules. */
export function normalizeHiEventsEmail(email: string | undefined): string {
  return email?.trim().toLocaleLowerCase() || "";
}

function isUsableLocalPart(local: string): boolean {
  return Boolean(local) && local.length <= 64 && !local.startsWith(".") && !local.endsWith(".") && !local.includes("..");
}

function isUsableDomain(domain: string): boolean {
  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((label) =>
    label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
  );
}

function isUsableHiEventsEmail(value: string): boolean {
  if (!value || value.length > 254 || /\s/.test(value)) return false;
  const parts = value.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return isUsableLocalPart(local) && isUsableDomain(domain);
}

type HiEventsLogin = { email: string; password: string; account_id: string };

function loginCredentials(): HiEventsLogin | null {
  const email = process.env.HIEVENTS_EMAIL;
  const password = process.env.HIEVENTS_PASSWORD;
  const accountId = process.env.HIEVENTS_ACCOUNT_ID;
  if (!email || !password || !accountId) return null;
  return { email, password, account_id: accountId };
}

async function loginToken(
  baseUrl: string,
  fetcher: typeof fetch,
  timeoutMs: number,
  credentials: HiEventsLogin,
): Promise<string | null> {
  try {
    const response = await fetcher(`${getApiBaseUrl(baseUrl)}/auth/login`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
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

async function getAuthToken(baseUrl: string, fetcher: typeof fetch, timeoutMs: number): Promise<string | null> {
  if (process.env.HIEVENTS_API_KEY) return process.env.HIEVENTS_API_KEY;

  const credentials = loginCredentials();
  if (!credentials) return null;

  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) return cachedToken;
  return loginToken(baseUrl, fetcher, timeoutMs, credentials);
}

const CANCELLATION_FLAGS = ["cancelled", "is_cancelled", "refunded", "is_refunded"];
const INELIGIBLE_STATUSES = new Set(["cancelled", "canceled", "refunded", "transferred", "transferred_away", "voided", "deleted", "inactive", "ineligible"]);
const ELIGIBLE_STATUSES = new Set(["active", "confirmed", "completed", "paid", "valid", "issued", "checked_in"]);

function eligibilityFor(raw: Record<string, unknown>): { eligibility: HiEventsAttendeeEligibility; sourceStatus?: string } {
  const sourceStatus = firstText(raw.status, raw.order_status, raw.ticket_status);
  const status = sourceStatus?.toLocaleLowerCase();
  const explicitlyIneligible = CANCELLATION_FLAGS.some((key) => raw[key] === true) ||
    INELIGIBLE_STATUSES.has(status || "");
  if (explicitlyIneligible) return { eligibility: "ineligible", sourceStatus };
  // Older Hi.Events attendee responses omit status. Being present in that response is its supported eligibility signal.
  if (!status || ELIGIBLE_STATUSES.has(status)) {
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

// Hi.Events returns numeric IDs. Do not lose them or repair malformed tokens
// before consumers decide which admission a ticket actually grants.
function productIdFor(value: unknown): string | undefined {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? String(value) : undefined;
  return typeof value === "string" && /^[1-9]\d*$/.test(value) ? value : undefined;
}

function attendeeEligibility(raw: Record<string, unknown>, normalizedEmail: string): ReturnType<typeof eligibilityFor> {
  const sourceEligibility = eligibilityFor(raw);
  return !normalizedEmail && sourceEligibility.eligibility === "eligible"
    ? { ...sourceEligibility, eligibility: "unknown" as const }
    : sourceEligibility;
}

function sourceAttendee(raw: Record<string, unknown>, eventId: string): HiEventsSourceAttendee {
  const email = text(raw.email) || "";
  const normalizedCandidate = normalizeHiEventsEmail(email);
  const normalizedEmail = isUsableHiEventsEmail(normalizedCandidate) ? normalizedCandidate : "";
  const eligibility = attendeeEligibility(raw, normalizedEmail);
  const checkIn = checkInFor(raw);
  const productId = productIdFor(raw.product_id);
  const product = recordOrEmpty(raw.product);
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

const PAGINATION_KEYS = ["last_page", "total_pages", "current_page", "next_page_url"];

function pageNumbersAgree(currentPage: number, reportedPage?: number, totalPages?: number): boolean {
  if (reportedPage !== undefined && reportedPage !== currentPage) return false;
  return totalPages === undefined || Number.isInteger(totalPages) && totalPages >= currentPage;
}

function pageInfo(json: Record<string, unknown>, currentPage: number): { totalPages?: number; nextUrl?: string; malformed: boolean } {
  const data = recordOrEmpty(json.data);
  const meta = recordOrEmpty(json.meta);
  const nestedMeta = recordOrEmpty(data.meta);
  const pagination = objectRecord(meta.pagination) ??
    objectRecord(json.pagination) ??
    (hasKeys(nestedMeta) ? nestedMeta : data);
  const totalPages = firstNumber(meta.last_page, meta.total_pages, pagination.last_page, pagination.total_pages);
  const reportedPage = firstNumber(meta.current_page, pagination.current_page);
  const links = recordOrEmpty(json.links);
  const nextUrl = firstText(links.next, meta.next_page_url, pagination.next_page_url);
  const paginationKnown = [meta, nestedMeta, links].some(hasKeys) ||
    PAGINATION_KEYS.some((key) => key in pagination);
  if (!paginationKnown || !pageNumbersAgree(currentPage, reportedPage, totalPages)) {
    return { malformed: true };
  }
  return { totalPages, nextUrl, malformed: false };
}

function configuredNumber(option: number | undefined, environment: string | undefined, fallback: number): number {
  return Number(option ?? environment ?? fallback);
}

function requestSettings(options: HiEventsAdapterOptions): { timeoutMs: number; maxRetries: number; retryBaseMs: number } {
  const timeoutMs = configuredNumber(options.timeoutMs, process.env.HIEVENTS_REQUEST_TIMEOUT_MS, 10000);
  const maxRetries = configuredNumber(options.maxRetries, process.env.HIEVENTS_MAX_RETRIES, 2);
  const retryBaseMs = configuredNumber(options.retryBaseMs, process.env.HIEVENTS_RETRY_BASE_MS, 200);
  return {
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10000,
    maxRetries: Number.isInteger(maxRetries) ? Math.min(3, Math.max(0, maxRetries)) : 2,
    retryBaseMs: Number.isFinite(retryBaseMs) ? Math.min(1000, Math.max(10, retryBaseMs)) : 200,
  };
}

type AttendeeRequest = ReturnType<typeof requestSettings> & { fetcher: typeof fetch; headers: HeadersInit };

type AttendeeRoute = {
  apiUrl: string;
  origin: string;
  path: string;
  pageUrl(page: number): string;
};

function attendeeRoute(rawApiUrl: string, eventId: string): AttendeeRoute {
  const apiUrl = getApiBaseUrl(rawApiUrl);
  const attendeesUrl = `${apiUrl}/events/${encodeURIComponent(eventId)}/attendees`;
  return {
    apiUrl,
    origin: new URL(apiUrl).origin,
    path: `${new URL(apiUrl).pathname.replace(/\/$/, "")}/events/${encodeURIComponent(eventId)}/attendees`,
    pageUrl: (page) => `${attendeesUrl}?page=${page}&per_page=100`,
  };
}

/** Mutable page counters for one traversal; failures snapshot them as they stand. */
type AttendeeTraversal = {
  eventId: string;
  fetchedAt: string;
  requestedPages: number;
  completedPages: number;
  totalPages?: number;
};

type TraversalFailureReason = HiEventsAttendeeSnapshotPartial["reason"];

function partialSnapshot(traversal: AttendeeTraversal, reason: TraversalFailureReason): HiEventsAttendeeSnapshotPartial {
  const { eventId, fetchedAt, requestedPages, completedPages, totalPages } = traversal;
  return { state: "partial", eventId, fetchedAt, pagination: pageState(requestedPages, completedPages, totalPages), reason };
}

/** A failure before any completed page means nothing was read, so the source is unavailable. */
function failedSnapshot(
  traversal: AttendeeTraversal,
  firstPageReason: HiEventsAdapterFailureReason,
  laterPageReason: TraversalFailureReason,
): HiEventsAttendeeSnapshot {
  if (traversal.completedPages !== 0) return partialSnapshot(traversal, laterPageReason);
  const { eventId, fetchedAt, requestedPages, completedPages, totalPages } = traversal;
  return { state: "unavailable", eventId, fetchedAt, pagination: pageState(requestedPages, completedPages, totalPages), reason: firstPageReason };
}

async function readAttendeePage(
  traversal: AttendeeTraversal,
  request: AttendeeRequest,
  url: string,
): Promise<{ json: Record<string, unknown> } | { failure: HiEventsAttendeeSnapshot }> {
  let response: Response;
  try {
    response = await fetchWithRetry(
      request.fetcher,
      url,
      { headers: request.headers },
      request.timeoutMs,
      request.maxRetries,
      request.retryBaseMs,
    );
  } catch {
    return { failure: failedSnapshot(traversal, "request", "request") };
  }
  if (!response.ok) {
    const reason: HiEventsAdapterFailureReason = response.status === 401 || response.status === 403 ? "authentication" : "request";
    return { failure: failedSnapshot(traversal, reason, "request") };
  }
  try {
    const json = objectRecord(await response.json());
    if (json) return { json };
  } catch {
    // Unparseable bodies are malformed data, the same as non-object bodies.
  }
  return { failure: failedSnapshot(traversal, "malformed_data", "malformed_data") };
}

function attendeeRows(json: Record<string, unknown>): unknown[] | undefined {
  if (Array.isArray(json.data)) return json.data;
  const nested = json.data && typeof json.data === "object" ? (json.data as Record<string, unknown>).data : undefined;
  return Array.isArray(nested) ? nested : undefined;
}

function attendeePage(
  json: Record<string, unknown>,
  currentPage: number,
): { failure: TraversalFailureReason } | { rows: Record<string, unknown>[]; totalPages?: number; nextUrl?: string } {
  const rows = attendeeRows(json);
  if (!rows) return { failure: "malformed_pagination" };
  const info = pageInfo(json, currentPage);
  if (info.malformed) return { failure: "malformed_pagination" };
  if (!rows.every(isRecord)) return { failure: "malformed_data" };
  return { rows, totalPages: info.totalPages, nextUrl: info.nextUrl };
}

/** Linked cursors are followed only within the attendee route, and only until a page total is known. */
function nextPage(
  route: AttendeeRoute,
  linkedUrl: string | undefined,
  totalPages: number | undefined,
  currentPage: number,
): { malformed: true } | { malformed: false; url?: string } {
  if (linkedUrl) {
    const candidate = new URL(linkedUrl, route.apiUrl);
    if (candidate.origin !== route.origin) return { malformed: true };
    if (!totalPages) {
      return candidate.pathname === route.path ? { malformed: false, url: candidate.toString() } : { malformed: true };
    }
  }
  if (totalPages && currentPage < totalPages) return { malformed: false, url: route.pageUrl(currentPage + 1) };
  return { malformed: false };
}

function latestSourceUpdate(attendees: HiEventsSourceAttendee[]): string | undefined {
  return attendees
    .map((attendee) => attendee.sourceUpdatedAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}

async function traverseAttendees(
  route: AttendeeRoute,
  request: AttendeeRequest,
  traversal: AttendeeTraversal,
): Promise<HiEventsAttendeeSnapshot> {
  const attendees: HiEventsSourceAttendee[] = [];
  let currentPage = 1;
  let nextUrl: string | undefined = route.pageUrl(1);
  const seenUrls = new Set<string>();

  while (nextUrl) {
    if (seenUrls.has(nextUrl) || traversal.requestedPages >= 10000) {
      return partialSnapshot(traversal, "malformed_pagination");
    }
    seenUrls.add(nextUrl);
    traversal.requestedPages += 1;
    const response = await readAttendeePage(traversal, request, nextUrl);
    if ("failure" in response) return response.failure;
    const page = attendeePage(response.json, currentPage);
    if ("failure" in page) return partialSnapshot(traversal, page.failure);
    attendees.push(...page.rows.map((row) => sourceAttendee(row, traversal.eventId)));
    traversal.completedPages += 1;
    traversal.totalPages = page.totalPages || traversal.totalPages;
    const next = nextPage(route, page.nextUrl, traversal.totalPages, currentPage);
    if (next.malformed) return partialSnapshot(traversal, "malformed_pagination");
    if (next.url) currentPage += 1;
    nextUrl = next.url;
  }

  const { eventId, fetchedAt, requestedPages, completedPages, totalPages } = traversal;
  return {
    state: "success",
    eventId,
    fetchedAt,
    pagination: pageState(requestedPages, completedPages, totalPages || completedPages, true),
    attendees,
    sourceUpdatedAt: latestSourceUpdate(attendees),
  };
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
  const settings = requestSettings(options);
  if (!rawApiUrl || !eventId) {
    return { state: "unavailable", fetchedAt, pagination: pageState(0, 0), reason: "configuration" };
  }
  const token = options.accessToken || await getAuthToken(rawApiUrl, fetcher, settings.timeoutMs);
  if (!token) {
    return { state: "unavailable", eventId, fetchedAt, pagination: pageState(0, 0), reason: "authentication" };
  }

  const headers: HeadersInit = { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  return traverseAttendees(
    attendeeRoute(rawApiUrl, eventId),
    { ...settings, fetcher, headers },
    { eventId, fetchedAt, requestedPages: 0, completedPages: 0 },
  );
}

type HiEventsEventResponse = { data?: { product_categories?: Array<{ products?: unknown[] }>; slug?: string } };

function firstCategoryProducts(json: HiEventsEventResponse): unknown[] | undefined {
  return json.data?.product_categories?.[0]?.products;
}

function releaseEventUrl(rawApiUrl: string, eventId: string, slug?: string): string {
  const eventUrl = `${rawApiUrl.replace(/\/$/, "")}/event/${eventId}`;
  return slug ? `${eventUrl}/${slug}` : eventUrl;
}

function releaseFromProduct(ticket: Record<string, unknown>, purchaseLink: string): HiEventsRelease {
  return {
    id: numberValue(ticket.id) || 0,
    title: text(ticket.title) || "Ticket",
    description: text(ticket.description) || null,
    price: ticket.price == null ? null : numberValue(ticket.price) ?? null,
    currency: text(ticket.currency) || "EUR",
    is_available: flag(ticket.is_available),
    sales_start_date: null,
    sales_end_date: null,
    quantity_sold: numberValue(ticket.quantity_sold) || 0,
    quantity_available: null,
    purchase_link: purchaseLink,
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
    const json = await response.json() as HiEventsEventResponse;
    const products = firstCategoryProducts(json);
    if (!Array.isArray(products)) return [];
    const purchaseLink = releaseEventUrl(rawApiUrl, eventId, json.data?.slug);
    return products
      .filter(isRecord)
      .filter((ticket) => !isHiddenProduct(ticket))
      .map((ticket) => releaseFromProduct(ticket, purchaseLink));
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
