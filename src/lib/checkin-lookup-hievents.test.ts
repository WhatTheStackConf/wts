import { expect, it } from "vite-plus/test";
import { createCheckinLookupAdapter } from "~/lib/checkin-lookup-hievents";
import type { CheckinEventSnapshot } from "~/lib/checkin-event-contract";

// Synthetic source-pinned responses, never deployed proof.
// Observed paginator shape only; synthetic hosts and identities throughout.
function stripped(body: unknown) {
  const copy = JSON.parse(JSON.stringify(body).replaceAll(`${base}/`, `${base.slice(0, -4)}/`));
  copy.meta.current_page_url = `${copy.meta.path}?page=${copy.meta.current_page}`;
  return copy;
}
function corrupt(body: ReturnType<typeof stripped>, field: string, kind: string) {
  const owner = field === "path" || field === "current_page_url" ? body.meta : body.links;
  if (kind === "origin") owner[field] = owner[field].replace(new URL(base).host, "foreign.example.invalid");
  if (kind === "capability") owner[field] = owner[field].replace(/cil_[^/]+|events\/[0-9]+/, "other-list");
  if (kind === "query") owner[field] += `${field === "path" ? "?" : "&"}extra=1`;
  if (kind === "changed query") owner[field] += `${field === "path" ? "?" : "&"}query=A-ABC1235`;
  if (kind === "duplicate query") owner[field] += `${field === "path" ? "?" : "&"}query=A-ABC1234&query=A-ABC1234`;
  if (kind === "wrong mount") owner[field] = owner[field].replace(new URL(base).origin, `${new URL(base).origin}/api/api`);
  if (kind === "duplicate") owner[field] += `${field === "path" ? "?" : "&"}per_page=1&per_page=1`;
  if (kind === "credentials") owner[field] = owner[field].replace("https://", "https://user:pass@");
  if (kind === "fragment") owner[field] += "#fragment";
  if (kind === "count") body.meta.to = 2;
}
const base = "https://lookup.example.invalid/api";
const apiKey = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from('{"account_id":77}').toString("base64url")}.c3ludGhldGlj`;
const config = { apiUrl: base, apiKey, accountId: "77" };
const product = { id: 401, event_id: 101, title: "Admission" };
const list = { id: 201, name: "Selected list", short_id: "cil_SYNTHETIC", is_active: true, is_expired: false, products: [product] };
const attendeePath = "public/check-in-lists/cil_SYNTHETIC/attendees";
const row = { id: 501, event_id: 101, product_id: 401, public_id: "A-ABC1234", first_name: "Ана", last_name: "Test", email: "ana@example.test", status: "ACTIVE", order_id: 601 };
function page(path: string, data: unknown[], current = 1, total = data.length, perPage = 25, simple = false) {
  const last = Math.max(1, Math.ceil(total / perPage));
  return { data, links: { first: `${base}/${path}?page=1`, last: simple ? null : `${base}/${path}?page=${last}`, prev: current > 1 ? `${base}/${path}?page=${current - 1}` : null, next: current < last ? `${base}/${path}?page=${current + 1}` : null }, meta: { path: `${base}/${path}`, current_page: current, per_page: perPage, ...(simple ? {} : { total, last_page: last }), from: data.length ? (current - 1) * perPage + 1 : null, to: data.length ? (current - 1) * perPage + data.length : null } };
}
function setup(...bodies: unknown[]) {
  const calls: string[] = [];
  let time = 0;
  const transport: typeof fetch = async (url, init) => { calls.push(String(url)); expect(init?.method).toBe("GET"); expect(init?.body).toBeUndefined(); if (String(url).includes("/public/")) expect(init?.headers).not.toHaveProperty("Authorization"); else expect(init?.headers).toMatchObject({ Authorization: `Bearer ${apiKey}` }); const body = bodies.shift(); if (body instanceof Error) throw body; if (!body) throw new Error("Unexpected request"); return body instanceof Response ? body : Response.json(body); };
  const adapter = createCheckinLookupAdapter(config, transport, { now: () => time, random: () => 0, sleep: async (ms) => { time += ms; } });
  const snapshot: CheckinEventSnapshot = { sourceKey: adapter.sourceKey, upstreamEventId: "101", upstreamListId: "201", affiliation: null, actor: { userId: "actor0000000001", role: "admin" }, context: { protocolVersion: 1, edition: "WTS2026", eventId: "event0000000001", eventGeneration: 1, bindingId: "binding00000001", bindingVersion: 1, selectionVersion: 1, stationId: "wts2026station1", stationGeneration: 1, systemGeneration: 1 } };
  return { adapter, snapshot, calls };
}
const options = () => [page("events/101/check-in-lists", [list]), { data: [] }, page("events/101/products", [product])];
it("accepts observed single-page membership without event_id or check_in", async () => {
  const member = { id: row.id, email: row.email, first_name: row.first_name, last_name: row.last_name, public_id: row.public_id, product_id: row.product_id, product_price_id: 1401, status: "ACTIVE", locale: "en", order_id: row.order_id };
  const t = setup(...options(), stripped(page(attendeePath, [member], 1, 1, 25, true)), { data: row });
  expect(await t.adapter.identity(t.snapshot, "501")).toMatchObject({ state: "complete", attendees: [{ attendeeId: "501" }] });
});
it("rejects duplicate IDs and public identities across stripped pages", async () => {
  for (const duplicate of [{ ...row, public_id: "A-ABC1235" }, { ...row, id: 502 }]) {
    const t = setup(...options(), stripped(page(attendeePath, [row], 1, 2, 1, true)), stripped(page(attendeePath, [duplicate], 2, 2, 1, true)));
    expect(await t.adapter.search(t.snapshot, row.email)).toEqual({ state: "partial" });
    expect(t.calls).toHaveLength(5);
  }
});
it("accepts stripped public and authenticated multi-page metadata without following URLs", async () => {
  const other = { ...row, id: 502, public_id: "A-ABC1235", email: "other@example.test" };
  const t = setup(...options(), ...[page(attendeePath, [row], 1, 2, 1, true), page(attendeePath, [other], 2, 2, 1, true), page("events/101/attendees", [other], 1, 2, 1), page("events/101/attendees", [row], 2, 2, 1)].map(stripped));
  const result = await t.adapter.search(t.snapshot, row.email);
  expect(result).toMatchObject({ state: "complete", attendees: [{ attendeeId: "501" }] });
  expect(JSON.stringify(result)).not.toContain(list.short_id);
  expect(t.calls.slice(3)).toEqual([`${base}/${attendeePath}?page=1&per_page=25`, `${base}/${attendeePath}?page=2&per_page=25`, `${base}/events/101/attendees?page=1&per_page=25`, `${base}/events/101/attendees?page=2&per_page=25`]);
});
it.each(["origin", "capability", "query", "changed query", "duplicate query", "duplicate", "credentials", "fragment", "count", "wrong mount"])("rejects stripped %s in both paginator kinds", async kind => {
  for (const simple of [true, false]) for (const field of ["path", "current_page_url", "first", "next"]) {
    const body = stripped(page(simple ? attendeePath : "events/101/attendees", [row], 1, 2, 1, simple));
    corrupt(body, field, kind);
    const t = setup(...options(), ...(simple ? [] : [stripped(page(attendeePath, [row], 1, 1, 25, true))]), body);
    expect(await t.adapter.search(t.snapshot, "Ана")).toEqual({ state: simple ? "unavailable" : "partial" });
    expect(t.calls).toHaveLength(simple ? 4 : 5);
    expect(t.calls.every(url => url.startsWith(`${base}/`) && !url.includes("query="))).toBe(true);
  }
});
it("searches email privately after complete list membership and authenticated event pagination", async () => {
  const other = { ...row, id: 502, public_id: "A-ABC1235", email: "other@example.test" };
  const t = setup(...options(), page(attendeePath, [row], 1, 2, 1, true), page(attendeePath, [other], 2, 2, 1, true), page("events/101/attendees", [other], 1, 2, 1), page("events/101/attendees", [row], 2, 2, 1));
  expect(await t.adapter.search(t.snapshot, "ANA@EXAMPLE.TEST")).toEqual({ state: "complete", attendees: [{ attendeeId: "501", publicId: "A-ABC1234", name: "Ана Test", email: "ana@example.test" }] });
  expect(t.calls).toHaveLength(7);
  expect(t.calls.every((url) => !/query=|email|ana|%40|@/i.test(url))).toBe(true);
});

it("keeps ambiguous Unicode name matches distinct and omits event attendees outside the list", async () => {
  const other = { ...row, id: 502, public_id: "A-ABC1235", email: "second@example.test" };
  const foreign = { ...row, id: 503, public_id: "A-ABC1236", email: "foreign@example.test" };
  const t = setup(...options(), page(attendeePath, [row, other], 1, 2, 25, true), page("events/101/attendees", [foreign, other, row]));
  expect(await t.adapter.search(t.snapshot, "АНА")).toEqual({ state: "complete", attendees: [
    { attendeeId: "501", publicId: row.public_id, name: "Ана Test", email: row.email },
    { attendeeId: "502", publicId: other.public_id, name: "Ана Test", email: other.email },
  ] });
});

it("distinguishes an empty complete result from failed or incomplete pagination", async () => {
  const empty = setup(...options(), page(attendeePath, [], 1, 0, 25, true), page("events/101/attendees", []));
  expect(await empty.adapter.search(empty.snapshot, "Nobody")).toEqual({ state: "complete", attendees: [] });
  const failed = setup(new Response(null, { status: 401 }));
  expect(await failed.adapter.search(failed.snapshot, "Nobody")).toEqual({ state: "unavailable" });
  const partial = setup(...options(), page(attendeePath, [row], 1, 2, 1, true), new Response(null, { status: 401 }));
  expect(await partial.adapter.search(partial.snapshot, "Ана")).toEqual({ state: "partial" });
  const missing = setup(...options(), page(attendeePath, [row], 1, 1, 25, true), page("events/101/attendees", []));
  expect(await missing.adapter.search(missing.snapshot, "Nobody")).toEqual({ state: "partial" });
});

it("rejects cross-event identities, mismatched public identities and untrusted pagination without following links", async () => {
  for (const detail of [{ ...row, event_id: 999 }, { ...row, public_id: "A-ZZZ1234" }, { ...row, product_id: 999 }]) {
    const t = setup(...options(), page(attendeePath, [row], 1, 1, 25, true), page("events/101/attendees", [detail]));
    expect(await t.adapter.search(t.snapshot, "Ана")).toEqual({ state: "partial" });
  }
  const bad = page(attendeePath, [row], 1, 2, 1, true); bad.links.next = "https://attacker.example/steal?page=2";
  const t = setup(...options(), bad);
  expect(await t.adapter.search(t.snapshot, "Ана")).toEqual({ state: "unavailable" });
  expect(t.calls.every(url => url.startsWith(base))).toBe(true);
});

it("verifies selected IDs against actual list membership before a detail read", async () => {
  const t = setup(...options(), page(attendeePath, [row], 1, 1, 25, true));
  expect(await t.adapter.identity(t.snapshot, "999")).toEqual({ state: "complete", attendees: [] });
  expect(t.calls).toHaveLength(4);
  const exact = setup(...options(), page(attendeePath, [row], 1, 1, 25, true), { data: row });
  expect(await exact.adapter.identity(exact.snapshot, "501")).toMatchObject({ state: "complete", attendees: [{ attendeeId: "501", publicId: row.public_id }] });
});

it("stops at the 40-page source cap instead of returning a misleading partial match", async () => {
  const pages = Array.from({ length: 40 }, (_, n) => page(attendeePath, [{ ...row, id: n + 1, public_id: `A-${String(n).padStart(7, "0")}` }], n + 1, 41, 1, true));
  const t = setup(...options(), ...pages);
  expect(await t.adapter.search(t.snapshot, "Ана")).toEqual({ state: "partial" });
  expect(t.calls).toHaveLength(43);
});
