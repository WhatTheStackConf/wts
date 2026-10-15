/** Server-only admission discovery. No imports from the ticket/gamification adapter.
 * Source contract and deployment prerequisites: docs/checkin-hievents-contract.md.
 */
import { CheckinReadError, createCheckinUpstreamReader, type CheckinReadDependencies } from "./checkin-upstream-read.js";

export type DiscoveryFailureReason = "configuration" | "invalid_event_id" | "transport" | "http" | "contract" | "limit";
export type DiscoveryResult<T> =
  | { status: "complete"; data: T }
  | { status: "unavailable" | "partial"; reason: DiscoveryFailureReason };
export interface DiscoveredEvent { id: string; title: string }
export interface DiscoveredList { id: string; title: string; productIds: string[]; isActive: boolean; isExpired: boolean }
export interface DiscoveredQuestion { id: string; title: string; type: string; belongsTo: "PRODUCT" | "ORDER"; productIds: string[] }
export interface EventOptions {
  eventId: string;
  lists: DiscoveredList[];
  questions: DiscoveredQuestion[];
  products: DiscoveredEvent[];
  /** NEVER serialize this to any browser, log, audit record, or client-readable collection. */
  serverOnly: { listCapabilities: Record<string, string> };
}
export interface CheckinDiscoveryAdapter {
  discover(): Promise<DiscoveryResult<DiscoveredEvent[]>>;
  options(eventId: string): Promise<DiscoveryResult<EventOptions>>;
}
export interface CheckinDiscoveryConfig { apiUrl?: string; apiKey?: string; accountId?: string }

class DiscoveryError extends Error {
  constructor(readonly reason: DiscoveryFailureReason) { super(reason); }
}
function requireContract(condition: unknown): asserts condition {
  if (!condition) throw new DiscoveryError("contract");
}
function record(value: unknown): Record<string, unknown> {
  requireContract(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  requireContract((typeof value === "number" && Number.isSafeInteger(value) && value > 0)
    || (typeof value === "string" && /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value))));
  return String(value);
}
function title(value: unknown): string {
  requireContract(typeof value === "string" && value.trim().length > 0 && value.length <= 2000);
  return value;
}
function event(value: unknown): DiscoveredEvent {
  const row = record(value);
  return { id: id(row.id), title: title(row.title) };
}
export function checkinServerConfig(): CheckinDiscoveryConfig {
  if (typeof window !== "undefined") return {};
  let apiUrl = process.env.HIEVENTS_API_URL;
  // The shared legacy setting may be an origin; other consumers append /api.
  // Normalize only that valid configuration form, without changing the shared
  // environment or repairing unsafe URLs. Explicit adapter inputs stay strict.
  if (apiUrl && /^https:\/\/[^/?#\\\s]+\/?$/.test(apiUrl)) {
    try {
      const url = new URL(apiUrl);
      if (!url.username && !url.password && url.pathname === "/") apiUrl = `${apiUrl.replace(/\/$/, "")}/api`;
    } catch { /* The existing configuration validator rejects invalid values. */ }
  }
  return { apiUrl, apiKey: process.env.HIEVENTS_API_KEY, accountId: process.env.HIEVENTS_ACCOUNT_ID };
}
function isPlainHttpsApiUrl(apiUrl: string): boolean {
  const url = new URL(apiUrl);
  return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash
    && apiUrl === apiUrl.trim() && /^\/[^?#%\\\s]*$/.test(url.pathname);
}
// The pinned upstream uses JWT auth, NOT an API-key header or account-switch header.
// This claim comparison is only a configuration consistency check; upstream verifies the signature.
function apiKeyMatchesAccount(apiKey: string, accountId: string): boolean {
  if (apiKey.length > 16384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(apiKey)) return false;
  const claims = record(JSON.parse(Buffer.from(apiKey.split(".")[1]!, "base64url").toString("utf8")));
  return id(claims.account_id) === id(accountId);
}
export function checkinDiscoveryConfiguration(input: CheckinDiscoveryConfig): { base: string; key: string } | null {
  try {
    if (typeof window !== "undefined" || !input.apiUrl || !input.apiKey || !input.accountId) return null;
    if (!isPlainHttpsApiUrl(input.apiUrl) || !apiKeyMatchesAccount(input.apiKey, input.accountId)) return null;
    return { base: input.apiUrl.replace(/\/$/, ""), key: input.apiKey };
  } catch { return null; }
}

/** Lazy server environment read; injected transport is the approved #44 fixture seam. */
export function createCheckinDiscoveryAdapter(input?: CheckinDiscoveryConfig, transport: typeof fetch = fetch, dependencies?: CheckinReadDependencies): CheckinDiscoveryAdapter {
  const config = checkinDiscoveryConfiguration(input ?? checkinServerConfig());
  async function run<T>(work: (scope: ReadScope) => Promise<T>): Promise<DiscoveryResult<T>> {
    if (!config) return { status: "unavailable", reason: "configuration" };
    const scope: ReadScope = { acceptedPages: 0, read };
    try { return { status: "complete", data: await work(scope) }; }
    catch (error) { return { status: scope.acceptedPages ? "partial" : "unavailable", reason: error instanceof DiscoveryError || error instanceof CheckinReadError ? error.reason : "transport" }; }
  }
  const read = config ? createCheckinUpstreamReader(config, transport, dependencies) : async () => { throw new DiscoveryError("configuration"); };
  return {
    discover: () => run((scope) => paginated(scope, `${config!.base}/events`, "events", event)),
    options: (eventId) => run(async (scope) => {
      try { requireContract(typeof eventId === "string"); id(eventId); }
      catch { throw new DiscoveryError("invalid_event_id"); }
      const path = `events/${eventId}`;
      const listCapabilities: Record<string, string> = {};
      const lists = await paginated(scope, `${config!.base}/${path}/check-in-lists`, `${path}/check-in-lists`, (value) => checkInList(value, eventId, listCapabilities));
      const questions = await eventQuestions(scope, path, eventId);
      const products = await eventProducts(scope, `${config!.base}/${path}`, path, eventId);
      const productIds = new Set(products.map((product) => product.id));
      for (const option of [...lists, ...questions]) {
        requireContract(option.productIds.every((id) => productIds.has(id)));
      }
      return { eventId, lists, questions, products, serverOnly: { listCapabilities } };
    }),
  };
}

function checkInList(value: unknown, eventId: string, listCapabilities: Record<string, string>): DiscoveredList {
  const row = record(value);
  const listId = id(row.id);
  requireContract(typeof row.short_id === "string" && /^[A-Za-z0-9_-]{1,255}$/.test(row.short_id));
  requireContract(typeof row.is_active === "boolean" && typeof row.is_expired === "boolean");
  requireContract(Array.isArray(row.products));
  const productIds = uniqueIds(row.products.map((value) => {
    const product = record(value);
    requireContract(id(product.event_id) === eventId);
    return product.id;
  }));
  listCapabilities[listId] = row.short_id;
  return { id: listId, title: title(row.name), productIds, isActive: row.is_active, isExpired: row.is_expired };
}

async function eventQuestions(scope: ReadScope, path: string, eventId: string): Promise<DiscoveredQuestion[]> {
  const body = await scope.read(`${path}/questions`);
  // At the pinned SHA questions are a Collection, NOT a paginator.
  requireContract(!("meta" in body) && !("links" in body) && !("errors" in body) && Array.isArray(body.data));
  if (body.data.length > 1000) throw new DiscoveryError("limit");
  const questions = body.data.map((value): DiscoveredQuestion => {
    const row = record(value);
    requireContract(id(row.event_id) === eventId && (row.belongs_to === "PRODUCT" || row.belongs_to === "ORDER"));
    return { id: id(row.id), title: title(row.title), type: title(row.type), belongsTo: row.belongs_to, productIds: uniqueIds(row.product_ids) };
  });
  uniqueIds(questions.map((question) => question.id));
  scope.acceptedPages++;
  return questions;
}

async function eventProducts(scope: ReadScope, endpoint: string, path: string, eventId: string): Promise<DiscoveredEvent[]> {
  const acceptedBeforeProducts = scope.acceptedPages;
  try {
    return await paginated(scope, `${endpoint}/products`, `${path}/products`, (value) => {
      requireContract(id(record(value).event_id) === eventId);
      return event(value);
    });
  } catch (error) {
    // The deployed flat catalogue can fail with HTTP 500. Only that first-page
    // failure permits the complete admin collection; never rescue partial or
    // malformed pagination, auth/rate-limit failures, or transport failures.
    if (!(error instanceof CheckinReadError) || error.reason !== "http" || error.status !== 500
      || scope.acceptedPages !== acceptedBeforeProducts) throw error;
    return categoryProducts(scope, `${path}/product-categories`, eventId);
  }
}

async function categoryProducts(scope: ReadScope, path: string, eventId: string): Promise<DiscoveredEvent[]> {
  const body = await scope.read(path);
  // This authenticated admin endpoint is a complete Collection, not a paginator.
  requireContract(Object.keys(body).length === 1 && Array.isArray(body.data));
  if (body.data.length > 1000) throw new DiscoveryError("limit");
  const categoryIds: string[] = [];
  const products: DiscoveredEvent[] = [];
  for (const value of body.data) {
    const category = record(value);
    const categoryId = id(category.id);
    categoryIds.push(categoryId);
    title(category.name);
    // Deployed categories omit event_id; products must still prove event scope.
    if ("event_id" in category) requireContract(id(category.event_id) === eventId);
    requireContract(Array.isArray(category.products));
    if (products.length + category.products.length > 1000) throw new DiscoveryError("limit");
    for (const value of category.products) {
      const product = record(value);
      requireContract(id(product.event_id) === eventId);
      if ("product_category_id" in product) requireContract(id(product.product_category_id) === categoryId);
      products.push(event(product));
    }
  }
  uniqueIds(categoryIds);
  uniqueIds(products.map((product) => product.id));
  scope.acceptedPages++;
  return products;
}

function uniqueIds(value: unknown): string[] {
  requireContract(Array.isArray(value));
  if (value.length > 1000) throw new DiscoveryError("limit");
  const ids = value.map(id);
  requireContract(new Set(ids).size === ids.length);
  return ids;
}

interface ReadScope {
  acceptedPages: number;
  read(path: string): Promise<Record<string, unknown>>;
}
function count(value: unknown, min = 0): number {
  requireContract(typeof value === "number" && Number.isSafeInteger(value) && value >= min);
  return value;
}
function metadataAlias(endpoint: string): string {
  // Hi.Events can emit Laravel pagination URLs with its reverse-proxy /api
  // mount stripped. Accept only that exact same-origin metadata alias; requests
  // are still constructed independently against the configured API endpoint.
  const url = new URL(endpoint);
  if (url.pathname.startsWith("/api/")) url.pathname = url.pathname.slice(4);
  return url.href;
}
/** Server-only metadata checks; never use returned metadata to construct requests. */
export function checkinMetadataPath(value: unknown, endpoint: string): boolean {
  return value === endpoint || value === metadataAlias(endpoint);
}
export function checkinMetadataUrl(url: URL, endpoint: string): boolean {
  const target = new URL(endpoint);
  return url.origin === target.origin
    && (url.pathname === target.pathname || url.pathname === new URL(metadataAlias(endpoint)).pathname)
    && !url.username && !url.password && !url.hash;
}
function link(value: unknown, endpoint: string, expectedPage: number | null, perPage: number, requestedPerPage: number): void {
  if (expectedPage === null) { requireContract(value === null); return; }
  requireContract(typeof value === "string" && value.length <= 4096 && !/[\s\\]/.test(value));
  let url: URL;
  try { url = new URL(value, endpoint); } catch { throw new DiscoveryError("contract"); }
  requireContract(checkinMetadataUrl(url, endpoint));
  requireContract(url.searchParams.getAll("page").length === 1 && url.searchParams.get("page") === String(expectedPage));
  // Laravel may omit query parameters. Validate links but construct page URLs locally.
  for (const [key, value] of url.searchParams) {
    requireContract(key === "page" || (key === "per_page" && (value === String(requestedPerPage) || value === String(perPage))));
  }
  requireContract(url.searchParams.getAll("per_page").length <= 1);
}
interface PageShape { total: number; size: number; last: number }
function paginationLimits(limits: { pageSize: number; maxItems: number; maxPages: number }) {
  const pageSize = count(limits.pageSize, 1), maxItems = count(limits.maxItems, 1), maxPages = count(limits.maxPages, 1);
  requireContract(pageSize <= 100 && maxItems <= 10000 && maxPages <= 100);
  return { pageSize, maxItems, maxPages };
}
function pageShape(meta: Record<string, unknown>, current: number, limits: { pageSize: number; maxItems: number; maxPages: number }): PageShape {
  const total = count(meta.total);
  const size = count(meta.per_page, 1);
  const last = count(meta.last_page, 1);
  requireContract(size <= limits.pageSize && count(meta.current_page, 1) === current && last === Math.max(1, Math.ceil(total / size)));
  if (total > limits.maxItems || last > limits.maxPages) throw new DiscoveryError("limit");
  return { total, size, last };
}
function pageWindow(meta: Record<string, unknown>, page: PageShape, current: number, received: number, count: number): void {
  requireContract(current <= page.last && count === Math.min(page.size, page.total - received));
  requireContract(meta.from === (page.total ? received + 1 : null) && meta.to === (page.total ? received + count : null));
}
function pageLinks(meta: Record<string, unknown>, links: Record<string, unknown>, endpoint: string, current: number, page: PageShape, pageSize: number): void {
  if (meta.current_page_url !== undefined) link(meta.current_page_url, endpoint, current, page.size, pageSize);
  link(links.first, endpoint, 1, page.size, pageSize);
  link(links.last, endpoint, page.last, page.size, pageSize);
  link(links.prev, endpoint, current > 1 ? current - 1 : null, page.size, pageSize);
  link(links.next, endpoint, current < page.last ? current + 1 : null, page.size, pageSize);
  if (meta.links !== undefined) metadataLinks(meta.links, endpoint, page, pageSize);
}
function metadataLinks(value: unknown, endpoint: string, page: PageShape, pageSize: number): void {
  requireContract(Array.isArray(value) && value.length <= 100);
  for (const entry of value) {
    const navigation = record(entry);
    if (navigation.url === null) continue;
    requireContract(typeof navigation.url === "string");
    const target = new URL(navigation.url, endpoint);
    const number = Number(target.searchParams.get("page"));
    requireContract(Number.isSafeInteger(number) && number >= 1 && number <= page.last);
    link(navigation.url, endpoint, number, page.size, pageSize);
  }
}
function appendUnique<T extends { id: string }>(items: T[], ids: Set<string>, data: unknown[], parse: (value: unknown) => T): void {
  for (const value of data) {
    const item = parse(value);
    requireContract(!ids.has(item.id));
    ids.add(item.id);
    items.push(item);
  }
}
export async function paginated<T extends { id: string }>(scope: ReadScope, endpoint: string, path: string, parse: (value: unknown) => T, limits = { pageSize: 25, maxItems: 1000, maxPages: 40 }): Promise<T[]> {
  // Discovery keeps its original budget. Bulk read-only rosters opt into a
  // separate bounded traversal; never let growing unrelated ticket counts
  // silently truncate or suppress the configured programmes.
  const bounds = paginationLimits(limits);
  const items: T[] = [];
  const ids = new Set<string>();
  let previous: PageShape | undefined;
  for (let current = 1; current <= bounds.maxPages; current++) {
    const body = await scope.read(`${path}?page=${current}&per_page=${bounds.pageSize}`);
    requireContract(!("errors" in body) && Array.isArray(body.data));
    const meta = record(body.meta);
    const links = record(body.links);
    const page = pageShape(meta, current, bounds);
    requireContract(previous === undefined || (page.total === previous.total && page.size === previous.size));
    previous = page;
    pageWindow(meta, page, current, items.length, body.data.length);
    requireContract(checkinMetadataPath(meta.path, endpoint));
    pageLinks(meta, links, endpoint, current, page, bounds.pageSize);
    appendUnique(items, ids, body.data, parse);
    scope.acceptedPages++;
    if (current === page.last) { requireContract(items.length === page.total); return items; }
  }
  throw new DiscoveryError("limit");
}
