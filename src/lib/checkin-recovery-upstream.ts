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

export function createCheckinRecoverySource(input?: CheckinDiscoveryConfig, transport: typeof fetch = fetch, dependencies?: CheckinReadDependencies): RecoveryUpstream {
  const raw = input ?? checkinServerConfig();
  const config = checkinDiscoveryConfiguration(raw);
  const sourceKey = createCheckinEventSource(raw, transport).sourceKey;
  const discovery = createCheckinDiscoveryAdapter(raw, transport, dependencies);
  const read = config ? createCheckinUpstreamReader(config, transport, dependencies) : null;
  async function inspect(target: RecoveryTarget): Promise<{ result: RecoveryRead; list?: string; checkin?: string }> {
    if (!config || !read || sourceKey !== target.sourceKey) return { result: { state: "unavailable" } };
    try {
      id(target.upstreamEventId); id(target.upstreamListId); id(target.upstreamAttendeeId);
      const options = await discovery.options(target.upstreamEventId);
      if (options.status !== "complete") return { result: { state: options.reason === "contract" || options.reason === "limit" ? "malformed" : "unavailable" } };
      const list = options.data.lists.find(row => row.id === target.upstreamListId);
      assert(list);
      const listShort = capability(options.data.serverOnly.listCapabilities[list.id]);
      const detail = object((await read(`events/${target.upstreamEventId}/attendees/${target.upstreamAttendeeId}`)).data);
      assert(id(detail.id) === target.upstreamAttendeeId && id(detail.event_id) === target.upstreamEventId);
      assert(typeof detail.public_id === "string" && /^A-[A-Z0-9]{7,9}$/.test(detail.public_id));
      const path = `public/check-in-lists/${listShort}/attendees`;
      const endpoint = `${config.base}/${path}`;
      const seen = new Set<string>(); let match: Record<string, unknown> | undefined;
      let total = 0; let pageSize: number | undefined;
      for (let page = 1; page <= 40; page++) {
        const body = await read(`${path}?page=${page}&per_page=25&query=${encodeURIComponent(detail.public_id)}`, false);
        assert(!("errors" in body) && Array.isArray(body.data));
        const meta = object(body.meta), links = object(body.links);
        assert(!("total" in meta) && !("last_page" in meta));
        assert(typeof meta.per_page === "number" && Number.isSafeInteger(meta.per_page) && meta.per_page > 0 && meta.per_page <= 25);
        assert(pageSize === undefined || pageSize === meta.per_page); pageSize = meta.per_page;
        assert(meta.current_page === page && checkinMetadataPath(meta.path, endpoint) && body.data.length <= pageSize);
        assert(meta.from === (body.data.length ? total + 1 : null) && meta.to === (body.data.length ? total + body.data.length : null));
        for (const [key, expected] of [["current_page_url", page], ["first", 1], ["last", null], ["prev", page > 1 ? page - 1 : null], ["next", links.next === null ? null : page + 1]] as const) {
          if (key === "current_page_url" && meta.current_page_url === undefined) continue;
          const value = key === "current_page_url" ? meta.current_page_url : links[key]; if (expected === null) { assert(value === null); continue; }
          assert(typeof value === "string" && value.length <= 4096 && !/[\\\s]/.test(value));
          const url = new URL(value, endpoint);
          assert(checkinMetadataUrl(url, endpoint));
          assert(url.searchParams.getAll("page").length === 1 && url.searchParams.get("page") === String(expected));
          for (const [k, v] of url.searchParams) assert(k === "page" || k === "per_page" && v === String(pageSize) || k === "query" && v === detail.public_id);
          assert(url.searchParams.getAll("per_page").length <= 1 && url.searchParams.getAll("query").length <= 1);
        }
        for (const value of body.data) {
          const row = object(value), rowId = id(row.id); assert(!seen.has(rowId)); seen.add(rowId);
          if (rowId === target.upstreamAttendeeId || row.public_id === detail.public_id) {
            assert(!match && rowId === target.upstreamAttendeeId && row.public_id === detail.public_id && list.productIds.includes(id(row.product_id)));
            if (row.event_id !== undefined) assert(id(row.event_id) === target.upstreamEventId);
            match = row;
          }
        }
        total += body.data.length;
        if (links.next !== null) { assert(body.data.length === pageSize && page < 40); continue; }
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
      return { result: { state: "malformed" } };
    } catch (error) { return { result: { state: error instanceof CheckinReadError && !["contract", "limit"].includes(error.reason) ? "unavailable" : "malformed" } }; }
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
