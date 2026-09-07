import { renderToString } from "@solidjs/web";
import { describe, expect, it } from "vite-plus/test";
import { AgendaProgramme } from "~/components/AgendaProgramme";
import type { PublicEventProgramme } from "~/lib/programme-public";
import { AgendaDays, resolveAgendaDay } from "~/components/AgendaDays";
import type { PublicAgendaDay } from "~/lib/programme-public";

const programme: PublicEventProgramme = {
  event: { name: "Main conference", compactLabel: "Conference" },
  tracks: [
    { key: "one", name: "Stage1", locationLabel: "Main hall" },
    { key: "two", name: "Stage2" },
    { key: "five", name: "Stage5" },
  ],
  slots: [
    { kind: "opening", startAt: "2026-09-19T07:00:00Z", endAt: "2026-09-19T07:15:00Z", title: "Opening" },
    { kind: "session", startAt: "2026-09-19T07:15:00Z", endAt: "2026-09-19T07:35:00Z", track: { key: "one", name: "Stage1" }, session: { slug: "short-talk", title: "A short talk", speakers: [{ slug: "ana", name: "Ana Example" }] } },
    { kind: "session", startAt: "2026-09-19T07:15:00Z", endAt: "2026-09-19T07:50:00Z", track: { key: "two", name: "Stage2" }, session: { slug: "normal-talk", title: "A normal talk", speakers: [] } },
    { kind: "session", startAt: "2026-09-19T07:40:00Z", endAt: "2026-09-19T08:00:00Z", track: { key: "one", name: "Stage1" }, session: { slug: "paired-talk", title: "The paired short talk", speakers: [] } },
    { kind: "break", startAt: "2026-09-19T08:00:00Z", endAt: "2026-09-19T08:15:00Z", title: "Coffee break" },
  ],
};

const renderProgramme = (value = programme) => renderToString(() => <AgendaProgramme programme={value} id="test-programme" />);

describe("agenda day filtering", () => {
  const days: PublicAgendaDay[] = [
    { key: "monday", localDate: "2026-09-14", title: "InfoSec Monday", programmes: [] },
    { key: "thursday", localDate: "2026-09-17", title: "Thursday", programmes: [
      { event: { name: "MAUI Day", compactLabel: "MAUI" }, tracks: [], slots: [] },
      { event: { name: "Workshop Thursday", compactLabel: "Workshops" }, tracks: [], slots: [] },
    ] },
    { key: "saturday", localDate: "2026-09-19", title: "Main Conference Day", programmes: [programme] },
  ];
  const renderDays = (selectedDay?: string) => renderToString(() => <AgendaDays days={days} selectedDay={selectedDay} onSelect={() => {}} />);

  it("defaults to the main day and renders only that day's programme", () => {
    const html = renderDays();
    expect(html).toContain('id="agenda-day-saturday"');
    expect(html).not.toContain('id="agenda-day-monday"');
    expect(html).not.toContain('id="agenda-day-thursday"');
    expect(html).toContain('href="/agenda?day=all"');
    expect(html).toContain('href="/agenda?day=2026-09-19" aria-current="page"');
    expect(html).toContain('for="agenda-day-picker"');
  });

  it("shows both Thursday programmes without bringing in other days", () => {
    const html = renderDays("2026-09-17");
    expect(html).toContain("MAUI Day");
    expect(html).toContain("Workshop Thursday");
    expect(html).not.toContain('id="agenda-day-saturday"');
    expect(html).not.toContain('id="agenda-day-monday"');
  });

  it("shows the entire week only when explicitly selected", () => {
    const html = renderDays("all");
    for (const day of days) expect(html).toContain(`id="agenda-day-${day.key}"`);
    expect(html).toContain('href="/agenda?day=all" aria-current="page"');
  });

  it("handles invalid, repeated and unavailable day parameters without an empty view", () => {
    expect(resolveAgendaDay(days, "invalid")).toBe("2026-09-19");
    expect(resolveAgendaDay(days, ["2026-09-14", "2026-09-17"])).toBe("2026-09-19");
    expect(resolveAgendaDay(days, "2026-09-15")).toBe("2026-09-19");
    expect(resolveAgendaDay(days.slice(0, 2))).toBe("2026-09-14");
    expect(resolveAgendaDay([], "invalid")).toBe("");
  });
});

describe("public agenda programme", () => {
  it("uses compact speaker circles with lazy images and a missing-photo fallback", () => {
    const speakers = [
      { slug: "ana", name: "Ana Example", photoUrl: "https://pb.example/api/files/speakers/ana/photo.jpg" },
      { slug: "ben", name: "Ben Example", photoUrl: null },
    ];
    for (const value of [
      { ...programme, slots: [{ ...programme.slots[1], session: { slug: "talk", title: "Talk", speakers } }] },
      { event: programme.event, tracks: [], slots: [], untimed: { summary: "Workshop", sessions: [{ slug: "talk", title: "Talk", speakers }] } },
    ]) {
      const html = renderProgramme(value);
      expect(html).toContain("w-10 h-10");
      expect(html).toContain("rounded-full p-[2px]");
      expect(html).toContain("/api/image?src=");
      expect(html).toContain('sizes="40px"');
      expect(html).toContain('width="40" height="40"');
      expect(html).toContain('alt=""');
      expect(html).toContain('loading="lazy"');
      expect(html).toContain('href="/speakers/ben"');
      expect(html).toContain("BE");
      expect(html).not.toContain('src="null"');
    }
  });

  it("renders event-level speakers and venue without inventing talk assignments", () => {
    const html = renderProgramme({
      event: { name: "DevFest", compactLabel: "DevFest" }, tracks: [], slots: [],
      untimed: {
        title: "Pre-DevFest Days: Day Zero x WhatThe(Google)Stack", summary: "DevFest", access: "Free entry",
        locationLabel: "FINKI, Skopje", highlights: ["Josefine Schaefer"],
        speakers: [{ slug: "josefine-schaefer", name: "Josefine Schaefer", photoUrl: "https://pb.wts.sh/api/files/speakers/j/photo.jpg" }],
        sessions: [{ slug: "agentic-accessibility", title: "Agentic Accessibility", speakers: [] }],
      },
    });
    expect(html).toContain("Pre-DevFest Days: Day Zero x WhatThe(Google)Stack");
    expect(html).toContain("Location: FINKI, Skopje");
    expect(html).toContain('aria-label="Announced speakers"');
    expect(html).toContain('href="/speakers/josefine-schaefer"');
    expect(html).toContain('href="/sessions/agentic-accessibility"');
    expect(html).toContain("Starting time: TBA");
    expect(html).not.toContain("Session lineup: TBA");
    expect(html).not.toContain('aria-label="Speakers"');
  });

  it("renders an untimed lineup without inventing clock times or stage positions", () => {
    const html = renderProgramme({
      event: { name: "Workshop Tuesday: iOS + AI", compactLabel: "Tuesday" },
      tracks: [], slots: [],
      untimed: {
        summary: "An iOS workshop plus an AI talk.", access: "Free entry. No ticket required.",
        sessions: [{ slug: "ios", title: "iOS workshop", speakers: [{ slug: "mia", name: "Mia" }] }],
      },
    });
    expect(html).toContain("Starting time: TBA");
    expect(html).toContain("Running order and session times: TBA.");
    expect(html).toContain('href="/sessions/ios"');
    expect(html).toContain('href="/speakers/mia"');
    expect(html).toContain("Free entry. No ticket required.");
    expect(html).not.toContain("grid-template-rows");
    expect(html).not.toContain("<time");
    expect(html).not.toContain("Choose a stage");
  });

  it("keeps an announced event visible when its session lineup is not available", () => {
    const html = renderProgramme({
      event: { name: "DevFest", compactLabel: "DevFest" }, tracks: [], slots: [],
      untimed: { summary: "Wednesday's event", sessions: [], cta: { label: "Register", href: "https://example.test/event" } },
    });
    expect(html).toContain("Starting time: TBA");
    expect(html).toContain("Session lineup: TBA");
    expect(html).toContain('href="https://example.test/event"');
    expect(html).not.toContain("No sessions scheduled");
  });

  it("renders a stage grid, speaker links, exact local times and common items", () => {
    const html = renderProgramme();
    expect(html).toContain('href="/sessions/short-talk"');
    expect(html).toContain('href="/speakers/ana"');
    expect(html).toContain("Ana Example");
    expect(html).toContain("09:15");
    expect(html).toContain("09:35");
    expect(html).toContain("09:50");
    expect(html).toContain("09:40");
    expect(html).not.toContain(" AM");
    expect(html).toContain("grid-column:2 / -1");
    expect(html).toContain("grid-row:3 / 4");
    expect(html).toContain("grid-row:3 / 6");
    expect(html).toContain("Programme-wide");
    expect(html).toContain("Coffee break");
    expect(html).toContain('for="test-programme-stage"');
    expect(html).toContain('id="test-programme-stage"');
    expect(html).toContain("Stage5 · TBD");
  });

  it("keeps other stages out of the initial mobile list while retaining common items", () => {
    const html = renderProgramme();
    const mobile = html.slice(html.indexOf('id="test-programme-mobile-slots"'), html.indexOf('class="hidden lg:block"'));
    expect(mobile).toContain("A short talk");
    expect(mobile).toContain("The paired short talk");
    expect(mobile).toContain("Opening");
    expect(mobile).toContain("Coffee break");
    expect(mobile).not.toContain("A normal talk");
  });

  it("supports track-free future programmes and preserves the cross-midnight end date", () => {
    const html = renderProgramme({
      event: { name: "Afterparty", compactLabel: "Afterparty" },
      tracks: [],
      slots: [{ kind: "break", title: "Late gathering", startAt: "2026-09-19T21:30:00Z", endAt: "2026-09-19T22:30:00Z" }],
    });
    expect(html).toContain("23:30");
    expect(html).toContain("00:30");
    expect(html).toContain("Ends Sun, Sep 20");
    expect(html).toContain("Late gathering");
    expect(html).not.toContain("Choose a stage");
    expect(html).not.toContain("Stage5");
    expect(html).toContain("repeat(1, minmax(12rem, 1fr))");
  });

  it("handles an empty programme without rendering a broken timetable", () => {
    const html = renderProgramme({ ...programme, slots: [] });
    expect(html).toContain("No sessions scheduled for this programme yet.");
    expect(html).not.toContain("grid-template-rows");
  });
});
