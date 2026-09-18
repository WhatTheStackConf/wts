/** Server-only, source-pinned lookup. Never put a name/email query in any URL.
 * Public list resources omit email. Join the complete list to authenticated event
 * attendees transiently, then discard it. No cache, mirror, logger or effects.
 */
import { checkinMetadataPath, checkinMetadataUrl, checkinDiscoveryConfiguration, checkinServerConfig, createCheckinDiscoveryAdapter, type CheckinDiscoveryConfig } from "~/lib/checkin-hievents";
import { createCheckinEventSource } from "~/lib/checkin-event-source";
import { createCheckinUpstreamReader, type CheckinReadDependencies } from "~/lib/checkin-upstream-read";
import { isCheckinArrivalQrIdentity } from "~/lib/checkin-arrival-validation";
import type { CheckinEventSnapshot } from "~/lib/checkin-event-contract";

export interface LookupAttendee { attendeeId: string; publicId: string; name: string; email: string; checkedIn?: boolean; status?: "ACTIVE" | "CANCELLED" | "AWAITING_PAYMENT" }
export type LookupRead = { state: "complete"; attendees: LookupAttendee[] } | { state: "partial" | "unavailable" };
export interface CheckinLookupSource {
  sourceKey: string;
  search(snapshot: CheckinEventSnapshot, query: string): Promise<LookupRead>;
  identity(snapshot: CheckinEventSnapshot, attendeeId: string): Promise<LookupRead>;
}
function requireValue(value: unknown): asserts value { if (!value) throw new Error("Lookup contract"); }
function record(value: unknown): Record<string, unknown> { requireValue(value && typeof value === "object" && !Array.isArray(value)); return value as Record<string, unknown>; }
function id(value: unknown): string { requireValue((typeof value === "number" || typeof value === "string") && /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value))); return String(value); }
function navigation(value: unknown, endpoint: string, page: number | null, perPage: number, sorted: boolean) {
  if (page === null) { requireValue(value === null); return; }
  requireValue(typeof value === "string" && value.length <= 4096 && !/[\s\\]/.test(value));
  const url = new URL(value, endpoint);
  requireValue(checkinMetadataUrl(url, endpoint));
  requireValue(url.searchParams.getAll("page").length === 1 && url.searchParams.get("page") === String(page));
  for (const [key, value] of url.searchParams) requireValue(key === "page" || (key === "per_page" && ["100", String(perPage)].includes(value)) || (sorted && key === "sort_by" && value === "id") || (sorted && key === "sort_direction" && value === "asc"));
  for (const key of ["per_page", "sort_by", "sort_direction"]) requireValue(url.searchParams.getAll(key).length <= 1);
}
const fold = (text: string) => text.normalize("NFC").toLocaleLowerCase("en");
function checkedIn(detail: Record<string, unknown>, member: Record<string, unknown>, snapshot: CheckinEventSnapshot): boolean | undefined {
  let publicStatus: boolean | undefined;
  if (member.check_in !== undefined) {
    if (member.check_in === null) publicStatus = false;
    else {
      const checkin = record(member.check_in);
      id(checkin.id);
      requireValue(id(checkin.attendee_id) === id(member.id) && id(checkin.check_in_list_id) === snapshot.upstreamListId && id(checkin.order_id) === id(member.order_id));
      requireValue(typeof checkin.checked_in_at === "string" && Number.isFinite(Date.parse(checkin.checked_in_at)));
      publicStatus = true;
    }
  }
  if (detail.check_ins === undefined) return publicStatus;
  requireValue(Array.isArray(detail.check_ins) && detail.check_ins.length <= 1000);
  const ids = new Set<string>();
  let exactList = false;
  for (const value of detail.check_ins) {
    const checkin = record(value), key = id(checkin.id);
    requireValue(!ids.has(key)); ids.add(key);
    requireValue(id(checkin.attendee_id) === id(detail.id));
    const listId = id(checkin.check_in_list_id);
    for (const field of ["event_id", "product_id", "order_id"] as const) if (checkin[field] !== undefined) requireValue(id(checkin[field]) === id(detail[field]));
    requireValue(typeof checkin.created_at === "string" && Number.isFinite(Date.parse(checkin.created_at)));
    requireValue(checkin.deleted_at === undefined || checkin.deleted_at === null);
    if (listId === snapshot.upstreamListId) exactList = true;
  }
  // Both observations must agree when the public resource supplied explicit evidence.
  requireValue(publicStatus === undefined || publicStatus === exactList);
  return exactList;
}
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
        let perPage: number | undefined, total: number | undefined, previousId = 0;
        const endpoint = `${config!.base}/${path}`;
        // Pinned AttendeeRepository supports ID sorting only on authenticated
        // event reads; the public simple paginator ignores sort parameters.
        for (let current = 1; current <= 100; current++) {
          const body = await read!(`${path}?page=${current}&per_page=100${simple ? "" : "&sort_by=id&sort_direction=asc"}`, !simple);
          requireValue(!("errors" in body) && Array.isArray(body.data));
          const meta = record(body.meta), links = record(body.links);
          requireValue(typeof meta.per_page === "number" && Number.isSafeInteger(meta.per_page) && meta.per_page > 0 && meta.per_page <= 100 && (perPage === undefined || perPage === meta.per_page));
          perPage = meta.per_page;
          requireValue(meta.current_page === current && checkinMetadataPath(meta.path, endpoint) && body.data.length <= perPage);
          requireValue(meta.from === (body.data.length ? rows.length + 1 : null) && meta.to === (body.data.length ? rows.length + body.data.length : null));
          let last: number | null = null;
          if (simple) requireValue(!("total" in meta) && !("last_page" in meta));
          else {
            requireValue(typeof meta.total === "number" && Number.isSafeInteger(meta.total) && meta.total >= 0 && meta.total <= 10000 && (total === undefined || total === meta.total));
            total = meta.total; last = Math.max(1, Math.ceil(total / perPage));
            requireValue(last <= 100 && meta.last_page === last && current <= last && body.data.length === Math.min(perPage, total - rows.length));
          }
          if (meta.current_page_url !== undefined) navigation(meta.current_page_url, endpoint, current, perPage, !simple);
          navigation(links.first, endpoint, 1, perPage, !simple); navigation(links.last, endpoint, last, perPage, !simple);
          navigation(links.prev, endpoint, current > 1 ? current - 1 : null, perPage, !simple);
          navigation(links.next, endpoint, simple ? (links.next === null ? null : current + 1) : (current < last! ? current + 1 : null), perPage, !simple);
          requireValue(links.next === null || body.data.length === perPage);
          requireValue(rows.length + body.data.length <= 10000);
          for (const value of body.data) {
            const row = record(value), key = id(row.id);
            requireValue(!ids.has(key) && isCheckinArrivalQrIdentity(row.public_id) && !publicIds.has(row.public_id));
            if (!simple) { requireValue(Number(key) > previousId); previousId = Number(key); }
            id(row.product_id); id(row.order_id);
            if (!simple || row.event_id !== undefined) requireValue(id(row.event_id) === snapshot.upstreamEventId);
            ids.add(key); publicIds.add(row.public_id); rows.push(row);
          }
          validatedPages++;
          if (links.next === null) return rows;
          requireValue(current < 100);
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
        requireValue(detail.status === "ACTIVE" || detail.status === "CANCELLED" || detail.status === "AWAITING_PAYMENT");
        requireValue(member.status === detail.status);
        person.status = detail.status;
        const status = checkedIn(detail, member, snapshot);
        if (status !== undefined) person.checkedIn = status;
        if (query === null || fold(person.name).includes(fold(query)) || fold(person.email).includes(fold(query))) result.push(person);
      }
      // A missing event row cannot silently turn a list member into no-results.
      if (attendeeId === undefined) {
        const detailIds = new Set(details.map((detail) => id(detail.id)));
        requireValue(members.every((member) => detailIds.has(id(member.id))));
      }
      result.sort((a, b) => Number(a.attendeeId) - Number(b.attendeeId));
      return { state: "complete", attendees: result };
    } catch { return { state: validatedPages ? "partial" : "unavailable" }; }
  }
  return { sourceKey, search: (snapshot, query) => lookup(snapshot, query), identity: (snapshot, attendeeId) => lookup(snapshot, null, attendeeId) };
}
