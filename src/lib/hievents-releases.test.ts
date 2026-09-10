import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { fetchHiEventsAttendeeSnapshot, fetchHiEventsReleases } from "~/lib/hievents";

function eventPayload(products: unknown[]) {
  return {
    ok: true,
    json: async () => ({ data: { slug: "wts-2026", product_categories: [{ products }] } }),
  } as Response;
}

function product(overrides: Record<string, unknown>) {
  return { id: 1, title: "Ticket", price: 50, currency: "EUR", ...overrides };
}

describe("HiEvents releases", () => {
  beforeEach(() => {
    process.env.HIEVENTS_API_URL = "https://tickets.example.com";
    process.env.HIEVENTS_EVENT_ID = "42";
    process.env.HIEVENTS_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.HIEVENTS_API_URL;
    delete process.env.HIEVENTS_EVENT_ID;
    delete process.env.HIEVENTS_API_KEY;
  });

  it("omits hidden products from the public listing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => eventPayload([
      product({ id: 1, title: "Conference entry" }),
      product({ id: 2, title: "Secret sponsor ticket", is_hidden: true }),
      product({ id: 3, title: "Workshop add-on", is_hidden: false }),
    ])));

    const releases = await fetchHiEventsReleases();

    expect(releases.map((release) => release.title)).toEqual([
      "Conference entry",
      "Workshop add-on",
    ]);
  });

  it("preserves zero-priced tickets and current availability", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => eventPayload([
      product({ id: 15, title: "InfoSec Monday", price: 0, is_available: true }),
      product({ id: 16, title: "Workshop Tuesday: iOS + AI", price: 0, is_available: false }),
    ])));
    const releases = await fetchHiEventsReleases();
    expect(releases.map(({ id, price, is_available }) => ({ id, price, is_available }))).toEqual([
      { id: 15, price: 0, is_available: true },
      { id: 16, price: 0, is_available: false },
    ]);
  });

  it("preserves numeric admission product IDs and refuses malformed identities", async () => {
    const productIds = [2, 13, 15, 16, 17, "2", "13", undefined, null, 0, -1, 2.5, " 2", "02", {}];
    const snapshot = await fetchHiEventsAttendeeSnapshot({
      apiUrl: "https://tickets.example.com", eventId: "5", accessToken: "test-key",
      fetcher: async () => new Response(JSON.stringify({
        data: productIds.map((product_id, index) => ({ id: `attendee-${index}`, product_id, email: "attendee@example.test", status: "ACTIVE" })),
        meta: { last_page: 1 },
      }), { status: 200 }),
    });
    expect(snapshot.state).toBe("success");
    if (snapshot.state !== "success") throw new Error("Expected a complete snapshot");
    expect(snapshot.attendees.map((attendee) => attendee.productId)).toEqual([
      "2", "13", "15", "16", "17", "2", "13", undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    ]);
    expect(snapshot.attendees.map((attendee) => attendee.stableId)).toEqual(productIds.map((_, index) => `attendee-${index}`));
  });

  it("omits products hidden behind a promo code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => eventPayload([
      product({ id: 1, title: "Conference entry" }),
      product({ id: 2, title: "Promo-only ticket", is_hidden_without_promo_code: true }),
      product({ id: 3, title: "Open add-on", is_hidden_without_promo_code: false }),
    ])));

    const releases = await fetchHiEventsReleases();

    expect(releases.map((release) => release.title)).toEqual([
      "Conference entry",
      "Open add-on",
    ]);
  });

  it("treats stringified and numeric hidden flags as hidden", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => eventPayload([
      product({ id: 1, title: "Visible" }),
      product({ id: 2, title: "String flag", is_hidden: "true" }),
      product({ id: 3, title: "Numeric flag", is_hidden: 1 }),
      product({ id: 4, title: "Legacy key", hidden: true }),
      product({ id: 5, title: "Promo string flag", is_hidden_without_promo_code: "true" }),
    ])));

    const releases = await fetchHiEventsReleases();

    expect(releases.map((release) => release.title)).toEqual(["Visible"]);
  });
});
