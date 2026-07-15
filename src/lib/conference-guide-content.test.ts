import { describe, expect, it } from "vitest";
import { pages } from ".velite";
import {
  conferenceGuideContent,
  conferenceLocation,
  conferenceLongDate,
  conferenceShortDate,
  conferenceTicketPrice,
} from "~/lib/conference-guide-content";

describe("Conference Guide deploy content", () => {
  it("provides validated announced logistics and explicit unknown states", () => {
    expect(conferenceGuideContent).toMatchObject({
      schemaVersion: "1",
      contentVersion: "2026-07-14",
      event: {
        name: "WhatTheStack 2026",
        date: { status: "announced", localDate: "2026-09-19" },
        location: {
          status: "announced",
          city: "Skopje",
          country: "North Macedonia",
        },
        timeZone: { status: "announced", iana: "Europe/Skopje" },
      },
      mainVenue: { status: "not_announced" },
      accessibility: { status: "not_announced", contactEmail: "what@wts.sh" },
      accommodation: { status: "not_announced" },
      tickets: {
        status: "announced",
        regular: { amount: 50, currency: "EUR" },
        student: { amount: 20, currency: "EUR" },
      },
      codeOfConduct: {
        status: "announced",
        canonicalPath: "/code-of-conduct",
      },
    });
  });

  it("formats website logistics from the generated facts", () => {
    expect(conferenceLongDate).toBe("September 19, 2026");
    expect(conferenceShortDate).toBe("September 19");
    expect(conferenceLocation).toBe("Skopje, North Macedonia");
    expect(conferenceTicketPrice("regular")).toBe("€50");
    expect(conferenceTicketPrice("student")).toBe("€20");
  });

  it("keeps structured fact components in generated website content", () => {
    const about = pages.find((page) => page.slug === "about");
    const convince = pages.find((page) => page.slug === "convince-your-boss");
    const speakerGuide = pages.find((page) => page.slug === "speaker-guide");

    expect(about?.content).toContain("ConferenceLocation");
    expect(about?.content).toContain("ConferenceDate");
    expect(about?.content).toContain("GeneralContactEmail");
    expect(convince?.content).toContain("RegularTicketPrice");
    expect(convince?.content).toContain("StudentTicketPrice");
    expect(convince?.content).toContain("GeneralContactEmail");
    expect(speakerGuide?.title).toBe("Speaker Guide");
    expect(speakerGuide?.content).toContain("ConferenceLocation");
    expect(speakerGuide?.content).toContain("ConferenceDate");
    expect(speakerGuide?.content).toContain("GeneralContactEmail");
  });
});
