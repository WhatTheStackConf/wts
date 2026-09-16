import { describe, expect, it } from "vite-plus/test";
import { buildMissionCatalogue } from "~/lib/mission-catalogue";

const now = "2026-09-19T08:00:00.000Z";
const mission = { id: "mission", title: "Explore WTS", summary: "Scan its official code.", category: "social", status: "active", visibility: "public", starts_at: "2026-09-19T07:00:00.000Z", ends_at: "2026-09-19T17:00:00.000Z" };
const activity = { id: "activity", mission: "mission", status: "active", enabled: true, active_from: mission.starts_at, active_until: mission.ends_at };
const code = { activity: "activity", status: "active", enabled: true, starts_at: mission.starts_at, ends_at: mission.ends_at };

it("lists organizer-published code missions without exposing evidence or answer keys", () => {
  expect(buildMissionCatalogue([mission], [activity], [code], now)).toEqual([{
    title: "Explore WTS", summary: "Scan its official code.", category: "social", state: "open", opensAt: mission.starts_at,
  }]);
});

describe("Mission catalogue availability", () => {
  it("does not advertise hidden, draft, retired, disabled, expired or unregistered missions", () => {
    for (const hidden of [{ visibility: "hidden_until_unlocked" }, { visibility: "admin_only" }, { status: "draft" }, { status: "retired" }, { ends_at: "2026-09-19T07:59:00.000Z" }]) {
      expect(buildMissionCatalogue([{ ...mission, ...hidden }], [activity], [code], now)).toEqual([]);
    }
    expect(buildMissionCatalogue([mission], [{ ...activity, enabled: false }], [code], now)).toEqual([]);
    expect(buildMissionCatalogue([mission], [activity], [], now)).toEqual([]);
    expect(buildMissionCatalogue([mission], [activity], [{ ...code, status: "disabled" }], now)).toEqual([]);
    expect(buildMissionCatalogue([mission], [activity], [{ ...code, ends_at: "2026-09-19T07:59:00.000Z" }], now)).toEqual([]);
  });

  it("labels future code windows as upcoming instead of implying they are playable now", () => {
    expect(buildMissionCatalogue([mission], [activity], [{ ...code, starts_at: "2026-09-19T12:00:00.000Z" }], now)[0]).toMatchObject({ state: "upcoming", opensAt: "2026-09-19T12:00:00.000Z" });
  });

  it("requires a nonempty intersection of mission, activity and code windows", () => {
    expect(buildMissionCatalogue([mission], [activity], [{ ...code, starts_at: "2026-09-20T12:00:00.000Z" }], now)).toEqual([]);
    expect(buildMissionCatalogue([mission], [{ ...activity, active_from: "invalid" }], [code], now)).toEqual([]);
  });
});
