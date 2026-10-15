import { describe, expect, it, vi } from "vite-plus/test";
import { SCHEDULE_TIME_ZONE, scheduleInstantToLocalDateTime, scheduleLocalDate, scheduleLocalDateTimeToInstant, validateAgendaSlot } from "~/lib/programme";

vi.mock("~/lib/conference-guide-content", async (importOriginal) => {
  const original = await importOriginal<typeof import("~/lib/conference-guide-content")>();
  return { ...original, conferenceTimeZone: undefined };
});


describe("programme scheduling before the time zone is announced", () => {
  it("does not fall back to the host time zone for date or clock conversions", () => {
    expect(SCHEDULE_TIME_ZONE).toBeUndefined();
    expect(scheduleLocalDate("2027-05-01T12:00:00.000Z")).toBeNull();
    expect(scheduleInstantToLocalDateTime("2027-05-01T12:00:00.000Z")).toBeNull();
    expect(() => scheduleLocalDateTimeToInstant("2027-05-01T14:00")).toThrow(/time zone.*announced/i);
  });

  it("does not validate timed slots against the machine's local zone", () => {
    const result = validateAgendaSlot({
      programmeId: "programme",
      startAt: "2027-05-01T12:00:00.000Z",
      endAt: "2027-05-01T13:00:00.000Z",
      kind: "session",
      displayOrder: 1,
    }, {
      events: [], days: [], programmes: [], tracks: [], sessions: [], speakers: [], slots: [],
    });

    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/time zone.*announced/i) });
  });
});
