import { describe, expect, it, vi } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { handleRegistrations } from "./registrations-http";
import { readRegistrations } from "./registrations-source";
import { registrationProgrammes } from "./registrations-contract";
import { conferenceWeekTracks } from "./conference-week";
import { isCheckinPath } from "./checkin-privacy";
import { paginated } from "~/lib/checkin-hievents";
const request = () => new Request("https://wts.test/api/registrations", { method: "POST", headers: { origin: "https://wts.test" } });
const requestedUrl = (input: RequestInfo | URL) => new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
const empty = { refreshedAt: "2026-09-12T10:00:00.000Z", registrations: [] };
const operator = { id: "synthetic-operator", role: "checkin_operator" };
// Entirely synthetic IDs, token and attendee identities. Never production data.
const token = `e30.${Buffer.from(JSON.stringify({ account_id: 999 })).toString("base64url")}.fake`;
const config = { apiUrl: "https://upstream.test/api", apiKey: token, accountId: "999" };
function page(current: number, product = 15) {
 const endpoint = "https://upstream.test/events/5/attendees";
 const link = (n: number) => `${endpoint}?page=${n}`;
 return { data: [{ id: 90000 + current, event_id: 5, product_id: product, first_name: "Synthetic", last_name: "Person", email: "fixture@example.invalid", status: "ACTIVE", short_id: "never-expose", check_ins: [{ short_id: "never-expose" }] }], meta: { current_page: current, last_page: 2, total: 2, per_page: 1, from: current, to: current, path: endpoint }, links: { first: link(1), last: link(2), prev: current === 1 ? null : link(1), next: current === 2 ? null : link(2) } };
}
function rosterPage(input: RequestInfo | URL, total: number, productAt: (index: number) => number) {
 const url = requestedUrl(input), current = Number(url.searchParams.get("page")), perPage = Number(url.searchParams.get("per_page"));
 const start = (current - 1) * perPage, end = Math.min(total, start + perPage);
 const endpoint = "https://upstream.test/events/5/attendees", last = Math.ceil(total / perPage);
 const link = (n: number) => `${endpoint}?page=${n}&per_page=${perPage}`;
 return { data: Array.from({ length: end - start }, (_, offset) => {
  const index = start + offset;
  return { id: 90001 + index, event_id: 5, product_id: productAt(index), first_name: "Synthetic", last_name: "Person", email: "fixture@example.invalid", status: "ACTIVE" };
 }), meta: { current_page: current, last_page: last, total, per_page: perPage, from: start + 1, to: end, path: endpoint }, links: { first: link(1), last: link(last), prev: current > 1 ? link(current - 1) : null, next: current < last ? link(current + 1) : null } };
}
describe("private registrations", () => {
 it("reads pre-conference registrations beyond 1000 event attendees without returning unrelated tickets", async () => {
  const total = 1010;
  const selected = new Map([[900, 15], [1004, 14], [1009, 9]]);
  const fetcher = vi.fn(async (input: RequestInfo | URL) => Response.json(rosterPage(input, total, index => selected.get(index) ?? 2)));
  const result = await readRegistrations(config, fetcher);
  expect(result.registrations.map(row => row.id)).toEqual([...selected.keys()].map(index => String(90001 + index)));
  expect(result.registrations.map(row => row.programmeId)).toEqual(["15", "14", "9"]);
  expect(fetcher).toHaveBeenCalledTimes(Math.ceil(total / 100));
  expect(fetcher.mock.calls.every(([url]) => requestedUrl(url).searchParams.get("per_page") === "100")).toBe(true);
 });
 it("keeps ordinary discovery's 1000-record bound unchanged", async () => {
  const body = page(1); body.meta.total = 1001; body.meta.last_page = 1001;
  const read = vi.fn(async () => body);
  await expect(paginated({ acceptedPages: 0, read }, "https://upstream.test/api/events/5/attendees", "events/5/attendees", value => ({ id: String((value as { id: number }).id) }))).rejects.toThrow();
  expect(read).toHaveBeenCalledWith("events/5/attendees?page=1&per_page=25");
 });
 it.each([
  { total: 10000, included: 1, accepted: true },
  { total: 10001, included: 1, accepted: false },
  { total: 1000, included: 1000, accepted: true },
  { total: 1001, included: 1001, accepted: false },
 ])("enforces independent source/output limits at $total attendees and $included included registrations", async ({ total, included, accepted }) => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => Response.json(rosterPage(input, total, index => index >= total - included ? 15 : 2)));
  const result = readRegistrations(config, fetcher);
  if (accepted) {
   expect((await result).registrations).toHaveLength(included);
   expect(fetcher).toHaveBeenCalledTimes(Math.ceil(total / 100));
  } else if (total > 10000) {
   await expect(result).rejects.toMatchObject({ reason: "limit" });
   expect(fetcher).toHaveBeenCalledTimes(1);
  } else {
   await expect(result).rejects.toMatchObject({ name: "ZodError" });
   expect(fetcher).toHaveBeenCalledTimes(Math.ceil(total / 100));
  }
 });
 it("lists free and paid WTS pre-conference programmes in weekday order", () => {
  expect(registrationProgrammes).toEqual([
   { id: "15", name: "InfoSec Monday" },
   { id: "16", name: "Workshop Tuesday: iOS + AI" },
   { id: "9", name: "DevFest" },
   { id: "14", name: "Workshop Thursday" },
   { id: "17", name: "Angular Day" },
  ]);
  expect(conferenceWeekTracks.flatMap(track => track.freeTicketProductId === undefined ? [] : [track.freeTicketProductId])).toEqual([15, 16, 17]);
 });
 it("includes both paid products across pages without exposing payment or check-in data", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(page(1, 9))).mockResolvedValueOnce(Response.json(page(2, 14)));
  const result = await readRegistrations(config, fetcher);
  expect(result.registrations.map(row => row.programmeId)).toEqual(["9", "14"]);
  expect(fetcher.mock.calls.every(call => call[1].method === "GET")).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/short_id|check_ins|never-expose/);
 });
 it.each([2, 3, 4, 13, 999])("still excludes unrelated product %s", async product => {
  const result = await readRegistrations(config, vi.fn().mockResolvedValueOnce(Response.json(page(1, product))).mockResolvedValueOnce(Response.json(page(2, 14))));
  expect(result.registrations.map(row => row.programmeId)).toEqual(["14"]);
 });
 it.each(["user", "reviewer", "mc"])("denies %s without reading upstream", async role => {
  const read = vi.fn(); const result = await handleRegistrations(request(), { authenticate: async () => ({ id: "fixture", role }), read });
  expect(result.status).toBe(403); expect(read).not.toHaveBeenCalled();
 });
 it("denies missing authentication and cross-site requests", async () => {
  const read = vi.fn(); const authenticate = vi.fn(async () => { throw new Error(); });
  expect((await handleRegistrations(request(), { authenticate, read })).status).toBe(403);
  expect((await handleRegistrations(new Request("https://wts.test/api/registrations", { method: "POST", headers: { origin: "https://foreign.test" } }), { authenticate, read })).status).toBe(403);
  expect(read).not.toHaveBeenCalled();
 });
 it.each(["admin", "checkin_operator"])("allows %s with no station and revalidates", async role => {
  const authenticate = vi.fn(async () => ({ ...operator, role }));
  const result = await handleRegistrations(request(), { authenticate, read: async () => empty });
  expect(result.status).toBe(200); expect(authenticate).toHaveBeenCalledTimes(2);
  expect(result.headers.get("cache-control")).toBe("private, no-store");
  expect(result.headers.get("content-security-policy")).toContain("connect-src 'self'");
 });
 it("redacts if authority changes during upstream read", async () => {
  const authenticate = vi.fn().mockResolvedValueOnce(operator).mockResolvedValueOnce({ ...operator, role: "user" });
  const result = await handleRegistrations(request(), { authenticate, read: async () => empty });
  expect(result.status).toBe(403); expect(await result.text()).not.toContain("registrations");
 });
 it("withholds a populated roster until post-await authority is verified", async () => {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let actor = operator;
  const authenticate = vi.fn(async () => actor);
  const pending = handleRegistrations(request(), { authenticate, read: async () => {
   await waiting;
   return { ...empty, registrations: [{ id: "90001", programmeId: "15", name: "Synthetic Private", email: "redact@example.invalid", ticketStatus: "ACTIVE" }] };
  } });
  await vi.waitFor(() => expect(authenticate).toHaveBeenCalledTimes(1));
  actor = { ...operator, id: "different-operator" };
  release();
  const result = await pending;
  expect(result.status).toBe(403);
  expect(await result.text()).not.toMatch(/Synthetic Private|redact@example.invalid|90001/);
 });
 it("rejects malformed DTOs without leaking upstream fields", async () => {
  const read = async () => ({ ...empty, secret: "never-expose" });
  const result = await handleRegistrations(request(), { authenticate: async () => operator, read });
  expect(result.status).toBe(503);
  expect(await result.text()).not.toContain("never-expose");
 });
 it("distinguishes failure from empty", async () => {
  const result = await handleRegistrations(request(), { authenticate: async () => operator, read: async () => { throw new Error("private upstream detail"); } });
  expect(result.status).toBe(503); expect(await result.text()).not.toContain("private upstream detail");
 });
 it("reads every page using GET and emits only configured product DTOs", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(page(1))).mockResolvedValueOnce(Response.json(page(2, 999)));
  const result = await readRegistrations(config, fetcher);
  expect(fetcher).toHaveBeenCalledTimes(2); expect(fetcher.mock.calls.every(c => c[1].method === "GET")).toBe(true);
  expect(fetcher.mock.calls.every(c => c[0].endsWith("&sort_by=id&sort_direction=asc"))).toBe(true);
  expect(result.registrations).toHaveLength(1); expect(JSON.stringify(result)).not.toMatch(/short_id|never-expose|check_ins|arrival/);
 });
 it("rejects duplicate identities and incomplete pagination instead of partial roster", async () => {
  const second = page(2); second.data[0].id = 90001;
  await expect(readRegistrations(config, vi.fn().mockResolvedValueOnce(Response.json(page(1))).mockResolvedValueOnce(Response.json(second)))).rejects.toThrow();
  await expect(readRegistrations(config, vi.fn().mockResolvedValueOnce(Response.json(page(1))).mockResolvedValueOnce(Response.json({}, { status: 403 })))).rejects.toThrow();
 });
 it("rejects foreign events and malformed included attendee data", async () => {
  const foreign = page(1); foreign.data[0].event_id = 6;
  const malformed = page(1); malformed.data[0].email = "x".repeat(501);
  for (const response of [foreign, malformed]) {
   await expect(readRegistrations(config, vi.fn().mockResolvedValue(Response.json(response)))).rejects.toThrow();
  }
 });
 it.each(["/registrations", "/REGISTRATIONS/", "/%72egistrations///", "/api/REGISTRATIONS/"])("protects route variant %s", path => expect(isCheckinPath(path)).toBe(true));
 it("uses native role-gated entry links", () => {
  const source = readFileSync(new URL("../components/Navbar.tsx", import.meta.url), "utf8");
  expect(source.match(/href="\/registrations" target="_self"/g)).toHaveLength(2);
  expect(source.match(/<Show when=\{canCheckin\(\)\}>\s*<li><a href="\/registrations"/g)).toHaveLength(2);
 });
});
