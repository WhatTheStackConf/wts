/** Server-only, read-only arrival adapter; never import the generic hievents.ts.
 * Evidence: research/wayfinder/hievents-checkin-fixtures.md and pinned source
 * cfbf468bb5b1b4ed3cba18184edc2e1094318f17. List attendees use simplePaginate,
 * NOT the LengthAwarePaginator used for event discovery. No deployed version
 * claim or production readiness follows from this conservative source contract.
 */
import { createHash } from "node:crypto";
import { createCheckinEventSource } from "~/lib/checkin-event-source";
import { checkinMetadataPath, checkinMetadataUrl, checkinDiscoveryConfiguration, checkinServerConfig, createCheckinDiscoveryAdapter, type CheckinDiscoveryConfig, type EventOptions } from "~/lib/checkin-hievents";
import { createCheckinUpstreamReader, type CheckinReadDependencies } from "~/lib/checkin-upstream-read";
import { isCheckinArrivalQrIdentity, type CheckinArrivalSource, type ArrivalResolution, type ArrivalAdmission, type ArrivalAttendee } from "~/lib/checkin-arrival-source";
import type { CheckinAffiliationMapping, CheckinEventSnapshot } from "~/lib/checkin-event-contract";
export { isCheckinArrivalQrIdentity } from "~/lib/checkin-arrival-source";

function requireContract(condition: unknown): asserts condition { if (!condition) throw new Error("contract"); }
function record(value: unknown): Record<string, unknown> {
  requireContract(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  requireContract((typeof value === "number" && Number.isSafeInteger(value) && value > 0)
    || (typeof value === "string" && /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value))));
  return String(value);
}
function label(value: unknown, secrets: string[]): string {
  requireContract(typeof value === "string" && value.length <= 2000);
  const text = value.normalize("NFC").replace(/[\p{Cc}\p{Cf}\p{Z}\s]+/gu, " ").trim();
  requireContract(text.length <= 200 && !/@|:\/\/|www\.|[a-f0-9]{64}|wts_mcp_|bearer\s|password|secret|token\s*[:=]|\/dev\/|\b[A-Z]-[A-Z0-9]{7}\b|\b(?:cil|ci|a|o)_[A-Za-z0-9]+|[<>]/i.test(text));
  requireContract(!secrets.some((secret) => secret && text.includes(secret)));
  return text;
}
function navigation(value: unknown, endpoint: string, page: number | null, perPage: number, query: string): void {
  if (page === null) { requireContract(value === null); return; }
  requireContract(typeof value === "string" && value.length <= 4096 && !/[\s\\]/.test(value));
  const url = new URL(value, endpoint);
  requireContract(checkinMetadataUrl(url, endpoint));
  requireContract(url.searchParams.getAll("page").length === 1 && url.searchParams.get("page") === String(page));
  for (const [key, value] of url.searchParams) requireContract(navigationParam(key, value, perPage, query));
  requireContract(url.searchParams.getAll("per_page").length <= 1 && url.searchParams.getAll("query").length <= 1);
}
function navigationParam(key: string, value: string, perPage: number, query: string): boolean {
  return key === "page" || (key === "per_page" && (value === "25" || value === String(perPage))) || (key === "query" && value === query);
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}
function admissionCheckin(value: unknown, attendee: ArrivalAttendee, listId: string): string {
  const row = record(value);
  const checkinId = id(row.id);
  requireContract(id(row.attendee_id) === attendee.upstreamAttendeeId && id(row.check_in_list_id) === listId && id(row.order_id));
  requireContract(typeof row.checked_in_at === "string" && Number.isFinite(Date.parse(row.checked_in_at)));
  requireContract(typeof row.short_id === "string" && /^[A-Za-z0-9_-]{1,255}$/.test(row.short_id));
  return createHash("sha256").update(canonical({ id: checkinId, attendee_id: row.attendee_id, check_in_list_id: row.check_in_list_id, order_id: row.order_id, checked_in_at: row.checked_in_at })).digest("hex");
}

function attendeeFromDetail(value: unknown, expectedId: string, snapshot: CheckinEventSnapshot): ArrivalAttendee {
  const detail = record(value);
  requireContract(id(detail.id) === expectedId && id(detail.event_id) === snapshot.upstreamEventId);
  requireContract(isCheckinArrivalQrIdentity(detail.public_id));
  requireContract(typeof detail.product_id === "number" || typeof detail.product_id === "string");
  const name = attendeeName(detail, [detail.public_id as string]);
  const checkIn = detail.check_in;
  if (checkIn !== undefined && checkIn !== null) {
    requireContract(record(checkIn).attendee_id !== undefined);
  }
  return { upstreamAttendeeId: expectedId, publicId: detail.public_id as string, productId: id(detail.product_id), name, alreadyCheckedIn: checkIn !== undefined && checkIn !== null };
}

function attendeeName(row: Record<string, unknown>, secrets: string[]): string {
  requireContract(typeof row.first_name === "string" && (typeof row.last_name === "string" || row.last_name === null));
  const name = label(`${row.first_name} ${row.last_name ?? ""}`, secrets);
  requireContract(name.length > 0);
  return name;
}

/** Laravel simplePaginate traversal state for one attendee query. */
interface AttendeeSearch { endpoint: string; query: string; rows: Record<string, unknown>[]; ids: Set<string>; perPage?: number }
function searchPageSize(meta: Record<string, unknown>, previous: number | undefined): number {
  requireContract(!("total" in meta) && !("last_page" in meta));
  requireContract(typeof meta.per_page === "number" && Number.isSafeInteger(meta.per_page) && meta.per_page > 0 && meta.per_page <= 25);
  requireContract(previous === undefined || previous === meta.per_page);
  return meta.per_page;
}
function searchPageLinks(search: AttendeeSearch, meta: Record<string, unknown>, links: Record<string, unknown>, current: number, perPage: number): void {
  if (meta.current_page_url !== undefined) navigation(meta.current_page_url, search.endpoint, current, perPage, search.query);
  navigation(links.first, search.endpoint, 1, perPage, search.query);
  navigation(links.last, search.endpoint, null, perPage, search.query);
  navigation(links.prev, search.endpoint, current > 1 ? current - 1 : null, perPage, search.query);
  navigation(links.next, search.endpoint, links.next === null ? null : current + 1, perPage, search.query);
}
/** Validates and collects one page; true when another page follows. */
function acceptSearchPage(search: AttendeeSearch, body: Record<string, unknown>, current: number): boolean {
  requireContract(!("errors" in body) && Array.isArray(body.data));
  const meta = record(body.meta), links = record(body.links);
  const perPage = searchPageSize(meta, search.perPage);
  search.perPage = perPage;
  const received = search.rows.length, count = body.data.length;
  requireContract(meta.current_page === current && checkinMetadataPath(meta.path, search.endpoint) && count <= perPage);
  requireContract(meta.from === (count ? received + 1 : null) && meta.to === (count ? received + count : null));
  searchPageLinks(search, meta, links, current, perPage);
  requireContract(links.next === null || count === perPage);
  for (const value of body.data) {
    const row = record(value), attendeeId = id(row.id);
    requireContract(!search.ids.has(attendeeId) && isCheckinArrivalQrIdentity(row.public_id));
    id(row.product_id);
    search.ids.add(attendeeId); search.rows.push(row);
  }
  return links.next !== null;
}
const INELIGIBLE_STATUSES = new Map<unknown, "cancelled" | "awaiting_payment">([["CANCELLED", "cancelled"], ["AWAITING_PAYMENT", "awaiting_payment"]]);
function rowCheckedIn(row: Record<string, unknown>, listId: string): boolean {
  if (!("check_in" in row)) return false;
  const checkin = record(row.check_in);
  requireContract(id(checkin.attendee_id) === id(row.id) && id(checkin.check_in_list_id) === listId && id(checkin.order_id) === id(row.order_id));
  id(checkin.id);
  requireContract(typeof checkin.checked_in_at === "string" && Number.isFinite(Date.parse(checkin.checked_in_at)));
  return true;
}
function searchResolution(rows: Record<string, unknown>[], qrIdentity: string, list: { id: string; productIds: string[] }, snapshot: CheckinEventSnapshot, secrets: string[]): ArrivalResolution {
  const matches = rows.filter((row) => row.public_id === qrIdentity);
  requireContract(matches.length <= 1);
  if (!matches.length) return { state: "rejected", reason: "not_in_list" };
  const row = matches[0]!;
  if (!list.productIds.includes(id(row.product_id))) return { state: "rejected", reason: "not_in_list" };
  if (row.status !== "ACTIVE") return { state: "rejected", reason: INELIGIBLE_STATUSES.get(row.status) ?? "unknown_eligibility" };
  if (row.event_id !== undefined) requireContract(id(row.event_id) === snapshot.upstreamEventId);
  const alreadyCheckedIn = rowCheckedIn(row, list.id);
  const name = attendeeName(row, secrets);
  return { state: "eligible", attendee: { upstreamAttendeeId: id(row.id), publicId: qrIdentity, productId: id(row.product_id), name, alreadyCheckedIn } };
}

function inProductScope(productIds: readonly string[], productId: string): boolean {
  return !productIds.length || productIds.includes(productId);
}
/** Validates the mapping against current options; true when it applies to this attendee's product. */
function affiliationApplies(options: EventOptions, mapping: CheckinAffiliationMapping, productId: string): boolean {
  id(mapping.questionId);
  requireContract(Array.isArray(mapping.productIds) && mapping.productIds.length <= 1000 && new Set(mapping.productIds.map(id)).size === mapping.productIds.length);
  const question = options.questions.find((question) => question.id === mapping.questionId);
  requireContract(question && question.belongsTo === "PRODUCT" && ["SINGLE_LINE_TEXT", "MULTI_LINE_TEXT"].includes(question.type));
  requireContract(mapping.productIds.every((id) => options.products.some((product) => product.id === id) && inProductScope(question.productIds, id)));
  return inProductScope(mapping.productIds, productId) && inProductScope(question.productIds, productId);
}
function affiliationAnswer(body: Record<string, unknown>, attendee: ArrivalAttendee, snapshot: CheckinEventSnapshot, questionId: string): Record<string, unknown> | null {
  requireContract(!("errors" in body) && !("meta" in body) && !("links" in body));
  const detail = record(body.data);
  requireContract(id(detail.id) === attendee.upstreamAttendeeId && id(detail.event_id) === snapshot.upstreamEventId && id(detail.product_id) === attendee.productId && detail.public_id === attendee.publicId);
  requireContract(Array.isArray(detail.question_answers) && detail.question_answers.length <= 1000);
  const answers = detail.question_answers.map(record).filter((answer) => id(answer.question_id) === questionId);
  requireContract(answers.length <= 1);
  if (!answers.length) return null;
  const answer = answers[0]!;
  checkAnswerIdentity(answer, attendee, snapshot);
  return answer;
}
// Additional identity fields are in pinned source. Some deployed fixtures
// only establish question_id/text_answer, so validate when supplied.
function checkAnswerIdentity(answer: Record<string, unknown>, attendee: ArrivalAttendee, snapshot: CheckinEventSnapshot): void {
  for (const [key, expected] of [["attendee_id", attendee.upstreamAttendeeId], ["event_id", snapshot.upstreamEventId], ["product_id", attendee.productId]] as const) {
    if (key in answer) requireContract(id(answer[key]) === expected);
  }
  if ("attendee_public_id" in answer) requireContract(answer.attendee_public_id === attendee.publicId);
  if ("belongs_to" in answer) requireContract(answer.belongs_to === "PRODUCT");
}

const ADMISSION_BODY_LIMIT = 2 * 1024 * 1024;
const ADMISSION_STATUSES = [200, 403, 409, 422];
function unattributedFingerprint(attendee: ArrivalAttendee, listId: string): string {
  return createHash("sha256").update(canonical({ attendee: attendee.upstreamAttendeeId, list: listId })).digest("hex");
}
async function admissionBody(response: Response): Promise<Record<string, unknown>> {
  const length = response.headers.get("content-length");
  requireContract(length === null || (/^\d+$/.test(length) && Number(length) <= ADMISSION_BODY_LIMIT));
  const reader = response.body?.getReader(); requireContract(reader);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength; requireContract(size <= ADMISSION_BODY_LIMIT); chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return record(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}
function admissionFingerprint(data: unknown, attendee: ArrivalAttendee, listId: string): string | null {
  if (!Array.isArray(data) || data.length !== 1) return null;
  try { return admissionCheckin(data[0], attendee, listId); } catch { return null; }
}
function admissionOutcome(body: Record<string, unknown>, status: number, attendee: ArrivalAttendee, listId: string): ArrivalAdmission {
  const errors = body.errors === undefined ? {} : record(body.errors);
  const hasAttendeeError = Object.hasOwn(errors, attendee.publicId);
  const fingerprint = admissionFingerprint(body.data, attendee, listId);
  if (hasAttendeeError) return { state: "existing_unattributed", fingerprint: fingerprint ?? unattributedFingerprint(attendee, listId) };
  if (status !== 200) return { state: "uncertain" };
  requireContract(Array.isArray(body.data) && body.data.length <= 1);
  if (Object.keys(errors).length > 0 || !fingerprint) return { state: "uncertain" };
  return { state: "newly_checked_in", fingerprint };
}

/** Lazy SSR configuration; injected transport/time is the approved test seam. */
export function createCheckinArrivalAdapter(input?: CheckinDiscoveryConfig, transport: typeof fetch = fetch, dependencies?: CheckinReadDependencies): CheckinArrivalSource {
  const raw = input ?? checkinServerConfig();
  const config = checkinDiscoveryConfiguration(raw);
  const sourceKey = createCheckinEventSource(raw, transport).sourceKey;
  const discovery = createCheckinDiscoveryAdapter(raw, transport, dependencies);
  const read = config ? createCheckinUpstreamReader(config, transport, dependencies) : null;
  async function ready(snapshot: CheckinEventSnapshot): Promise<EventOptions> {
    requireContract(config && snapshot.sourceKey === sourceKey);
    id(snapshot.upstreamEventId); id(snapshot.upstreamListId);
    const events = await discovery.discover();
    requireContract(events.status === "complete" && events.data.some((event) => event.id === snapshot.upstreamEventId));
    const options = await discovery.options(snapshot.upstreamEventId);
    requireContract(options.status === "complete");
    requireContract(options.data.lists.some((list) => list.id === snapshot.upstreamListId && list.isActive && !list.isExpired));
    return options.data;
  }
  return {
    sourceKey,
    async resolve(snapshot, qrIdentity): Promise<ArrivalResolution> {
      if (!isCheckinArrivalQrIdentity(qrIdentity)) return { state: "rejected", reason: "invalid_identity" };
      try {
        const options = await ready(snapshot);
        const list = options.lists.find((list) => list.id === snapshot.upstreamListId)!;
        const capability = options.serverOnly.listCapabilities[list.id]!;
        const path = `public/check-in-lists/${capability}/attendees`;
        const search: AttendeeSearch = { endpoint: `${config!.base}/${path}`, query: qrIdentity, rows: [], ids: new Set<string>() };
        for (let current = 1; current <= 40; current++) {
          const body = await read!(`${path}?page=${current}&per_page=25&query=${encodeURIComponent(qrIdentity)}`, false);
          if (acceptSearchPage(search, body, current)) { requireContract(current < 40); continue; }
          return searchResolution(search.rows, qrIdentity, list, snapshot, [capability, config!.key, qrIdentity]);
        }
        return { state: "unavailable" };
      } catch { return { state: "unavailable" }; }
    },
    async affiliation(snapshot, attendee) {
      try {
        requireContract(config && snapshot.sourceKey === sourceKey && isCheckinArrivalQrIdentity(attendee.publicId));
        id(snapshot.upstreamEventId); id(snapshot.upstreamListId); id(attendee.upstreamAttendeeId); id(attendee.productId);
        if (snapshot.affiliation === null) return { state: "missing" };
        const options = await ready(snapshot);
        const mapping = snapshot.affiliation;
        if (!affiliationApplies(options, mapping, attendee.productId)) return { state: "missing" };
        const body = await read!(`events/${snapshot.upstreamEventId}/attendees/${attendee.upstreamAttendeeId}`);
        const answer = affiliationAnswer(body, attendee, snapshot, mapping.questionId);
        if (!answer || answer.text_answer === null) return { state: "missing" };
        const text = label(answer.text_answer, [attendee.publicId, config.key, ...Object.values(options.serverOnly.listCapabilities)]);
        return text ? { state: "present", text } : { state: "missing" };
      } catch { return { state: "unavailable" }; }
    },
    async admissionAttendee(snapshot, upstreamAttendeeId) {
      try {
        id(upstreamAttendeeId);
        requireContract(config && snapshot.sourceKey === sourceKey);
        const body = await read!(`events/${snapshot.upstreamEventId}/attendees/${upstreamAttendeeId}`);
        const attendee = attendeeFromDetail(body.data, upstreamAttendeeId, snapshot);
        const resolved = await this.resolve(snapshot, attendee.publicId);
        if (resolved.state !== "eligible" || resolved.attendee.upstreamAttendeeId !== upstreamAttendeeId || resolved.attendee.productId !== attendee.productId) return null;
        attendee.alreadyCheckedIn = resolved.attendee.alreadyCheckedIn;
        return resolved.attendee;
      } catch { return null; }
    },
    async admit(snapshot, attendee): Promise<ArrivalAdmission> {
      if (!config || snapshot.sourceKey !== sourceKey || !isCheckinArrivalQrIdentity(attendee.publicId)) return { state: "uncertain" };
      if (attendee.alreadyCheckedIn) return { state: "existing_unattributed", fingerprint: unattributedFingerprint(attendee, snapshot.upstreamListId) };
      try {
        const options = await ready(snapshot);
        const list = options.lists.find((entry) => entry.id === snapshot.upstreamListId);
        requireContract(list);
        const capability = options.serverOnly.listCapabilities[list.id];
        requireContract(typeof capability === "string" && /^[A-Za-z0-9_-]{1,255}$/.test(capability));
        const response = await transport(`${config.base}/public/check-in-lists/${capability}/check-ins`, {
          method: "POST", redirect: "error", credentials: "omit", cache: "no-store",
          headers: { Authorization: `Bearer ${config.key}`, Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ attendees: [{ public_id: attendee.publicId, action: "check-in" }] }),
          signal: AbortSignal.timeout(10000),
        });
        if (!ADMISSION_STATUSES.includes(response.status)) { void response.body?.cancel(); return { state: "uncertain" }; }
        return admissionOutcome(await admissionBody(response), response.status, attendee, snapshot.upstreamListId);
      } catch { return { state: "uncertain" }; }
    },
  };
}
export function createCheckinArrivalSource(): CheckinArrivalSource { return createCheckinArrivalAdapter(); }
