import { describe, expect, it } from "vite-plus/test";
import { createCheckinArrivalAdapter, isCheckinArrivalQrIdentity } from "~/lib/checkin-arrival-hievents";
import { createCheckinEventSource } from "~/lib/checkin-event-source";
import type { CheckinEventSnapshot } from "~/lib/checkin-event-contract";
import { checkinArrivalQrIdentitySchema } from "~/lib/checkin-arrival-validation";

// Synthetic fixtures derived from pinned source; not deployed response captures.
const base = "https://arrival.example.invalid/api";
const token = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from('{"account_id":77}').toString("base64url")}.c3ludGhldGlj`;
const config = { apiUrl: base, apiKey: token, accountId: "77" };
const publicId = "A-ABC1234";
const product = { id: 601, event_id: 501, title: "Admission" };
const list = { id: 701, name: "Admission", short_id: "cil_SYNTHETIC1234", is_active: true, is_expired: false, products: [product] };
const question = { id: 801, event_id: 501, title: "Affiliation", type: "SINGLE_LINE_TEXT", belongs_to: "PRODUCT", product_ids: [601] };
const row = { id: 901, public_id: publicId, product_id: 601, order_id: 1001, status: "ACTIVE", first_name: "  Ана ", last_name: "O’Neill  ", email: "private@example.invalid", notes: "private diagnostic" };
function page(path: string, data: unknown[]) {
  return { data, links: { first: `${base}/${path}?page=1`, last: `${base}/${path}?page=1`, prev: null, next: null }, meta: { current_page: 1, last_page: 1, per_page: 25, total: data.length, from: data.length ? 1 : null, to: data.length || null, path: `${base}/${path}` } };
}
const attendeePath = `public/check-in-lists/${list.short_id}/attendees`;
// Laravel simplePaginate has NO total/last_page; last link is null.
function attendees(data: unknown[], current = 1, next = false, perPage = 25) {
  return { data, links: { first: `${base}/${attendeePath}?page=1`, last: null, prev: current > 1 ? `${base}/${attendeePath}?page=${current - 1}` : null, next: next ? `${base}/${attendeePath}?page=${current + 1}` : null }, meta: { current_page: current, per_page: perPage, from: data.length ? (current - 1) * perPage + 1 : null, to: data.length ? (current - 1) * perPage + data.length : null, path: `${base}/${attendeePath}` } };
}
function transport(...bodies: unknown[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: input instanceof Request ? input.url : input.toString(), init });
    const body = bodies.shift();
    if (body instanceof Error) throw body;
    if (body === undefined) throw new Error("Unexpected fixture request");
    return body instanceof Response ? body : Response.json(body);
  };
  return { calls, fetcher };
}
function ready() { return [page("events", [{ id: 501, title: "Configured event" }]), page("events/501/check-in-lists", [list]), { data: [question] }, page("events/501/products", [product])]; }
function snapshot(sourceKey: string): CheckinEventSnapshot {
  return { sourceKey, upstreamEventId: "501", upstreamListId: "701", affiliation: { questionId: "801", productIds: ["601"] }, actor: { userId: "actor0000000001", role: "admin" }, context: { protocolVersion: 1, edition: "WTS2026", eventId: "event0000000001", eventGeneration: 1, bindingId: "binding00000001", bindingVersion: 1, selectionVersion: 1, stationId: "wts2026station1", stationGeneration: 1, systemGeneration: 1 } };
}

const identity = { upstreamAttendeeId: "901", publicId, productId: "601", name: "Ана O’Neill", alreadyCheckedIn: false };
const checkIn = { id: 1101, attendee_id: 901, check_in_list_id: 701, order_id: 1001, checked_in_at: "2026-09-09T10:00:00Z", short_id: "chk_SYNTHETIC1234" };
function detail(question_answers: unknown = []) { return { data: { ...row, event_id: 501, question_answers } }; }
function adapterFor(...bodies: unknown[]) {
  const upstream = transport(...bodies);
  let time = 0;
  const adapter = createCheckinArrivalAdapter(config, upstream.fetcher, { now: () => time, random: () => 0, sleep: async (ms) => { time += ms; } });
  return { ...upstream, adapter, selected: snapshot(adapter.sourceKey) };
}

describe("read-only arrival Hi.Events adapter", () => {
  it.each(["A-AbC1234", "A-abc1234"])("rejects mixed/lowercase %s at the shared service identity boundary", (identity) => {
    expect(checkinArrivalQrIdentitySchema.safeParse(identity).success).toBe(false);
    expect(isCheckinArrivalQrIdentity(identity)).toBe(false);
  });
  it.each(["", "a-ABC1234", "A-abc1234", "A-ABC123", "A-ABC12345", "B-ABC1234", " A-ABC1234", "A-ABC1234\n", "https://tickets.invalid/A-ABC1234", "A-ABC123!"])("rejects non-verbatim QR %j without any request", async (qr) => {
    const { adapter, selected, calls } = adapterFor();
    expect(await adapter.resolve(selected, qr)).toEqual({ state: "rejected", reason: "invalid_identity" });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["CANCELLED", "cancelled"], ["AWAITING_PAYMENT", "awaiting_payment"],
    ["REFUNDED", "unknown_eligibility"], [null, "unknown_eligibility"], ["active", "unknown_eligibility"],
  ])("classifies upstream status %j without admitting", async (status, reason) => {
    const { adapter, selected } = adapterFor(...ready(), attendees([{ ...row, status }]));
    expect(await adapter.resolve(selected, publicId)).toEqual({ state: "rejected", reason });
  });

  it.each([[], [{ ...row, public_id: "A-ABC1235" }], [{ ...row, product_id: 602 }]].map((rows) => ({ rows })))("rejects absent exact identity or out-of-list product %#", async ({ rows }) => {
    const { adapter, selected } = adapterFor(...ready(), attendees(rows));
    expect(await adapter.resolve(selected, publicId)).toEqual({ state: "rejected", reason: "not_in_list" });
  });

  it.each(["unknown list", "inactive list", "expired list", "unknown event", "foreign source", "foreign product event"])("fails closed on %s before attendee lookup", async (kind) => {
    const bodies = ready();
    if (kind === "inactive list" || kind === "expired list") bodies[1] = page("events/501/check-in-lists", [{ ...list, is_active: kind !== "inactive list", is_expired: kind === "expired list" }]);
    if (kind === "foreign product event") bodies[3] = page("events/501/products", [{ ...product, event_id: 502 }]);
    const { adapter, selected, calls } = adapterFor(...bodies);
    if (kind === "unknown list") selected.upstreamListId = "702";
    if (kind === "unknown event") selected.upstreamEventId = "502";
    if (kind === "foreign source") selected.sourceKey = "other-source";
    expect(await adapter.resolve(selected, publicId)).toEqual({ state: "unavailable" });
    expect(calls.every((call) => !call.url.includes("/attendees"))).toBe(true);
  });

  it("traverses all simplePaginate pages before accepting an exact match", async () => {
    const { adapter, selected, calls } = adapterFor(...ready(), attendees([{ ...row, id: 902, public_id: "A-ABC1235" }], 1, true, 1), attendees([row], 2, false, 1));
    expect(await adapter.resolve(selected, publicId)).toEqual({ state: "eligible", attendee: identity });
    expect(calls.at(-1)?.url).toBe(`${base}/${attendeePath}?page=2&per_page=25&query=${publicId}`);
  });

  it.each(["duplicate numeric identity", "ambiguous public identity", "later failure"])("does not accept an early exact match with %s", async (kind) => {
    const second = kind === "later failure" ? new Error("private upstream failure") : attendees([{ ...row, id: kind === "duplicate numeric identity" ? 901 : 902 }], 2, false, 1);
    const { adapter, selected, calls } = adapterFor(...ready(), attendees([row], 1, true, 1), second);
    expect(await adapter.resolve(selected, publicId)).toEqual({ state: "unavailable" });
    expect(calls).toHaveLength(6);
  });

  it.each([
    ["partial page", () => attendees([row], 1, true)],
    ["length-aware envelope", () => page(attendeePath, [row])],
    ["missing metadata", () => ({ data: [row] })],
    ["invalid row", () => attendees([row, null])],
    ["invalid public identity", () => attendees([{ ...row, public_id: "a-ABC1234" }])],
    ["cross-origin next", () => { const body = attendees([row], 1, true, 1); body.links.next = "https://hostile.invalid/steal?page=2"; return body; }],
    ["changed next query", () => { const body = attendees([row], 1, true, 1); body.links.next += "&query=A-ABC1235"; return body; }],
    ["wrong page", () => attendees([row], 2)],
    ["wrong event", () => attendees([{ ...row, event_id: 502 }])],
  ] as const)("fails closed on %s", async (_name, body) => {
    const { adapter, selected, calls } = adapterFor(...ready(), body());
    expect(await adapter.resolve(selected, publicId)).toEqual({ state: "unavailable" });
    expect(calls).toHaveLength(5);
    expect(calls.every((call) => new URL(call.url).origin === new URL(base).origin)).toBe(true);
  });

  it("projects a valid preexisting list check-in without authorizing another", async () => {
    const { adapter, selected } = adapterFor(...ready(), attendees([{ ...row, check_in: checkIn }]));
    expect(await adapter.resolve(selected, publicId)).toEqual({ state: "eligible", attendee: { ...identity, alreadyCheckedIn: true } });
  });
  it.each([null, {}, { ...checkIn, attendee_id: 902 }, { ...checkIn, check_in_list_id: 702 }, { ...checkIn, order_id: 1002 }, { ...checkIn, id: 0 }, { ...checkIn, checked_in_at: "invalid" }])("does not treat malformed check_in %# as unchecked", async (check_in) => {
    const { adapter, selected } = adapterFor(...ready(), attendees([{ ...row, check_in }]));
    expect(await adapter.resolve(selected, publicId)).toEqual({ state: "unavailable" });
  });

  it("returns missing without transport when no affiliation mapping exists", async () => {
    const { adapter, selected, calls } = adapterFor();
    selected.affiliation = null;
    expect(await adapter.affiliation(selected, identity)).toEqual({ state: "missing" });
    expect(calls).toHaveLength(0);
  });
  it("returns missing without detail lookup for an out-of-scope affiliation product", async () => {
    const { adapter, selected, calls } = adapterFor(...ready());
    expect(await adapter.affiliation(selected, { ...identity, productId: "602" })).toEqual({ state: "missing" });
    expect(calls).toHaveLength(4);
  });
  it.each([[], [{ question_id: 802, text_answer: "Other question" }], [{ question_id: 801, text_answer: null }], [{ question_id: 801, text_answer: "" }], [{ question_id: 801, text_answer: " \n\t " }]].map((answers) => ({ answers })))("reserves missing for established absent/empty answers %#", async ({ answers }) => {
    const { adapter, selected } = adapterFor(...ready(), detail(answers));
    expect(await adapter.affiliation(selected, identity)).toEqual({ state: "missing" });
  });
  it.each([
    ["missing data", () => ({})], ["null data", () => ({ data: null })],
    ["missing answers", () => ({ data: { ...row, event_id: 501 } })],
    ["non-array answers", () => detail({})], ["null answers", () => detail(null)],
    ["missing answer text", () => detail([{ question_id: 801 }])],
    ["non-text answer", () => detail([{ question_id: 801, text_answer: 123 }])],
    ["duplicate question", () => detail([{ question_id: 801, text_answer: "One" }, { question_id: 801, text_answer: "Two" }])],
    ["wrong attendee", () => ({ data: { ...detail().data, id: 902 } })],
    ["wrong event", () => ({ data: { ...detail().data, event_id: 502 } })],
    ["wrong product", () => ({ data: { ...detail().data, product_id: 602 } })],
    ["wrong public identity", () => ({ data: { ...detail().data, public_id: "A-ABC1235" } })],
    ["malformed JSON", () => new Response("{", { headers: { "Content-Type": "application/json" } })],
  ] as const)("distinguishes unavailable affiliation from missing: %s", async (_name, body) => {
    const { adapter, selected } = adapterFor(...ready(), body());
    expect(await adapter.affiliation(selected, identity)).toEqual({ state: "unavailable" });
  });
  it.each(["network", "503"])("keeps exhausted %s affiliation reads unavailable", async (kind) => {
    const failures = Array.from({ length: 3 }, () => kind === "network" ? new TypeError("private transport diagnostic") : new Response("private upstream diagnostic", { status: 503 }));
    const { adapter, selected, calls } = adapterFor(...ready(), ...failures);
    expect(await adapter.affiliation(selected, identity)).toEqual({ state: "unavailable" });
    expect(calls).toHaveLength(7);
  });
  it.each([
    { attendee_id: 902 }, { event_id: 502 }, { product_id: 602 }, { attendee_public_id: "A-ABC1235" }, { belongs_to: "ORDER" },
  ])("rejects mismatched affiliation answer identity %#", async (fields) => {
    const { adapter, selected } = adapterFor(...ready(), detail([{ question_id: 801, text_answer: "WTS Labs", ...fields }]));
    expect(await adapter.affiliation(selected, identity)).toEqual({ state: "unavailable" });
  });
  it.each(["private@example.invalid", publicId, list.short_id, token, "Bearer credential", "https://private.invalid", "<script>"])("never projects private or unsafe label text %#", async (unsafe) => {
    const nameRead = adapterFor(...ready(), attendees([{ ...row, first_name: unsafe }]));
    expect(await nameRead.adapter.resolve(nameRead.selected, publicId)).toEqual({ state: "unavailable" });
    const affiliationRead = adapterFor(...ready(), detail([{ question_id: 801, text_answer: unsafe }]));
    expect(await affiliationRead.adapter.affiliation(affiliationRead.selected, identity)).toEqual({ state: "unavailable" });
  });
  it("reads the immutable affiliation question from authenticated same-identity detail, not fuzzy labels or email", async () => {
    const upstream = transport(...ready(), { data: { ...row, event_id: 501, question_answers: [{ question_id: 802, text_answer: "Wrong answer" }, { question_id: 801, text_answer: "  WTS\n  Labs " }] } });
    const adapter = createCheckinArrivalAdapter(config, upstream.fetcher);
    expect(await adapter.affiliation(snapshot(adapter.sourceKey), { upstreamAttendeeId: "901", publicId, productId: "601", name: "Ана O’Neill", alreadyCheckedIn: false })).toEqual({ state: "present", text: "WTS Labs" });
    expect(upstream.calls.at(-1)?.url).toBe(`${base}/events/501/attendees/901`);
    expect(upstream.calls.at(-1)?.init?.headers).toMatchObject({ Authorization: `Bearer ${token}` });
  });

  it("resolves exact QR identity in the selected list to stable numeric identity and safe label fields only", async () => {
    const upstream = transport(...ready(), attendees([{ ...row, id: 902, public_id: "A-ABC1235" }, row]));
    const adapter = createCheckinArrivalAdapter(config, upstream.fetcher);
    expect(adapter.sourceKey).toBe(createCheckinEventSource(config, upstream.fetcher).sourceKey);
    expect(isCheckinArrivalQrIdentity(publicId)).toBe(true);
    expect(await adapter.resolve(snapshot(adapter.sourceKey), publicId)).toEqual({ state: "eligible", attendee: { upstreamAttendeeId: "901", publicId, productId: "601", name: "Ана O’Neill", alreadyCheckedIn: false } });
    expect(upstream.calls.at(-1)?.url).toBe(`${base}/${attendeePath}?page=1&per_page=25&query=${publicId}`);
    for (const call of upstream.calls) { expect(call.init?.method).toBe("GET"); expect(call.init?.body).toBeUndefined(); }
    expect(upstream.calls.at(-1)?.init?.headers).not.toHaveProperty("Authorization");
  });
  it("prepares the exact attendee and list capability before the coordinator send fence", async () => {
    const upstream = transport(detail(), ...ready(), attendees([row]));
    const adapter = createCheckinArrivalAdapter(config, upstream.fetcher);
    const attendee = await adapter.admissionAttendee!(snapshot(adapter.sourceKey), "901");
    expect(attendee).toMatchObject({ upstreamAttendeeId: "901", publicId, productId: "601", alreadyCheckedIn: false });
    expect(upstream.calls.map((call) => call.init?.method)).toEqual(["GET", "GET", "GET", "GET", "GET", "GET"]);
  });
  it("classifies a validated new upstream check-in and does not retry its POST", async () => {
    const upstream = transport(...ready(), Response.json({ data: [checkIn], errors: {} }));
    const adapter = createCheckinArrivalAdapter(config, upstream.fetcher);
    expect(await adapter.admit!(snapshot(adapter.sourceKey), identity)).toMatchObject({ state: "newly_checked_in", fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(upstream.calls.at(-1)?.init?.method).toBe("POST");
    expect(upstream.calls.filter((call) => call.init?.method === "POST")).toHaveLength(1);
  });
});
