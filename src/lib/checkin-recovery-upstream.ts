/** Server-only recovery adapter. Pinned Hi.Events cfbf468bb5b1b4ed3cba18184edc2e1094318f17:
 * GetCheckInListAttendeesPublicHandler attaches the exact-list check_in;
 * DeleteAttendeeCheckInService targets list short_id + check-in short_id.
 * Capabilities remain transient. No POST exists here. DELETE is coordinator-only. */
import { createHash } from "node:crypto";
import { createCheckinEventSource } from "./checkin-event-source.js";
import { checkinMetadataPath, checkinMetadataUrl, checkinDiscoveryConfiguration, checkinServerConfig, createCheckinDiscoveryAdapter, type CheckinDiscoveryConfig } from "./checkin-hievents.js";
import { CheckinReadError, createCheckinUpstreamReader, type CheckinReadDependencies } from "./checkin-upstream-read.js";
import type { RecoveryRead, RecoverySource, RecoveryTarget } from "./checkin-recovery-contract.js";

function assert(value: unknown): asserts value { if (!value) throw new Error("contract"); }
function object(value: unknown): Record<string, unknown> { assert(value && typeof value === "object" && !Array.isArray(value)); return value as Record<string, unknown>; }
function id(value: unknown): string { assert((typeof value === "number" && Number.isSafeInteger(value) && value > 0) || (typeof value === "string" && /^[1-9][0-9]{0,15}$/.test(value) && Number.isSafeInteger(Number(value)))); return String(value); }
function capability(value: unknown): string { assert(typeof value === "string" && /^[A-Za-z0-9_-]{1,255}$/.test(value)); return value; }
export interface RecoveryResetTarget extends RecoveryTarget { resetId: string; checkinId: string; fingerprint: string }
export interface RecoveryUpstream extends RecoverySource { reset(target: RecoveryResetTarget, beforeDelete: () => Promise<void>): Promise<"deleted" | "uncertain" | "identity_changed"> }

type Row = Record<string, unknown>;
interface Scan { target: RecoveryTarget; endpoint: string; publicId: string; productIds: string[]; seen: Set<string>; total: number; pageSize?: number; match?: Row }
const isPageSize = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 25;
/** Validates one page's size and position against the rows already scanned. */
function scanPage(scan: Scan, body: Row, page: number) {
  assert(!("errors" in body) && Array.isArray(body.data));
  const data = body.data as unknown[], meta = object(body.meta);
  object(body.links);
  assert(!("total" in meta) && !("last_page" in meta));
  assert(isPageSize(meta.per_page));
  assert(scan.pageSize === undefined || scan.pageSize === meta.per_page); scan.pageSize = meta.per_page;
  assert(meta.current_page === page && checkinMetadataPath(meta.path, scan.endpoint) && data.length <= scan.pageSize);
  assert(meta.from === (data.length ? scan.total + 1 : null) && meta.to === (data.length ? scan.total + data.length : null));
}
/** A navigation URL stays on the scanned endpoint and carries only the scan's own query. */
function scanLink(scan: Scan, value: unknown, expected: number) {
  assert(typeof value === "string" && value.length <= 4096 && !/[\\\s]/.test(value));
  const url = new URL(value, scan.endpoint);
  assert(checkinMetadataUrl(url, scan.endpoint));
  assert(url.searchParams.getAll("page").length === 1 && url.searchParams.get("page") === String(expected));
  for (const [k, v] of url.searchParams) assert(k === "page" || k === "per_page" && v === String(scan.pageSize) || k === "query" && v === scan.publicId);
  assert(url.searchParams.getAll("per_page").length <= 1 && url.searchParams.getAll("query").length <= 1);
}
function scanLinks(scan: Scan, body: Row, page: number) {
  const meta = object(body.meta), links = object(body.links);
  const expected = [["current_page_url", page], ["first", 1], ["last", null], ["prev", page > 1 ? page - 1 : null], ["next", links.next === null ? null : page + 1]] as const;
  for (const [key, number] of expected) {
    if (key === "current_page_url" && meta.current_page_url === undefined) continue;
    const value = key === "current_page_url" ? meta.current_page_url : links[key];
    if (number === null) assert(value === null);
    else scanLink(scan, value, number);
  }
  return links.next !== null;
}
function scanRows(scan: Scan, data: unknown[]) {
  for (const value of data) {
    const row = object(value), rowId = id(row.id); assert(!scan.seen.has(rowId)); scan.seen.add(rowId);
    if (rowId !== scan.target.upstreamAttendeeId && row.public_id !== scan.publicId) continue;
    assert(!scan.match && rowId === scan.target.upstreamAttendeeId && row.public_id === scan.publicId && scan.productIds.includes(id(row.product_id)));
    if (row.event_id !== undefined) assert(id(row.event_id) === scan.target.upstreamEventId);
    scan.match = row;
  }
}
function matchedCheckin(target: RecoveryTarget, match: Row | undefined, listShort: string): { result: RecoveryRead; list?: string; checkin?: string } {
  // A missing attendee is not an authoritative empty check-in read.
  assert(match);
  if (!("check_in" in match)) return { result: { state: "absent" } };
  const checkin = object(match.check_in);
  assert(id(checkin.attendee_id) === target.upstreamAttendeeId && id(checkin.check_in_list_id) === target.upstreamListId && id(checkin.order_id) === id(match.order_id));
  assert(typeof checkin.checked_in_at === "string" && Number.isFinite(Date.parse(checkin.checked_in_at)));
  const checkinId = id(checkin.id), short = capability(checkin.short_id);
  const fingerprint = createHash("sha256").update(JSON.stringify([target.sourceKey, target.upstreamEventId, target.upstreamListId, target.upstreamAttendeeId, checkinId, id(checkin.order_id), checkin.checked_in_at, short])).digest("hex");
  return { result: { state: "existing", checkinId, fingerprint }, list: listShort, checkin: short };
}
function readFailure(error: unknown): RecoveryRead {
  return { state: error instanceof CheckinReadError && !["contract", "limit"].includes(error.reason) ? "unavailable" : "malformed" };
}

export function createCheckinRecoverySource(input?: CheckinDiscoveryConfig, transport: typeof fetch = fetch, dependencies?: CheckinReadDependencies): RecoveryUpstream {
  const raw = input ?? checkinServerConfig();
  const config = checkinDiscoveryConfiguration(raw);
  const sourceKey = createCheckinEventSource(raw, transport).sourceKey;
  const discovery = createCheckinDiscoveryAdapter(raw, transport, dependencies);
  const read = config ? createCheckinUpstreamReader(config, transport, dependencies) : null;
  async function attendeePublicId(target: RecoveryTarget) {
    const detail = object((await read!(`events/${target.upstreamEventId}/attendees/${target.upstreamAttendeeId}`)).data);
    assert(id(detail.id) === target.upstreamAttendeeId && id(detail.event_id) === target.upstreamEventId);
    assert(typeof detail.public_id === "string" && /^A-[A-Z0-9]{7,9}$/.test(detail.public_id));
    return detail.public_id;
  }
  async function scanList(target: RecoveryTarget, listShort: string, productIds: string[]) {
    const publicId = await attendeePublicId(target);
    const path = `public/check-in-lists/${listShort}/attendees`;
    const scan: Scan = { target, endpoint: `${config!.base}/${path}`, publicId, productIds, seen: new Set(), total: 0 };
    for (let page = 1; page <= 40; page++) {
      const body = await read!(`${path}?page=${page}&per_page=25&query=${encodeURIComponent(publicId)}`, false);
      scanPage(scan, body, page);
      const more = scanLinks(scan, body, page);
      const data = body.data as unknown[];
      scanRows(scan, data);
      scan.total += data.length;
      if (!more) return matchedCheckin(target, scan.match, listShort);
      assert(data.length === scan.pageSize && page < 40);
    }
    return { result: { state: "malformed" } as RecoveryRead };
  }
  async function inspect(target: RecoveryTarget): Promise<{ result: RecoveryRead; list?: string; checkin?: string }> {
    if (!config || !read || sourceKey !== target.sourceKey) return { result: { state: "unavailable" } };
    try {
      id(target.upstreamEventId); id(target.upstreamListId); id(target.upstreamAttendeeId);
      const options = await discovery.options(target.upstreamEventId);
      if (options.status !== "complete") return { result: { state: options.reason === "contract" || options.reason === "limit" ? "malformed" : "unavailable" } };
      const list = options.data.lists.find(row => row.id === target.upstreamListId);
      assert(list);
      const listShort = capability(options.data.serverOnly.listCapabilities[list.id]);
      return await scanList(target, listShort, list.productIds);
    } catch (error) { return { result: readFailure(error) }; }
  }
  return {
    async reconcile(target) { return (await inspect(target)).result; },
    async reset(target, beforeDelete) {
      // Freeze caller-owned identity before any asynchronous inspection.
      target = { ...target };
      const current = await inspect(target);
      if (current.result.state === "malformed" || current.result.state === "unavailable") return "uncertain";
      if (current.result.state !== "existing" || current.result.checkinId !== target.checkinId || current.result.fingerprint !== target.fingerprint) return "identity_changed";
      try {
        // No optional callback/default: missing, denied or lost authorization means no DELETE.
        assert(typeof beforeDelete === "function");
        await beforeDelete();
        const response = await transport(`${config!.base}/public/check-in-lists/${current.list}/check-ins/${current.checkin}`, { method: "DELETE", redirect: "error", credentials: "omit", cache: "no-store", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
        void response.body?.cancel();
        return response.status === 204 && !response.redirected ? "deleted" : "uncertain";
      } catch { return "uncertain"; }
    },
  };
}
