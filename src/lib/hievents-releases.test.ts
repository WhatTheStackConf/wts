import { describe, expect, it } from "vite-plus/test";
import { fetchHiEventsAttendeeSnapshot } from "~/lib/hievents";

describe("HiEvents attendee identities", () => {
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

});
