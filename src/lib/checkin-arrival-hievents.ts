/** Server-only, read-only arrival adapter; never import the generic hievents.ts.
 * Evidence: research/wayfinder/hievents-checkin-fixtures.md and pinned source
 * cfbf468bb5b1b4ed3cba18184edc2e1094318f17. List attendees use simplePaginate,
 * NOT the LengthAwarePaginator used for event discovery. No deployed version
 * claim or production readiness follows from this conservative source contract.
 */
import { createCheckinEventSource } from "~/lib/checkin-event-source";
import { checkinDiscoveryConfiguration, checkinServerConfig, createCheckinDiscoveryAdapter, type CheckinDiscoveryConfig, type EventOptions } from "~/lib/checkin-hievents";
import { createCheckinUpstreamReader, type CheckinReadDependencies } from "~/lib/checkin-upstream-read";
import { isCheckinArrivalQrIdentity, type CheckinArrivalSource, type ArrivalResolution } from "~/lib/checkin-arrival-source";
import type { CheckinEventSnapshot } from "~/lib/checkin-event-contract";
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
  const expected = new URL(endpoint);
  requireContract(url.origin === expected.origin && url.pathname === expected.pathname && !url.hash && !url.username && !url.password);
  requireContract(url.searchParams.getAll("page").length === 1 && url.searchParams.get("page") === String(page));
  for (const [key, value] of url.searchParams) {
    requireContract(key === "page" || (key === "per_page" && (value === "25" || value === String(perPage))) || (key === "query" && value === query));
  }
  requireContract(url.searchParams.getAll("per_page").length <= 1 && url.searchParams.getAll("query").length <= 1);
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
        const endpoint = `${config!.base}/${path}`;
        const rows: Record<string, unknown>[] = [];
        const ids = new Set<string>();
        let perPage: number | undefined;
        for (let current = 1; current <= 40; current++) {
          const body = await read!(`${path}?page=${current}&per_page=25&query=${encodeURIComponent(qrIdentity)}`, false);
          requireContract(!("errors" in body) && Array.isArray(body.data));
          const meta = record(body.meta), links = record(body.links);
          requireContract(!("total" in meta) && !("last_page" in meta));
          requireContract(typeof meta.per_page === "number" && Number.isSafeInteger(meta.per_page) && meta.per_page > 0 && meta.per_page <= 25);
          requireContract(perPage === undefined || perPage === meta.per_page);
          perPage = meta.per_page;
          requireContract(meta.current_page === current && meta.path === endpoint && body.data.length <= perPage);
          requireContract(meta.from === (body.data.length ? rows.length + 1 : null) && meta.to === (body.data.length ? rows.length + body.data.length : null));
          navigation(links.first, endpoint, 1, perPage, qrIdentity);
          navigation(links.last, endpoint, null, perPage, qrIdentity);
          navigation(links.prev, endpoint, current > 1 ? current - 1 : null, perPage, qrIdentity);
          navigation(links.next, endpoint, links.next === null ? null : current + 1, perPage, qrIdentity);
          requireContract(links.next === null || body.data.length === perPage);
          for (const value of body.data) {
            const row = record(value), attendeeId = id(row.id);
            requireContract(!ids.has(attendeeId) && isCheckinArrivalQrIdentity(row.public_id));
            id(row.product_id);
            ids.add(attendeeId); rows.push(row);
          }
          if (links.next !== null) { requireContract(current < 40); continue; }
          const matches = rows.filter((row) => row.public_id === qrIdentity);
          requireContract(matches.length <= 1);
          if (!matches.length) return { state: "rejected", reason: "not_in_list" };
          const row = matches[0]!;
          if (!list.productIds.includes(id(row.product_id))) return { state: "rejected", reason: "not_in_list" };
          if (row.status === "CANCELLED") return { state: "rejected", reason: "cancelled" };
          if (row.status === "AWAITING_PAYMENT") return { state: "rejected", reason: "awaiting_payment" };
          if (row.status !== "ACTIVE") return { state: "rejected", reason: "unknown_eligibility" };
          if (row.event_id !== undefined) requireContract(id(row.event_id) === snapshot.upstreamEventId);
          let alreadyCheckedIn = false;
          if ("check_in" in row) {
            const checkin = record(row.check_in);
            requireContract(id(checkin.attendee_id) === id(row.id) && id(checkin.check_in_list_id) === list.id && id(checkin.order_id) === id(row.order_id));
            id(checkin.id);
            requireContract(typeof checkin.checked_in_at === "string" && Number.isFinite(Date.parse(checkin.checked_in_at)));
            alreadyCheckedIn = true;
          }
          requireContract(typeof row.first_name === "string" && (typeof row.last_name === "string" || row.last_name === null));
          const name = label(`${row.first_name} ${row.last_name ?? ""}`, [capability, config!.key, qrIdentity]);
          requireContract(name.length > 0);
          return { state: "eligible", attendee: { upstreamAttendeeId: id(row.id), publicId: qrIdentity, productId: id(row.product_id), name, alreadyCheckedIn } };
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
        id(mapping.questionId);
        requireContract(Array.isArray(mapping.productIds) && mapping.productIds.length <= 1000 && new Set(mapping.productIds.map(id)).size === mapping.productIds.length);
        const question = options.questions.find((question) => question.id === mapping.questionId);
        requireContract(question && question.belongsTo === "PRODUCT" && ["SINGLE_LINE_TEXT", "MULTI_LINE_TEXT"].includes(question.type));
        requireContract(mapping.productIds.every((id) => options.products.some((product) => product.id === id) && (!question.productIds.length || question.productIds.includes(id))));
        if ((mapping.productIds.length && !mapping.productIds.includes(attendee.productId)) || (question.productIds.length && !question.productIds.includes(attendee.productId))) return { state: "missing" };
        const body = await read!(`events/${snapshot.upstreamEventId}/attendees/${attendee.upstreamAttendeeId}`);
        requireContract(!("errors" in body) && !("meta" in body) && !("links" in body));
        const detail = record(body.data);
        requireContract(id(detail.id) === attendee.upstreamAttendeeId && id(detail.event_id) === snapshot.upstreamEventId && id(detail.product_id) === attendee.productId && detail.public_id === attendee.publicId);
        requireContract(Array.isArray(detail.question_answers) && detail.question_answers.length <= 1000);
        const answers = detail.question_answers.map(record).filter((answer) => id(answer.question_id) === mapping.questionId);
        requireContract(answers.length <= 1);
        if (!answers.length) return { state: "missing" };
        const answer = answers[0]!;
        // Additional identity fields are in pinned source. Some deployed fixtures
        // only establish question_id/text_answer, so validate when supplied.
        for (const [key, expected] of [["attendee_id", attendee.upstreamAttendeeId], ["event_id", snapshot.upstreamEventId], ["product_id", attendee.productId]] as const) {
          if (key in answer) requireContract(id(answer[key]) === expected);
        }
        if ("attendee_public_id" in answer) requireContract(answer.attendee_public_id === attendee.publicId);
        if ("belongs_to" in answer) requireContract(answer.belongs_to === "PRODUCT");
        if (answer.text_answer === null) return { state: "missing" };
        const text = label(answer.text_answer, [attendee.publicId, config.key, ...Object.values(options.serverOnly.listCapabilities)]);
        return text ? { state: "present", text } : { state: "missing" };
      } catch { return { state: "unavailable" }; }
    },
  };
}
export function createCheckinArrivalSource(): CheckinArrivalSource { return createCheckinArrivalAdapter(); }
