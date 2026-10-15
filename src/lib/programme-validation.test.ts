import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("~/lib/conference-guide-content", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/conference-guide-content")>()),
  conferenceTimeZone: "Europe/Skopje",
}));

import {
  type AgendaSlotInput,
  type ProgrammeValidationContext,
  scheduleLocalDateTimeToInstant,
  validateAgendaSlot,
} from "~/lib/programme";

const context: ProgrammeValidationContext = {
  events: [{ id: "event-main", name: "Main", published: true }],
  days: [{ id: "day-1", key: "main-day", localDate: "2026-09-19", title: "Main day", displayOrder: 1, published: true }],
  programmes: [
    { id: "programme-main", dayId: "day-1", appearanceEventId: "event-main", displayOrder: 1 },
    { id: "programme-other", dayId: "day-1", appearanceEventId: "event-main", displayOrder: 2 },
    { id: "programme-orphan", dayId: "day-missing", appearanceEventId: "event-main", displayOrder: 3 },
  ],
  tracks: [
    { id: "track-main", programmeId: "programme-main", key: "main", name: "Main", displayOrder: 1 },
    { id: "track-other", programmeId: "programme-other", key: "other", name: "Other", displayOrder: 1 },
  ],
  sessions: [{ id: "session-1", published: true, speakerIds: [] }],
  speakers: [],
  slots: [],
};

function slot(overrides: Partial<AgendaSlotInput> = {}): AgendaSlotInput {
  return {
    programmeId: " programme-main ",
    trackId: " track-main ",
    startAt: " 2026-09-19T08:00:00.000Z ",
    endAt: "2026-09-19T09:00:00.000Z",
    kind: "session",
    displayOrder: 1,
    sessionId: " session-1 ",
    ...overrides,
  };
}

describe("validateAgendaSlot", () => {
  it.each<[string, Partial<AgendaSlotInput>, string]>([
    ["unknown programme", { programmeId: "nope" }, "Choose a valid Event Programme."],
    ["programme without day", { programmeId: "programme-orphan" }, "The Event Programme must belong to a valid Conference Day."],
    ["unknown kind", { kind: "party" as AgendaSlotInput["kind"] }, "Choose a valid Slot kind."],
    ["fractional display order", { displayOrder: 1.5 }, "Display order must be a whole number."],
    ["non-ISO start", { startAt: "2026-09-19 08:00" }, "Slot times must be ISO instants."],
    ["non-ISO end", { endAt: "tomorrow" }, "Slot times must be ISO instants."],
    ["end before start", { endAt: "2026-09-19T08:00:00.000Z" }, "Slot end time must be after its start time."],
    ["start on another local day", { startAt: "2026-09-18T21:00:00.000Z" }, "Slot start time must fall on 2026-09-19 in Europe/Skopje."],
    ["unknown track", { trackId: "track-nope" }, "Choose a valid Track."],
    ["track from another programme", { trackId: "track-other" }, "The selected Track belongs to another Event Programme."],
    ["session slot without session", { sessionId: "missing" }, "A Session Slot must select one Session."],
    ["session slot with title", { title: "Title" }, "Session Slots use their linked Session title and abstract."],
    ["session slot with summary", { summary: "Summary" }, "Session Slots use their linked Session title and abstract."],
    ["break with session", { kind: "break", title: "Coffee", summary: "Coffee" }, "Non-Session Slots cannot select a Session."],
    ["break without summary", { kind: "break", sessionId: "", title: "Coffee" }, "Non-Session Slots require both a title and summary."],
    ["break without title", { kind: "break", sessionId: "", summary: "Coffee" }, "Non-Session Slots require both a title and summary."],
  ])("rejects %s", (_name, overrides, error) => {
    expect(validateAgendaSlot(slot(overrides), context)).toEqual({ success: false, error });
  });

  it("returns the trimmed candidate for a valid Session Slot", () => {
    expect(validateAgendaSlot(slot({ published: 1 as unknown as boolean, locationLabel: "  Hall  " }), context, "slot-9")).toEqual({
      success: true,
      data: {
        id: "slot-9",
        programmeId: "programme-main",
        trackId: "track-main",
        startAt: "2026-09-19T08:00:00.000Z",
        endAt: "2026-09-19T09:00:00.000Z",
        kind: "session",
        published: true,
        displayOrder: 1,
        locationLabel: "Hall",
        sessionId: "session-1",
        title: undefined,
        summary: undefined,
      },
    });
  });

  it("returns a Programme-wide non-Session candidate with blank fields as undefined", () => {
    expect(validateAgendaSlot(slot({ kind: "break", trackId: "  ", sessionId: undefined, title: " Coffee ", summary: "Refill" }), context)).toEqual({
      success: true,
      data: {
        id: "",
        programmeId: "programme-main",
        trackId: undefined,
        startAt: "2026-09-19T08:00:00.000Z",
        endAt: "2026-09-19T09:00:00.000Z",
        kind: "break",
        published: false,
        displayOrder: 1,
        locationLabel: undefined,
        sessionId: undefined,
        title: "Coffee",
        summary: "Refill",
      },
    });
  });

  it("checks overlaps only within the same programme and ignores the slot being edited", () => {
    const existing = { id: "slot-1", programmeId: "programme-main", trackId: undefined, startAt: "2026-09-19T08:30:00.000Z", endAt: "2026-09-19T09:30:00.000Z", kind: "break" as const, published: true, displayOrder: 1 };
    const overlapError = { success: false, error: "This Slot overlaps a Programme-wide Slot or another Slot in the same Track." };
    expect(validateAgendaSlot(slot(), { ...context, slots: [existing] })).toEqual(overlapError);
    expect(validateAgendaSlot(slot(), { ...context, slots: [existing] }, "slot-1")).toMatchObject({ success: true });
    expect(validateAgendaSlot(slot(), { ...context, slots: [{ ...existing, programmeId: "programme-other" }] })).toMatchObject({ success: true });
    expect(validateAgendaSlot(slot(), { ...context, slots: [{ ...existing, startAt: "2026-09-19T09:00:00.000Z" }] })).toMatchObject({ success: true });
    expect(validateAgendaSlot(slot({ trackId: "" }), { ...context, slots: [{ ...existing, trackId: "track-main" }] })).toEqual(overlapError);
    expect(validateAgendaSlot(slot(), { ...context, slots: [{ ...existing, trackId: "track-side" }] })).toMatchObject({ success: true });
  });
});

describe("scheduleLocalDateTimeToInstant", () => {
  it("converts Europe/Skopje local times to instants", () => {
    expect(scheduleLocalDateTimeToInstant("2026-09-19T10:00")).toBe("2026-09-19T08:00:00.000Z");
    expect(scheduleLocalDateTimeToInstant("2026-01-10T23:59:30")).toBe("2026-01-10T22:59:00.000Z");
  });

  it.each([
    ["2026-09-19 10:00", "Enter a valid conference-local date and time."],
    ["2026-02-30T10:00", "Enter a valid conference-local date and time."],
    ["2026-09-19T24:00", "Enter a valid conference-local date and time."],
    ["2026-09-19T10:60", "Enter a valid conference-local date and time."],
    ["2026-03-29T02:30", "This local time does not exist in Europe/Skopje."],
    ["2026-10-25T02:30", "This local time is ambiguous in Europe/Skopje. Choose a different time."],
  ])("rejects %s", (value, message) => {
    expect(() => scheduleLocalDateTimeToInstant(value)).toThrow(new Error(message));
  });
});
