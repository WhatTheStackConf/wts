import { describe, expect, it } from "vite-plus/test";
import { conferenceGuideContent } from "~/lib/conference-guide-content";
import { addAnnouncedWeekProgrammes, untimedWeekProgrammes } from "~/lib/conference-week-agenda";
import type { AppearanceEventRecord, SessionRecord, SpeakerRecord } from "~/lib/pocketbase-types";
import type { PublicAgenda } from "~/lib/programme-public";
import {
  conferenceWeekCta,
  conferenceWeekDayLabel,
  conferenceWeekTracks,
} from "~/lib/conference-week";

describe("untimed weekday agendas", () => {
  const events = untimedWeekProgrammes.map((definition, index) => ({
    id: `event-${index}`, name: definition.eventName, published: true,
  })) as AppearanceEventRecord[];

  it("adds all five weekdays, groups Thursday, preserves Saturday and has no fake timestamps", () => {
    const input: PublicAgenda = { days: [{ key: "saturday", localDate: "2026-09-19", title: "Main Conference Day", programmes: [] }] };
    const result = addAnnouncedWeekProgrammes(input, events, [], []);
    expect(result.days.map((day) => day.localDate)).toEqual([
      "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19",
    ]);
    expect(result.days[3].programmes.map((programme) => programme.event.name)).toEqual(["MAUI Day", "Workshop Thursday"]);
    const weekdayProgrammes = result.days.slice(0, -1).flatMap((day) => day.programmes);
    expect(weekdayProgrammes).toHaveLength(6);
    expect(weekdayProgrammes.every((programme) => programme.untimed && programme.slots.length === 0)).toBe(true);
    expect(JSON.stringify(weekdayProgrammes)).not.toMatch(/startAt|endAt/);
    expect(input.days).toHaveLength(1);
    expect(result.days.at(-1)).toEqual(input.days[0]);
    expect(addAnnouncedWeekProgrammes(result, events, [], [])).toEqual(result);
  });

  it("shows only explicitly assigned published sessions and public speaker fields", () => {
    const sessions = [
      { id: "ios", slug: "fundamentals-of-native-ios-development", title: "iOS", published: true, speakers: ["mia", "hidden"], cfp_submission: "private" },
      { id: "ddd", slug: "ddd-for-ai-assisted-development", title: "DDD", published: false, speakers: [] },
      { id: "other", slug: "main-day-talk", title: "Saturday only", published: true, speakers: ["mia"] },
    ] as SessionRecord[];
    const speakers = [
      { id: "mia", slug: "mia", display_name: "Mia", published: true, email: "private@example.test" },
      { id: "hidden", slug: "hidden", display_name: "Private speaker", published: false },
    ] as SpeakerRecord[];
    const result = addAnnouncedWeekProgrammes({ days: [] }, events, sessions, speakers);
    expect(result.days[1].programmes[0].untimed?.sessions).toEqual([
      { slug: "fundamentals-of-native-ios-development", title: "iOS", format: undefined, schedule: expect.objectContaining({ startAt: "2026-09-15T18:00:00+02:00", endAt: undefined, locationLabel: "Base42 Hackerspace, Rimska 25, 1000 Skopje" }), speakers: [{ slug: "mia", name: "Mia", photoUrl: null }] },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/private|cfp_submission|Saturday only|"DDD"/);
    expect(result.days[1].programmes[0].untimed?.access).toBe("Free entry. 50 seats; reserve your ticket.");
    expect(result.days[1].programmes[0].untimed?.cta?.label).toBe("Reserve a free ticket");
    expect(untimedWeekProgrammes.flatMap((definition) => [...definition.sessions])).toHaveLength(18);
  });

  it("projects sourced DevFest talks without inventing speaker assignments or times", () => {
    const input = {
      events: [{ id: "devfest", name: "DevFest", published: true }] as AppearanceEventRecord[],
      sessions: [
        { id: "a", slug: "agentic-accessibility", title: "Agentic Accessibility", speakers: [], published: true },
        { id: "b", slug: "designing-multi-agent-systems-sequential-parallel-and-beyond-with-adk", title: "Designing Multi-Agent Systems: Sequential, Parallel, and Beyond with ADK", speakers: [], published: true },
      ].map((session) => ({ ...session, abstract: "", created: "", updated: "", collectionId: "sessions", collectionName: "sessions" })),
      speakers: [
        { id: "r", slug: "roushanak-rahmat", display_name: "Roushanak Rahmat", appearance_events: ["devfest"], published: true },
        { id: "j", slug: "josefine-schaefer", display_name: "Josefine Schaefer", photo: "josefine.jpg", appearance_events: ["devfest"], published: true },
        { id: "a", slug: "akshata-mohanty", display_name: "Akshata Mohanty", photo: "akshata.jpeg", appearance_events: ["devfest"], published: true },
        { id: "other", slug: "other", display_name: "Another event speaker", appearance_events: ["other-event"], published: true },
        { id: "private", slug: "private", display_name: "Private speaker", photo: "private.jpg", appearance_events: ["devfest"], published: false },
      ] as SpeakerRecord[],
    };
    const result = addAnnouncedWeekProgrammes({ days: [] }, input.events, input.sessions, input.speakers);
    const programme = result.days[0].programmes[0];
    expect(result.days[0].localDate).toBe("2026-09-16");
    expect(programme.slots).toEqual([]);
    expect(programme.untimed?.sessions).toHaveLength(2);
    expect(programme.untimed?.sessions.every((session) => session.speakers.length === 0)).toBe(true);
    expect(programme.untimed?.speakers).toEqual([
      { slug: "akshata-mohanty", name: "Akshata Mohanty", photoUrl: expect.stringMatching(/\/api\/files\/speakers\/a\/akshata\.jpeg$/) },
      { slug: "josefine-schaefer", name: "Josefine Schaefer", photoUrl: expect.stringMatching(/\/api\/files\/speakers\/j\/josefine\.jpg$/) },
      { slug: "roushanak-rahmat", name: "Roushanak Rahmat", photoUrl: null },
    ]);
    expect(programme.untimed?.title).toBe("Pre-DevFest Days: Day Zero x WhatThe(Google)Stack");
    expect(programme.untimed?.locationLabel).toContain("FINKI");
    expect(programme.untimed?.cta?.href).toContain("gdg.community.dev/events/");
    expect(JSON.stringify(programme)).not.toContain("private");
    expect(JSON.stringify(programme)).not.toContain("Another event speaker");
    const withoutSessions = addAnnouncedWeekProgrammes({ days: [] }, input.events, [], input.speakers).days[0].programmes[0];
    expect(withoutSessions.untimed?.sessions).toEqual([]);
    expect(withoutSessions.untimed?.speakers).toEqual(programme.untimed?.speakers);
  });

  it("announces Angular event members without borrowing other talks or duplicating assigned speakers", () => {
    const angularEvents = [{ id: "angular", name: "Angular Day", published: true }] as AppearanceEventRecord[];
    const sessions = [
      { slug: "probabilistic-ai-to-deterministic-applications", title: "Selected Angular talk", published: true, speakers: ["nicolas"] },
      { slug: "same-crud-10-times", title: "Selected CRUD talk", published: true, speakers: ["aleksandar"] },
      { slug: "beyond-the-chatbox", title: "Selected chatbox talk", published: true, speakers: ["angel"] },
      { slug: "offline-first-zero-cost", title: "Selected offline talk", published: true, speakers: ["michael"] },
      { slug: "main-day-kiril", title: "Kiril main-day topic", published: true, speakers: ["kiril"] },
      { slug: "main-day-santosh", title: "Santosh main-day topic", published: true, speakers: ["santosh"] },
    ] as SessionRecord[];
    const speakers = [
      ...["nicolas", "aleksandar", "angel", "michael"].map((id) => ({ id, slug: id, display_name: id, published: true, appearance_events: ["angular"] })),
      { id: "santosh", slug: "santosh-yadav", display_name: "Santosh Yadav", published: true, appearance_events: ["main", "angular"] },
      { id: "kiril", slug: "kiril-zafirov", display_name: "Kiril Zafirov", photo: "kiril.jpg", published: true, appearance_events: ["angular"], email: "private@example.test" },
      { id: "new", slug: "another-speaker", display_name: "Another Speaker", published: true, appearance_events: ["angular"] },
      { id: "mateusz", slug: "mateusz", display_name: "Unpublished Mateusz", published: false, appearance_events: ["angular"] },
      { id: "unrelated", slug: "unrelated", display_name: "Unrelated speaker", published: true, appearance_events: ["main"] },
      { id: "no-event", slug: "no-event", display_name: "No event", published: true },
    ] as SpeakerRecord[];
    const programme = addAnnouncedWeekProgrammes({ days: [] }, angularEvents, sessions, speakers).days[0].programmes[0];
    expect(programme.untimed?.unassignedSpeakers).toEqual([
      { slug: "another-speaker", name: "Another Speaker", photoUrl: null },
      { slug: "kiril-zafirov", name: "Kiril Zafirov", photoUrl: expect.stringMatching(/\/api\/files\/speakers\/kiril\/kiril\.jpg$/) },
      { slug: "santosh-yadav", name: "Santosh Yadav", photoUrl: null },
    ]);
    expect(programme.untimed?.sessions.map((session) => session.slug)).toEqual([
      "probabilistic-ai-to-deterministic-applications", "same-crud-10-times", "beyond-the-chatbox", "offline-first-zero-cost",
    ]);
    expect(programme.untimed?.speakers).toBeUndefined();
    expect(programme.slots).toEqual([]);
    expect(JSON.stringify(programme)).not.toMatch(/main-day|private|Unpublished|Unrelated|No event|startAt|endAt/);
  });

  it("keeps Angular appearances visible until a selected public session is available", () => {
    const angularEvents = [{ id: "angular", name: "Angular Day", published: true }] as AppearanceEventRecord[];
    const speakers = [{ id: "speaker", slug: "speaker", display_name: "Announced Speaker", published: true, appearance_events: ["angular"] }] as SpeakerRecord[];
    const session = { slug: "beyond-the-chatbox", title: "Confirmed topic", speakers: ["speaker"], published: false } as SessionRecord;
    for (const sessions of [[], [session]]) {
      const programme = addAnnouncedWeekProgrammes({ days: [] }, angularEvents, sessions, speakers).days[0].programmes[0];
      expect(programme.untimed?.sessions).toEqual([]);
      expect(programme.untimed?.unassignedSpeakers).toEqual([{ slug: "speaker", name: "Announced Speaker", photoUrl: null }]);
      expect(programme.slots).toEqual([]);
      expect(JSON.stringify(programme)).not.toContain("Confirmed topic");
    }
    const assigned = addAnnouncedWeekProgrammes({ days: [] }, angularEvents, [{ ...session, published: true }], speakers).days[0].programmes[0];
    expect(assigned.untimed?.unassignedSpeakers).toEqual([]);
    expect(assigned.untimed?.sessions[0].speakers).toEqual([{ slug: "speaker", name: "Announced Speaker", photoUrl: null }]);
    const unrelatedProgrammes = addAnnouncedWeekProgrammes({ days: [] }, events, [], speakers).days
      .flatMap((day) => day.programmes).filter((programme) => programme.event.name !== "Angular Day");
    expect(unrelatedProgrammes.every((programme) => programme.untimed?.unassignedSpeakers === undefined)).toBe(true);
  });

  it("publishes confirmed event/session starts without inventing end times", () => {
    const sessions = ["requests-lies-and-stack-traces", "ddd-for-ai-assisted-development", "fundamentals-of-native-ios-development"]
      .map((slug): SessionRecord => ({ id: slug, slug, title: slug, abstract: "", created: "", updated: "", collectionId: "sessions", collectionName: "sessions", published: true, speakers: [] }));
    const result = addAnnouncedWeekProgrammes({ days: [] }, events, sessions, []);
    const programmes = result.days.flatMap((day) => day.programmes);
    expect(programmes.map((programme) => [programme.event.name, programme.untimed?.startTime, programme.untimed?.endTime])).toEqual([
      ["InfoSec Monday", "14:00", "18:00"],
      ["Workshop Tuesday: iOS + AI", "16:00", undefined],
      ["DevFest", "17:00", undefined],
      ["MAUI Day", "10:00", undefined],
      ["Workshop Thursday", undefined, undefined],
      ["Angular Day", undefined, undefined],
    ]);
    const monday = programmes[0].untimed!.sessions[0].schedule!;
    expect(monday.startAt).toBe("2026-09-14T14:00:00+02:00");
    expect(monday.endAt).toBe("2026-09-14T18:00:00+02:00");
    expect(Date.parse(monday.endAt!) - Date.parse(monday.startAt)).toBe(4 * 60 * 60 * 1000);
    const tuesday = programmes[1].untimed!.sessions;
    expect(tuesday.map((session) => [session.slug, session.schedule?.startAt, session.schedule?.endAt])).toEqual([
      ["ddd-for-ai-assisted-development", "2026-09-15T16:00:00+02:00", undefined],
      ["fundamentals-of-native-ios-development", "2026-09-15T18:00:00+02:00", undefined],
    ]);
    expect(tuesday.every((session) => session.schedule?.locationLabel === "Base42 Hackerspace, Rimska 25, 1000 Skopje")).toBe(true);
    expect(conferenceWeekTracks[0].summary).toContain("four-hour");
    expect(conferenceWeekTracks[0].summary).not.toContain("full-day");
  });

  it("times only Faris's Thursday workshop from 16:30 to 20:00", () => {
    const session: SessionRecord = {
      id: "faris-workshop", slug: "workshop-payments-and-monetization-at-scale-for-frontend-engineers",
      title: "Payments and Monetization at Scale for Frontend Engineers", abstract: "", speakers: [], published: true,
      created: "", updated: "", collectionId: "sessions", collectionName: "sessions",
    };
    const thursday = addAnnouncedWeekProgrammes({ days: [] }, events, [session], []).days[3];
    const programme = thursday.programmes.find((item) => item.event.name === "Workshop Thursday")!;
    expect(programme.untimed?.sessions[0].schedule).toMatchObject({
      dayDate: "2026-09-17", event: { name: "Workshop Thursday" },
      startAt: "2026-09-17T16:30:00+02:00", endAt: "2026-09-17T20:00:00+02:00",
    });
    const schedule = programme.untimed!.sessions[0].schedule!;
    expect(Date.parse(schedule.endAt!) - Date.parse(schedule.startAt)).toBe(12600000);
    expect(programme.untimed?.summary).toContain("16:30–20:00 (3.5 hours, Skopje time)");
    expect(programme.untimed?.startTime).toBeUndefined();
    expect(thursday.programmes[0].untimed?.startTime).toBe("10:00");
    const hidden = addAnnouncedWeekProgrammes({ days: [] }, events, [{ ...session, published: false }], []);
    expect(hidden.days[3].programmes[1].untimed?.sessions).toEqual([]);
  });

  it("adds Akshata's DevFest talk and Santosh's Angular talk using their published records", () => {
    const sessions = [
      { slug: "building-a-distributed-multi-agent-system", title: "Building a distributed multi-agent system with Google Cloud", speakers: ["akshata"], published: true },
      { slug: "the-monorepo-multiplier", title: "The Monorepo Multiplier: 10x Your Team with Better Architecture", speakers: ["santosh"], published: true },
      { slug: "a-brief-history-of-code-review", title: "Saturday talk", speakers: ["santosh"], published: true },
    ] as SessionRecord[];
    const speakers = [
      { id: "akshata", slug: "akshata-mohanty", display_name: "Akshata Mohanty", appearance_events: ["event-2"], published: true },
      { id: "santosh", slug: "santosh-yadav", display_name: "Santosh Yadav", appearance_events: ["event-5"], published: true },
    ] as SpeakerRecord[];
    const result = addAnnouncedWeekProgrammes({ days: [] }, events, sessions, speakers);
    const devfest = result.days[2].programmes[0].untimed!;
    const angular = result.days[4].programmes[0].untimed!;
    expect(devfest.sessions.map((session) => session.slug)).toEqual(["building-a-distributed-multi-agent-system"]);
    expect(devfest.sessions[0].speakers[0].name).toBe("Akshata Mohanty");
    expect(devfest.sessions[0].schedule).toBeUndefined();
    expect(angular.sessions.map((session) => session.slug)).toEqual(["the-monorepo-multiplier"]);
    expect(angular.sessions[0].speakers[0].name).toBe("Santosh Yadav");
    expect(angular.unassignedSpeakers).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("Saturday talk");
    const hidden = addAnnouncedWeekProgrammes({ days: [] }, events, sessions.map((session) => ({ ...session, published: false })), speakers);
    expect(hidden.days[2].programmes[0].untimed?.sessions).toEqual([]);
    expect(hidden.days[4].programmes[0].untimed?.unassignedSpeakers?.[0].name).toBe("Santosh Yadav");
  });

  it("does not publish hidden events or duplicate an existing timed programme", () => {
    expect(addAnnouncedWeekProgrammes({ days: [] }, events.map((event) => ({ ...event, published: false })), [], []).days).toEqual([]);
    const input: PublicAgenda = { days: [{ key: "monday", localDate: "2026-09-14", title: "Monday", programmes: [
      { event: { name: "InfoSec Monday", compactLabel: "InfoSec" }, tracks: [], slots: [
        { kind: "opening", startAt: "2026-09-14T08:00:00Z", endAt: "2026-09-14T08:10:00Z", title: "Opening" },
      ] },
    ] }] };
    expect(addAnnouncedWeekProgrammes(input, events, [], []).days[0]).toEqual(input.days[0]);
  });
});

describe("Conference week copy", () => {
  it("points the ticket call to action at the canonical tickets path", () => {
    expect(conferenceWeekCta.href).toBe(conferenceGuideContent.tickets.canonicalPath);
  });

  it("describes every track exactly once", () => {
    const names = conferenceWeekTracks.map((track) => track.name);

    expect(new Set(names).size).toBe(names.length);
    for (const track of conferenceWeekTracks) {
      expect(track.name.trim()).not.toBe("");
      expect(track.summary.trim()).not.toBe("");
    }
  });

  it("only links out over https and never to a bare placeholder", () => {
    for (const track of conferenceWeekTracks) {
      for (const href of [track.href, track.cta?.href]) {
        if (!href || href.startsWith("/")) continue;
        expect(href.startsWith("https://")).toBe(true);
        expect(() => new URL(href)).not.toThrow();
      }
    }
  });

  it("gives every pre-conference day a booking action", () => {
    const withCta = conferenceWeekTracks.filter((track) => track.cta);

    expect(withCta.map((track) => track.name)).toEqual([
      "InfoSec Monday",
      "Workshop Tuesday: iOS + AI",
      "DevFest",
      "MAUI Day",
      "Workshop Thursday",
      "Angular Day",
    ]);
    for (const track of withCta) {
      expect(track.cta!.label.trim()).not.toBe("");
      expect(
        track.cta!.href.startsWith("https://") ||
          track.cta!.href === conferenceWeekCta.href,
      ).toBe(true);

    }
  });

  it("describes Tuesday's confirmed sessions and requires a free reservation", () => {
    const tuesday = conferenceWeekTracks.find((track) => track.date === "2026-09-15");

    expect(tuesday?.name).toBe("Workshop Tuesday: iOS + AI");
    expect(tuesday?.summary).toContain("DDD for AI-Assisted Development at 16:00");
    expect(tuesday?.summary).toContain("Fundamentals of Native iOS Development at 18:00");
    expect(tuesday?.summary).toContain("Base42 Hackerspace");
    expect(tuesday?.access).toBe("Free entry. 50 seats; reserve your ticket.");
    expect(tuesday?.cta?.label).toBe("Reserve a free ticket");
  });

  it("links all cards and identifies the three free tickets in the real event checkout", () => {
    for (const track of conferenceWeekTracks) expect(track.href).toBeTruthy();
    const free = conferenceWeekTracks.filter((track) => ["InfoSec Monday", "Workshop Tuesday: iOS + AI", "Angular Day"].includes(track.name));
    expect(free.map((track) => track.access)).toEqual([
      "Free entry. 20 seats; one ticket covers InfoSec Monday and its workshop.",
      "Free entry. 50 seats; reserve your ticket.",
      "Free entry. 50 seats; reserve your ticket.",
    ]);
    expect(free.map((track) => track.freeTicketProductId)).toEqual([15, 16, 17]);
    for (const track of free) {
      expect(track.href).toBe(`/agenda?day=${track.date}`);
      expect(track.cta?.href).toBe("https://hievents.foundry.mk/event/5/whatthestack-2026");
      expect(track.cta?.label).toBe("Reserve a free ticket");
    }
    expect(JSON.stringify(conferenceWeekTracks)).not.toMatch(/registration opens|No ticket required|Included with your WTS ticket/);
  });

  it("spans the grid only for the main conference day", () => {
    const wide = conferenceWeekTracks.filter((track) => track.fullWidth);
    expect(wide.map((track) => track.name)).toEqual(["Main Conference Day"]);
  });

  it("labels every confirmed date with its real weekday", () => {
    const labels = conferenceWeekTracks
      .filter((track) => track.date)
      .map((track) => conferenceWeekDayLabel(track.date!));

    expect(labels).toEqual([
      "Monday 14 September",
      "Tuesday 15 September",
      "Wednesday 16 September",
      "Thursday 17 September",
      "Thursday 17 September",
      "Friday 18 September",
      "Saturday 19 September",
    ]);
  });

  it("keeps every track inside the announced week", () => {
    for (const track of conferenceWeekTracks) {
      if (!track.date) continue;
      expect(track.date >= "2026-09-14" && track.date <= "2026-09-19").toBe(true);
    }
  });

  it("ends the week on the conference date from the guide", () => {
    const last = conferenceWeekTracks[conferenceWeekTracks.length - 1];
    expect(last.date).toBe(conferenceGuideContent.event.date.localDate);
  });

  it("dates every track now that the week is confirmed", () => {
    for (const track of conferenceWeekTracks) {
      expect(track.date).toBeDefined();
    }
  });

  it("orders the week chronologically", () => {
    const dates = conferenceWeekTracks.map((track) => track.date!);
    expect(dates).toEqual([...dates].sort());
  });

  it("states either an entry note or an action for every announced track", () => {
    for (const track of conferenceWeekTracks) {
      // Unannounced days have nothing to state, and the main day is covered by
      // the section's own ticket call to action directly below the grid.
      if (track.placeholder || track.fullWidth) {
        expect(track.access).toBeUndefined();
        expect(track.cta).toBeUndefined();
        continue;
      }
      expect(Boolean(track.access?.trim() || track.cta)).toBe(true);
    }
  });

  it("covers all six days of the week", () => {
    expect(new Set(conferenceWeekTracks.map((track) => track.date)).size).toBe(6);
  });
});
