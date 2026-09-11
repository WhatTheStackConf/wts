/** Server-only, source-pinned lookup. Never put a name/email query in any URL.
 * Public list resources omit email. Join the complete list to authenticated event
 * attendees transiently, then discard it. No cache, mirror, logger or effects.
 */
import { checkinMetadataPath, checkinMetadataUrl, checkinDiscoveryConfiguration, checkinServerConfig, createCheckinDiscoveryAdapter, type CheckinDiscoveryConfig } from "~/lib/checkin-hievents";
import { createCheckinEventSource } from "~/lib/checkin-event-source";
import { createCheckinUpstreamReader, type CheckinReadDependencies } from "~/lib/checkin-upstream-read";
import { isCheckinArrivalQrIdentity } from "~/lib/checkin-arrival-validation";
import type { CheckinEventSnapshot } from "~/lib/checkin-event-contract";

export interface LookupAttendee { attendeeId: string; publicId: string; name: string; email: string }
export type LookupRead = { state: "complete"; attendees: LookupAttendee[] } | { state: "partial" | "unavailable" };
export interface CheckinLookupSource {
  sourceKey: string;
  search(snapshot: CheckinEventSnapshot, query: string): Promise<LookupRead>;
  identity(snapshot: CheckinEventSnapshot, attendeeId: string): Promise<LookupRead>;
}
function requireValue(value: unknown): asserts value { if (!value) throw new Error("Lookup contract"); }
function record(value: unknown): Record<string, unknown> { requireValue(value && typeof value === "object" && !Array.isArray(value)); return value as Record<string, unknown>; }
function id(value: unknown): string { requireValue((typeof value === "number" || typeof value === "string") && /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value))); return String(value); }
function navigation(value: unknown, endpoint: string, page: number | null, perPage: number) {
  if (page === null) { requireValue(value === null); return; }
  requireValue(typeof value === "string" && value.length <= 4096 && !/[\s\\]/.test(value));
  const url = new URL(value, endpoint);
  requireValue(checkinMetadataUrl(url, endpoint));
  requireValue(url.searchParams.getAll("page").length === 1 && url.searchParams.get("page") === String(page));
  for (const [key, value] of url.searchParams) requireValue(key === "page" || (key === "per_page" && ["25", String(perPage)].includes(value)));
  requireValue(url.searchParams.getAll("per_page").length <= 1);
}
const fold = (text: string) => text.normalize("NFC").toLocaleLowerCase("en");
function projected(value: Record<string, unknown>, snapshot: CheckinEventSnapshot): LookupAttendee {
  requireValue(id(value.event_id) === snapshot.upstreamEventId && isCheckinArrivalQrIdentity(value.public_id));
  requireValue(typeof value.first_name === "string" && (typeof value.last_name === "string" || value.last_name === null));
  const name = `${value.first_name} ${value.last_name ?? ""}`.normalize("NFC").replace(/[\p{Cc}\p{Cf}\p{Z}\s]+/gu, " ").trim();
  requireValue(name.length > 0 && name.length <= 200 && !/@|:\/\/|www\.|[<>]|bearer\s|secret|password|token\s*[:=]|\b[A-Z]-[A-Z0-9]{7}\b/i.test(name));
  requireValue(typeof value.email === "string" && value.email.length <= 254 && /^[^\s@<>\p{Cc}\p{Cf}]+@[^\s@<>\p{Cc}\p{Cf}]+$/u.test(value.email));
  return { attendeeId: id(value.id), publicId: value.public_id, name, email: value.email };
}
export function createCheckinLookupAdapter(input?: CheckinDiscoveryConfig, transport: typeof fetch = fetch, dependencies?: CheckinReadDependencies): CheckinLookupSource {
  const raw = input ?? checkinServerConfig();
  const config = checkinDiscoveryConfiguration(raw);
  const sourceKey = createCheckinEventSource(raw, transport).sourceKey;
  const discovery = createCheckinDiscoveryAdapter(raw, transport, dependencies);
  const read = config ? createCheckinUpstreamReader(config, transport, dependencies) : null;
  async function lookup(snapshot: CheckinEventSnapshot, query: string | null, attendeeId?: string): Promise<LookupRead> {
    let validatedPages = 0;
    try {
      requireValue(config && read && snapshot.sourceKey === sourceKey);
      id(snapshot.upstreamEventId); id(snapshot.upstreamListId);
      const options = await discovery.options(snapshot.upstreamEventId);
      requireValue(options.status === "complete");
      const list = options.data.lists.find((entry) => entry.id === snapshot.upstreamListId && entry.isActive && !entry.isExpired);
      requireValue(list);
      const capability = options.data.serverOnly.listCapabilities[list.id];
      requireValue(capability && /^[A-Za-z0-9_-]{1,255}$/.test(capability));
      async function collection(path: string, simple: boolean) {
        const rows: Record<string, unknown>[] = [], ids = new Set<string>(), publicIds = new Set<string>();
        let perPage: number | undefined, total: number | undefined;
        const endpoint = `${config!.base}/${path}`;
        for (let current = 1; current <= 40; current++) {
          const body = await read!(`${path}?page=${current}&per_page=25`, !simple);
          requireValue(!("errors" in body) && Array.isArray(body.data));
          const meta = record(body.meta), links = record(body.links);
          requireValue(typeof meta.per_page === "number" && Number.isSafeInteger(meta.per_page) && meta.per_page > 0 && meta.per_page <= 25 && (perPage === undefined || perPage === meta.per_page));
          perPage = meta.per_page;
          requireValue(meta.current_page === current && checkinMetadataPath(meta.path, endpoint) && body.data.length <= perPage);
          requireValue(meta.from === (body.data.length ? rows.length + 1 : null) && meta.to === (body.data.length ? rows.length + body.data.length : null));
          let last: number | null = null;
          if (simple) requireValue(!("total" in meta) && !("last_page" in meta));
          else {
            requireValue(typeof meta.total === "number" && Number.isSafeInteger(meta.total) && meta.total >= 0 && meta.total <= 1000 && (total === undefined || total === meta.total));
            total = meta.total; last = Math.max(1, Math.ceil(total / perPage));
            requireValue(last <= 40 && meta.last_page === last && current <= last && body.data.length === Math.min(perPage, total - rows.length));
          }
          if (meta.current_page_url !== undefined) navigation(meta.current_page_url, endpoint, current, perPage);
          navigation(links.first, endpoint, 1, perPage); navigation(links.last, endpoint, last, perPage);
          navigation(links.prev, endpoint, current > 1 ? current - 1 : null, perPage);
          navigation(links.next, endpoint, simple ? (links.next === null ? null : current + 1) : (current < last! ? current + 1 : null), perPage);
          requireValue(links.next === null || body.data.length === perPage);
          for (const value of body.data) {
            const row = record(value), key = id(row.id);
            requireValue(!ids.has(key) && isCheckinArrivalQrIdentity(row.public_id) && !publicIds.has(row.public_id));
            id(row.product_id); id(row.order_id);
            if (row.event_id !== undefined) requireValue(id(row.event_id) === snapshot.upstreamEventId);
            ids.add(key); publicIds.add(row.public_id); rows.push(row);
          }
          validatedPages++;
          if (links.next === null) return rows;
          requireValue(current < 40);
        }
        throw new Error("Lookup limit");
      }
      // Membership is proven by the actual public list, never direct detail alone.
      const members = await collection(`public/check-in-lists/${capability}/attendees`, true);
      const membersById = new Map(members.map((row) => [id(row.id), row]));
      let details: Record<string, unknown>[];
      if (attendeeId !== undefined) {
        id(attendeeId);
        if (!membersById.has(attendeeId)) return { state: "complete", attendees: [] };
        const body = await read(`events/${snapshot.upstreamEventId}/attendees/${attendeeId}`);
        requireValue(!("errors" in body) && !("meta" in body) && !("links" in body));
        const detail = record(body.data); requireValue(id(detail.id) === attendeeId); details = [detail];
      } else details = await collection(`events/${snapshot.upstreamEventId}/attendees`, false);
      const result: LookupAttendee[] = [];
      for (const detail of details) {
        const member = membersById.get(id(detail.id));
        if (!member) continue;
        requireValue(member.public_id === detail.public_id && id(member.product_id) === id(detail.product_id) && id(member.order_id) === id(detail.order_id));
        requireValue(list.productIds.includes(id(member.product_id)));
        const person = projected(detail, snapshot);
        if (query === null || fold(person.name).includes(fold(query)) || fold(person.email).includes(fold(query))) result.push(person);
      }
      // A missing event row cannot silently turn a list member into no-results.
      if (attendeeId === undefined) requireValue(members.every((member) => details.some((detail) => id(detail.id) === id(member.id))));
      result.sort((a, b) => Number(a.attendeeId) - Number(b.attendeeId));
      return { state: "complete", attendees: result };
    } catch { return { state: validatedPages ? "partial" : "unavailable" }; }
  }
  return { sourceKey, search: (snapshot, query) => lookup(snapshot, query), identity: (snapshot, attendeeId) => lookup(snapshot, null, attendeeId) };
}
