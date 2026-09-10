import { describe, expect, it } from "vite-plus/test";
import { getConferenceWeekSpeakers } from "~/lib/conference-week-speakers";
import type { PublicSpeakerSummary } from "~/lib/speakers-public";

function speaker(slug: string, displayName: string, events: string[]): PublicSpeakerSummary {
  return {
    slug,
    displayName,
    photoUrl: null,
    affiliation: "",
    sessionCount: 0,
    appearanceEvents: events.map((name) => ({ name, compactLabel: name })),
  };
}

describe("conference week speaker lineups", () => {
  it("leaves the wide main-day card to its programme topics rather than dumping the roster", () => {
    const mainDaySpeaker = speaker("main-day", "Main Day Speaker", ["Main Conference Day"]);
    expect(getConferenceWeekSpeakers({ name: "Main Conference Day", fullWidth: true }, [mainDaySpeaker]))
      .toEqual([]);
  });

  it("returns no names for absent rosters, empty rosters or events without members", () => {
    expect(getConferenceWeekSpeakers({ name: "InfoSec Monday" })).toEqual([]);
    expect(getConferenceWeekSpeakers({ name: "InfoSec Monday" }, [])).toEqual([]);
    expect(getConferenceWeekSpeakers({ name: "InfoSec Monday" }, [
      speaker("unassigned", "Unassigned", []),
      speaker("main-day", "Main Day", ["Main Conference Day"]),
    ])).toEqual([]);
  });

  it("uses the published Workshop Tuesday membership behind the homepage title", () => {
    const member = speaker("ios-speaker", "Tuesday Speaker", ["Workshop Tuesday"]);
    const unrelated = speaker("thursday-speaker", "Thursday Speaker", ["Workshop Thursday"]);

    expect(getConferenceWeekSpeakers({ name: "Workshop Tuesday: iOS + AI" }, [member, unrelated]))
      .toEqual([member]);
  });

  it("includes all published event members without sessions, once each in display-name order", () => {
    const zoe = speaker("zoe", "Zoe Example", ["DevFest", "Main Conference Day"]);
    const newlyPublished = speaker("new-speaker", "Ana New", ["DevFest"]);
    const unrelated = speaker("other", "Other Speaker", ["MAUI Day"]);
    const roster = [zoe, newlyPublished, unrelated, zoe];

    expect(getConferenceWeekSpeakers({ name: "DevFest" }, roster)).toEqual([
      newlyPublished,
      zoe,
    ]);
    expect(roster).toEqual([zoe, newlyPublished, unrelated, zoe]);
  });
});
