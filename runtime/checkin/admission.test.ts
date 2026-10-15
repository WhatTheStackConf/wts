import { createHash } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import { HttpAdmissionProcessor } from "./admission.js";
import type { AdmissionAttendee, AdmissionJob } from "./protocol.js";

const base = "https://hievents.example.invalid/api";
const token = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from('{"account_id":77}').toString("base64url")}.synthetic`;
const sourceKey = createHash("sha256").update(JSON.stringify(["wts2026:hievents", base, "77"])).digest("hex");
const job: AdmissionJob = {
  attemptId: "attempt00000001", workflowId: "workflow000001", commandId: "command000001", stationId: "wts2026station1", eventId: "event000000001",
  sourceKey, upstreamEventId: "501", upstreamAttendeeId: "901", upstreamListId: "701", context: {}, affiliation: null, coordinatorGeneration: 1,
};

describe("admission flow", () => {
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
});

describe("upstream validation", () => {
  const list = { id: 701, name: "Admission", short_id: "cil_SYNTHETIC1234", is_active: true, is_expired: false, products: [{ id: 601, event_id: 501 }] };
  const attendeeData = { id: 901, event_id: 501, public_id: "A-ABC1234", product_id: 601, first_name: "Ana", last_name: "O’Neill", status: "ACTIVE" };
  const row = { id: 1101, attendee_id: 901, check_in_list_id: 701, order_id: 1001, checked_in_at: "2026-09-10T10:00:00Z", short_id: "chk_SYNTHETIC1234" };
  const eligible: AdmissionAttendee = { upstreamAttendeeId: "901", publicId: "A-ABC1234", productId: "601", alreadyCheckedIn: false, listCapability: "cil_SYNTHETIC1234", eligibility: "eligible" };

  function page(rows: unknown[], meta: Record<string, unknown> = { total: rows.length, current_page: 1, last_page: 1 }) {
    return Response.json({ data: rows, meta });
  }
  function processor(responses: Response[], config: { apiUrl?: string; apiKey?: string; accountId?: string } = { apiUrl: base, apiKey: token, accountId: "77" }) {
    const calls: string[] = [];
    let index = 0;
    const fetcher: typeof fetch = async (input, init) => {
      calls.push(`${init?.method ?? "GET"} ${typeof input === "string" ? input : input instanceof URL ? input.href : input.url}`);
      return responses[index++] ?? Response.json({ error: "unexpected" }, { status: 500 });
    };
    return { calls, value: new HttpAdmissionProcessor(config, { fetch: fetcher }) };
  }
  async function attendee(data: Record<string, unknown>, ...more: Response[]) {
    return processor([Response.json({ data }), ...more]).value.attendee(job);
  }

  it("accepts only an https base whose token names the configured account", () => {
    const configs = [
      { apiUrl: base, apiKey: token, accountId: "77" },
      { apiUrl: "http://hievents.example.invalid/api", apiKey: token, accountId: "77" },
      { apiUrl: `${base}?x=1`, apiKey: token, accountId: "77" },
      { apiUrl: ` ${base}`, apiKey: token, accountId: "77" },
      { apiUrl: base, apiKey: "not-a-jwt", accountId: "77" },
      { apiUrl: base, apiKey: token, accountId: "78" },
      { apiUrl: base, apiKey: token },
    ];
    expect(configs.map((config) => processor([], config).value.isConfigured)).toEqual([true, false, false, false, false, false, false]);
  });

  it("maps upstream attendee status to admission eligibility", async () => {
    const statuses = ["pending", "AWAITING_PAYMENT", "REFUNDED", "CANCELLED", "constructor", "UNKNOWN"];
    const results = await Promise.all(statuses.map((status) => attendee({ ...attendeeData, status })));
    expect(results.map((result) => result?.eligibility)).toEqual(["awaiting_payment", "awaiting_payment", "cancelled", "cancelled", "unknown_eligibility", "unknown_eligibility"]);
    expect(results[0]).toEqual({ upstreamAttendeeId: "901", publicId: "A-ABC1234", productId: "601", alreadyCheckedIn: false, eligibility: "awaiting_payment" });
  });

  it("rejects attendee records that are not this job's exact safe attendee", async () => {
    const records = [
      { ...attendeeData, id: 902 },
      { ...attendeeData, event_id: 502 },
      { ...attendeeData, public_id: "B-ABC1234" },
      { ...attendeeData, last_name: 4 },
      { ...attendeeData, first_name: "<script>" },
      { ...attendeeData, status: 1 },
      { ...attendeeData, product_id: "0" },
      { ...attendeeData, check_in: { ...row, check_in_list_id: 702 } },
      { ...attendeeData, check_in: { ...row, short_id: "bad id" } },
    ];
    expect(await Promise.all(records.map((data) => attendee(data)))).toEqual([null, null, null, null, null, null, null, null, null]);
  });

  it("classifies an existing check-in and a null last name", async () => {
    expect(await attendee({ ...attendeeData, last_name: null, status: "CANCELLED", check_in: row })).toEqual({ upstreamAttendeeId: "901", publicId: "A-ABC1234", productId: "601", alreadyCheckedIn: true, eligibility: "eligible" });
  });

  it("resolves the list capability across complete pages only", async () => {
    const filler = Array.from({ length: 25 }, (_, index) => ({ ...list, id: 100 + index, short_id: `cil_FILL${index}` }));
    const twoPages = processor([Response.json({ data: attendeeData }), page(filler, { total: 26, current_page: 1, last_page: 2 }), page([list], { total: 26, current_page: 2, last_page: 2 })]);
    expect(await twoPages.value.attendee(job)).toEqual(eligible);
    expect(twoPages.calls).toEqual([
      `GET ${base}/events/501/attendees/901`,
      `GET ${base}/events/501/check-in-lists?page=1&per_page=25`,
      `GET ${base}/events/501/check-in-lists?page=2&per_page=25`,
    ]);
    const results = await Promise.all([
      attendee(attendeeData, page([{ ...list, products: [{ id: 602 }] }])),
      attendee(attendeeData, page([{ ...list, is_active: false }])),
      attendee(attendeeData, page([{ ...list, is_expired: true }])),
      attendee(attendeeData, page([{ ...list, id: 702 }])),
      attendee(attendeeData, page([list], { total: 1, current_page: 2, last_page: 1 })),
      attendee(attendeeData, page([list], { total: 2, current_page: 1, last_page: 1 })),
      attendee(attendeeData, page([list, list], { total: 2, current_page: 1, last_page: 1 })),
      attendee(attendeeData, page([{ ...list, products: [{ id: 601 }, { id: 601 }] }])),
      attendee(attendeeData, page([{ ...list, is_active: "yes" }])),
    ]);
    expect(results.map((result) => result && result.eligibility)).toEqual(["not_in_list", "not_in_list", "not_in_list", "not_in_list", null, null, null, null, null]);
  });

  it("rethrows upstream read failures other than a missing attendee", async () => {
    await expect(processor([new Response("", { status: 403 })]).value.attendee(job)).rejects.toThrow();
    expect(await processor([]).value.attendee({ ...job, sourceKey: "0".repeat(64) })).toBeNull();
  });

  it("classifies admission responses without retrying the POST", async () => {
    const existingFallback = createHash("sha256").update('{"attendee":"901","list":"701"}').digest("hex");
    const cases: [Response, unknown][] = [
      [Response.json({ data: [row] }), { state: "newly_checked_in", fingerprint: "7f57f8be04b89fd888b7b891fbb1907b6a9f768171ba7afbf55c5ae021c8aa7c" }],
      [Response.json({ data: [row], errors: { other: ["x"] } }), { state: "uncertain" }],
      [Response.json({ data: [row, row] }), { state: "uncertain" }],
      [Response.json({ data: [] }), { state: "uncertain" }],
      [Response.json({ data: [{ ...row, attendee_id: 902 }] }), { state: "uncertain" }],
      [Response.json({ data: [row] }, { status: 201 }), { state: "uncertain" }],
      [Response.json({ data: [row], errors: { "A-ABC1234": ["exists"] } }, { status: 409 }), { state: "existing_unattributed", fingerprint: "7f57f8be04b89fd888b7b891fbb1907b6a9f768171ba7afbf55c5ae021c8aa7c" }],
      [Response.json({ data: [{ ...row, short_id: "bad id" }], errors: { "A-ABC1234": ["exists"] } }), { state: "existing_unattributed", fingerprint: existingFallback }],
      [new Response("", { status: 429 }), { state: "uncertain" }],
      [new Response("not json", { status: 200 }), { state: "uncertain" }],
    ];
    for (const [response, expected] of cases) {
      const p = processor([response]);
      expect(await p.value.admit(job, eligible)).toEqual(expected);
      expect(p.calls).toEqual([`POST ${base}/public/check-in-lists/cil_SYNTHETIC1234/check-ins`]);
    }
    for (const blocked of [{ ...eligible, alreadyCheckedIn: true }, { ...eligible, listCapability: undefined }]) {
      const p = processor([]);
      expect(await p.value.admit(job, blocked)).toEqual({ state: "uncertain" });
      expect(p.calls).toEqual([]);
    }
  });
});
