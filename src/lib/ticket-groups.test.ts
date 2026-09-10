import { describe, expect, it } from "vite-plus/test";
import { groupTicketReleases } from "~/lib/ticket-groups";
import type { HiEventsRelease } from "~/lib/hievents";

function release(id: number, title: string): HiEventsRelease {
  return { id, title, description: null, price: 0, currency: "EUR", is_available: true,
    sales_start_date: null, sales_end_date: null, quantity_sold: 0, quantity_available: null,
    purchase_link: "https://hievents.foundry.mk/event/5/whatthestack-2026" };
}

describe("public ticket groups", () => {
  it("keeps independent pre-conference reservations out of paid conference add-ons", () => {
    const input = [release(2, "Conference entry"), release(999, "Student Ticket"),
      release(3, "Swag add-on"), release(14, "Payments workshop"),
      release(17, "Angular Day"), release(15, "InfoSec Monday"), release(16, "Workshop Tuesday: iOS + AI")];
    const groups = groupTicketReleases(input);
    expect(groups.base.map((item) => item.id)).toEqual([2, 999]);
    expect(groups.addOns.map((item) => item.id)).toEqual([3, 14]);
    expect(groups.preConference.map((item) => item.id)).toEqual([15, 16, 17]);
    expect(input.map((item) => item.id)).toEqual([2, 999, 3, 14, 17, 15, 16]);
  });

  it("does not invent unavailable catalogue entries, and retains sold-out tickets for status display", () => {
    const soldOut = { ...release(15, "InfoSec Monday"), is_available: false };
    expect(groupTicketReleases([soldOut]).preConference).toEqual([soldOut]);
    expect(groupTicketReleases([])).toEqual({ base: [], addOns: [], preConference: [] });
  });
});
