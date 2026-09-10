import { createHash } from "node:crypto";
import { expect, it } from "vite-plus/test";
import { HttpAdmissionProcessor } from "./admission.js";
import type { AdmissionJob } from "./protocol.js";

const base = "https://hievents.example.invalid/api";
const token = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from('{"account_id":77}').toString("base64url")}.synthetic`;
const sourceKey = createHash("sha256").update(JSON.stringify(["wts2026:hievents", base, "77"])).digest("hex");
const job: AdmissionJob = {
  attemptId: "attempt00000001", workflowId: "workflow000001", commandId: "command000001", stationId: "wts2026station1", eventId: "event000000001",
  sourceKey, upstreamEventId: "501", upstreamAttendeeId: "901", upstreamListId: "701", context: {}, affiliation: null, coordinatorGeneration: 1,
};
function listPage() {
  return { data: [{ id: 701, name: "Admission", short_id: "cil_SYNTHETIC1234", is_active: true, is_expired: false, products: [{ id: 601, event_id: 501 }] }], meta: { total: 1, current_page: 1, last_page: 1 }, links: { first: null, last: null, prev: null, next: null } };
}
function detail(check_in?: unknown) {
  return { data: { id: 901, event_id: 501, public_id: "A-ABC1234", product_id: 601, first_name: "Ana", last_name: "O’Neill", status: "ACTIVE", ...(check_in === undefined ? {} : { check_in }) } };
}
function checkIn() {
  return { id: 1101, attendee_id: 901, check_in_list_id: 701, order_id: 1001, checked_in_at: "2026-09-10T10:00:00Z", short_id: "chk_SYNTHETIC1234" };
}
function processor(...responses: Response[]) {
  const calls: { url: string; method: string }[] = [];
  let index = 0;
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url, method: init?.method ?? "GET" });
    return responses[index++] ?? Response.json({ error: "unexpected" }, { status: 500 });
  };
  return { calls, value: new HttpAdmissionProcessor({ apiUrl: base, apiKey: token, accountId: "77" }, { fetch: fetcher }) };
}

it("classifies one exact new check-in and never retries the mutation", async () => {
  const p = processor(Response.json(detail()), Response.json(listPage()), Response.json({ data: [checkIn()], errors: {} }));
  const attendee = await p.value.attendee(job);
  expect(attendee).toMatchObject({ upstreamAttendeeId: "901", publicId: "A-ABC1234", productId: "601", alreadyCheckedIn: false, listCapability: "cil_SYNTHETIC1234" });
  expect(await p.value.admit(job, attendee!)).toMatchObject({ state: "newly_checked_in", fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(p.calls.map((call) => call.method)).toEqual(["GET", "GET", "POST"]);
});

it("classifies a pre-existing check-in without authorizing a POST", async () => {
  const p = processor(Response.json(detail(checkIn())), Response.json(listPage()));
  const attendee = await p.value.attendee(job);
  expect(attendee).toMatchObject({ alreadyCheckedIn: true });
  expect(await p.value.admit(job, attendee!)).toEqual({ state: "uncertain" });
  expect(p.calls.map((call) => call.method)).toEqual(["GET"]);
});

it("turns a lost upstream response into uncertainty after one POST", async () => {
  const p = processor(Response.json(detail()), Response.json(listPage()), new Response("", { status: 503 }));
  const attendee = await p.value.attendee(job);
  expect(await p.value.admit(job, attendee!)).toEqual({ state: "uncertain" });
  expect(p.calls.filter((call) => call.method === "POST")).toHaveLength(1);
});

it("fails closed for cancelled eligibility before the send fence", async () => {
  const cancelled = { ...detail(), data: { ...detail().data, status: "CANCELLED" } };
  const p = processor(Response.json(cancelled));
  await expect(p.value.attendee(job)).resolves.toMatchObject({ eligibility: "cancelled", alreadyCheckedIn: false });
  expect(p.calls.map((call) => call.method)).toEqual(["GET"]);
});

it("turns a missing attendee into an explicit not-in-list rejection", async () => {
  const p = processor(new Response("", { status: 404 }));
  await expect(p.value.attendee(job)).resolves.toMatchObject({ eligibility: "not_in_list", alreadyCheckedIn: false });
  expect(p.calls.map((call) => call.method)).toEqual(["GET"]);
});

it("preserves attendee-keyed existing responses even on a non-200 mutation response", async () => {
  const p = processor(Response.json(detail()), Response.json(listPage()), Response.json({ data: [], errors: { "A-ABC1234": [{ message: "already checked in" }] } }, { status: 422 }));
  const attendee = await p.value.attendee(job);
  await expect(p.value.admit(job, attendee!)).resolves.toMatchObject({ state: "existing_unattributed", fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) });
});
