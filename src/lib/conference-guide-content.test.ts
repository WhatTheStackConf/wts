import { describe, expect, it, vi } from "vite-plus/test";
import type ConferenceGuideData from "../../content/conference-guide.json";
import {
  conferenceLocation,
  conferenceLongDate,
  conferenceShortDate,
  conferenceTimeZone,
  conferenceTicketPrice,
} from "~/lib/conference-guide-content";

vi.mock("../../content/conference-guide.json", async (importOriginal) => {
  const original = await importOriginal<{ default: typeof ConferenceGuideData }>();
  const guide = original.default;
  return {
    ...original,
    default: {
      ...guide,
      event: {
        ...guide.event,
        date: { status: "not_announced" },
        location: { status: "not_announced" },
        timeZone: { status: "not_announced" },
      },
      tickets: {
        ...guide.tickets,
        status: "not_announced",
        regular: undefined,
        student: undefined,
      },
    },
  };
});


describe("conference facts without announcements", () => {
  it("omits unavailable event and ticket details instead of supplying stale defaults", () => {
    expect(conferenceLocation).toBeUndefined();
    expect(conferenceTimeZone).toBeUndefined();
    expect(conferenceLongDate).toBe("Not announced");
    expect(conferenceShortDate).toBe("Not announced");
    expect(conferenceTicketPrice("regular")).toBe("Not announced");
    expect(conferenceTicketPrice("student")).toBe("Not announced");
  });
});

