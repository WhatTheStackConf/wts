import { describe, expect, it } from "vite-plus/test";
import { conferenceGuideContent } from "~/lib/conference-guide-content";
import {
  conferenceWeekCta,
  conferenceWeekDayLabel,
  conferenceWeekTracks,
} from "~/lib/conference-week";

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
      "Workshop Tuesday: Frontend",
      "DevFest",
      "MAUI Day",
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
