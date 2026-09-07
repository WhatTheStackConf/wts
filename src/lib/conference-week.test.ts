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
      { slug: "fundamentals-of-native-ios-development", title: "iOS", format: undefined, speakers: [{ slug: "mia", name: "Mia" }] },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/private|cfp_submission|Saturday only|"DDD"/);
    expect(result.days[1].programmes[0].untimed?.access).toBe("Free entry. No ticket required.");
    expect(result.days[1].programmes[0].untimed?.cta).toBeUndefined();
    expect(untimedWeekProgrammes.flatMap((definition) => [...definition.sessions])).toHaveLength(14);
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

  it("gives every separate-entry day an action rather than a note", () => {
    const withCta = conferenceWeekTracks.filter((track) => track.cta);

    expect(withCta.map((track) => track.name)).toEqual([
      "DevFest",
      "MAUI Day",
      "Workshop Thursday",
    ]);
    for (const track of withCta) {
      expect(track.cta!.label.trim()).not.toBe("");
      expect(
        track.cta!.href.startsWith("https://") ||
          track.cta!.href === conferenceWeekCta.href,
      ).toBe(true);
      // An action replaces the note; showing both would state entry twice.
      expect(track.access).toBeUndefined();
    }
  });

  it("describes Tuesday as a free iOS workshop plus an AI talk without a ticket CTA", () => {
    const tuesday = conferenceWeekTracks.find((track) => track.date === "2026-09-15");

    expect(tuesday?.name).toBe("Workshop Tuesday: iOS + AI");
    expect(tuesday?.summary).toBe("An iOS workshop plus an AI talk.");
    expect(tuesday?.access).toBe("Free entry. No ticket required.");
    expect(tuesday?.cta).toBeUndefined();
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
