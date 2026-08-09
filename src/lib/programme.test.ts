import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { runAuthorizedProgrammeOperation } from "~/lib/programme-admin-authorization";
import { buildPublicAgenda, derivePublicSessionSchedule } from "~/lib/programme-public";
import {
  type AgendaSlotInput,
  type ProgrammeValidationContext,
  scheduleInstantToLocalDateTime,
  validateAgendaSlot,
  validateAgendaSlotPublication,
} from "~/lib/programme";

const timestamp = "2026-01-01 00:00:00.000Z";

function context(overrides: Partial<ProgrammeValidationContext> = {}): ProgrammeValidationContext {
  return {
    events: [
      { id: "event-main", name: "WhatTheStack 2026", published: true },
      { id: "event-warmup", name: "Warmup", published: true },
    ],
    days: [
      { id: "day-1", key: "main-day", localDate: "2026-09-19", title: "Main day", displayOrder: 1, published: true },
      { id: "day-2", key: "after-hours", localDate: "2026-09-20", title: "After hours", displayOrder: 2, published: false },
    ],
    programmes: [
      { id: "programme-main", dayId: "day-1", appearanceEventId: "event-main", displayOrder: 1 },
      { id: "programme-warmup", dayId: "day-1", appearanceEventId: "event-warmup", displayOrder: 2 },
      { id: "programme-next", dayId: "day-2", appearanceEventId: "event-main", displayOrder: 1 },
    ],
    tracks: [
      { id: "track-main", programmeId: "programme-main", key: "main", name: "Main", displayOrder: 1 },
      { id: "track-side", programmeId: "programme-main", key: "side", name: "Side", displayOrder: 2 },
      { id: "track-warmup", programmeId: "programme-warmup", key: "warmup", name: "Warmup", displayOrder: 1 },
      { id: "track-next", programmeId: "programme-next", key: "next", name: "Next", displayOrder: 1 },
    ],
    sessions: [
      { id: "session-1", published: true, speakerIds: ["speaker-1"] },
      { id: "session-draft", published: false, speakerIds: [] },
    ],
    speakers: [{ id: "speaker-1", appearanceEventIds: ["event-main"] }],
    slots: [],
    ...overrides,
  };
}

function sessionSlot(overrides: Partial<AgendaSlotInput> = {}): AgendaSlotInput {
  return {
    programmeId: "programme-main",
    trackId: "track-main",
    startAt: "2026-09-19T08:00:00.000Z",
    endAt: "2026-09-19T09:00:00.000Z",
    kind: "session",
    displayOrder: 1,
    sessionId: "session-1",
    ...overrides,
  };
}

describe("programme schedule validation", () => {
  it("formats Agenda Slot context for Session Mission configuration in Europe/Skopje", () => {
    expect(scheduleInstantToLocalDateTime("2026-09-19T08:00:00.000Z")).toBe("2026-09-19T10:00");
    expect(scheduleInstantToLocalDateTime("not-an-instant")).toBeNull();
  });

  it("requires Published parents and explicit Event Appearances before publishing a Session Slot", () => {
    const slot = {
      id: "slot-1",
      programmeId: "programme-main",
      trackId: "track-main",
      startAt: "2026-09-19T08:00:00.000Z",
      endAt: "2026-09-19T09:00:00.000Z",
      kind: "session" as const,
      published: false,
      displayOrder: 1,
      sessionId: "session-1",
    };

    expect(validateAgendaSlotPublication(slot, context())).toBeNull();
    expect(validateAgendaSlotPublication(slot, context({
      speakers: [{ id: "speaker-1", appearanceEventIds: [] }],
    }))).toContain("Event Appearance");
    expect(validateAgendaSlotPublication(slot, context({
      events: [{ id: "event-main", name: "WhatTheStack 2026", published: false }],
    }))).toContain("Appearance Event");
  });

  it("uses Europe/Skopje local day boundaries and permits late slots after midnight", () => {
    expect(validateAgendaSlot(sessionSlot({
      startAt: "2026-09-18T22:30:00.000Z",
      endAt: "2026-09-19T23:30:00.000Z",
    }), context())).toMatchObject({ success: true });

    expect(validateAgendaSlot(sessionSlot({
      startAt: "2026-09-18T21:30:00.000Z",
      endAt: "2026-09-18T22:30:00.000Z",
    }), context())).toMatchObject({
      success: false,
      error: expect.stringContaining("2026-09-19"),
    });
  });

  it("rejects a Track from another Event Programme and invalid Slot kind content", () => {
    expect(validateAgendaSlot(sessionSlot({ trackId: "track-warmup" }), context())).toMatchObject({
      success: false,
      error: expect.stringContaining("another Event Programme"),
    });
    expect(validateAgendaSlot(sessionSlot({ sessionId: "" }), context())).toMatchObject({
      success: false,
      error: expect.stringContaining("select one Session"),
    });
    expect(validateAgendaSlot(sessionSlot({
      kind: "break",
      sessionId: "session-1",
      title: "Coffee",
      summary: "Coffee break",
    }), context())).toMatchObject({
      success: false,
      error: expect.stringContaining("cannot select a Session"),
    });
  });

  it("scopes Track and Programme-wide overlaps to one Event Programme", () => {
    const existing = {
      id: "programme-wide",
      programmeId: "programme-main",
      startAt: "2026-09-19T08:00:00.000Z",
      endAt: "2026-09-19T09:00:00.000Z",
      kind: "networking" as const,
      published: false,
      displayOrder: 1,
      title: "Opening",
      summary: "Programme-wide opening",
    };
    expect(validateAgendaSlot(sessionSlot(), context({ slots: [existing] }))).toMatchObject({
      success: false,
      error: expect.stringContaining("Programme-wide"),
    });

    expect(validateAgendaSlot(sessionSlot({
      programmeId: "programme-warmup",
      trackId: "track-warmup",
    }), context({ slots: [existing] }))).toMatchObject({ success: true });

    const mainTrackSlot = { ...existing, id: "main-session", trackId: "track-main", kind: "session" as const, sessionId: "session-1", title: undefined, summary: undefined, startAt: "2026-09-19T08:00:00.000Z", endAt: "2026-09-19T09:00:00.000Z" };
    expect(validateAgendaSlot(sessionSlot(), context({ slots: [mainTrackSlot] }))).toMatchObject({ success: false });
    expect(validateAgendaSlot(sessionSlot({ trackId: "track-side" }), context({ slots: [mainTrackSlot] }))).toMatchObject({ success: true });
  });
});

describe("public agenda DTOs", () => {
  it("denies raw PocketBase Speaker and Session reads so public data must use DTOs", () => {
    const migration = readFileSync(
      new URL("../../pocketbase/pb_migrations/1786000010_harden_programme_api_rules.js", import.meta.url),
      "utf8",
    );

    expect(migration).toContain('for (const name of ["speakers", "sessions"])');
    for (const rule of ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"]) {
      expect(migration).toContain(`collection.${rule} = null;`);
    }
  });

  it("groups Slots by Event Programme and requires a published Event, Day, and Slot", async () => {
    const agenda = buildPublicAgenda(
      [
        { id: "day-1", key: "main-day", local_date: "2026-09-19", title: "Main day", display_order: 1, published: true, private_note: "hide", created: timestamp, updated: timestamp },
        { id: "day-draft", key: "hidden-day", local_date: "2026-09-20", title: "Hidden Day", display_order: 2, published: false, created: timestamp, updated: timestamp },
      ] as any,
      [
        { id: "event-main", name: "WhatTheStack 2026", compact_label: "WTS 2026", destination_url: "https://wts.sh", display_order: 1, published: true, created: timestamp, updated: timestamp },
        { id: "event-hidden", name: "Hidden event", display_order: 2, published: false, created: timestamp, updated: timestamp },
      ] as any,
      [
        { id: "programme-main", day: "day-1", appearance_event: "event-main", display_order: 1, created: timestamp, updated: timestamp },
        { id: "programme-hidden-event", day: "day-1", appearance_event: "event-hidden", display_order: 2, created: timestamp, updated: timestamp },
        { id: "programme-hidden-day", day: "day-draft", appearance_event: "event-main", display_order: 1, created: timestamp, updated: timestamp },
      ] as any,
      [{ id: "track-1", programme: "programme-main", key: "main", name: "Main", location_label: "Hall A", display_order: 1, internal_note: "hide", created: timestamp, updated: timestamp } as any],
      [
        { id: "slot-1", programme: "programme-main", track: "track-1", start_at: "2026-09-19T08:00:00.000Z", end_at: "2026-09-19T09:00:00.000Z", kind: "session", published: true, display_order: 1, session: "session-1", title: "", summary: "", secret: "hide", created: timestamp, updated: timestamp },
        { id: "slot-2", programme: "programme-main", start_at: "2026-09-19T10:00:00.000Z", end_at: "2026-09-19T10:30:00.000Z", kind: "break", published: false, display_order: 1, title: "Draft break", summary: "hide", created: timestamp, updated: timestamp },
        { id: "slot-3", programme: "programme-hidden-day", start_at: "2026-09-20T10:00:00.000Z", end_at: "2026-09-20T10:30:00.000Z", kind: "break", published: true, display_order: 1, title: "Hidden Day", summary: "hide", created: timestamp, updated: timestamp },
        { id: "slot-4", programme: "programme-hidden-event", start_at: "2026-09-19T11:00:00.000Z", end_at: "2026-09-19T11:30:00.000Z", kind: "break", published: true, display_order: 1, title: "Hidden Event", summary: "hide", created: timestamp, updated: timestamp },
      ] as any,
      [{ id: "session-1", slug: "canonical-schedule", title: "Canonical schedule", abstract: "Public", format: "Talk", published: true, starts_at: "legacy-start", track: "Legacy Track", room: "Legacy Room", cfp_submission: "private", created: timestamp, updated: timestamp } as any],
    );

    expect(agenda).toEqual({
      days: [{
        key: "main-day",
        localDate: "2026-09-19",
        title: "Main day",
        programmes: [{
          event: {
            name: "WhatTheStack 2026",
            compactLabel: "WTS 2026",
            destinationUrl: "https://wts.sh",
          },
          slots: [{
            kind: "session",
            startAt: "2026-09-19T08:00:00.000Z",
            endAt: "2026-09-19T09:00:00.000Z",
            locationLabel: "Hall A",
            track: { key: "main", name: "Main", locationLabel: "Hall A" },
            session: { slug: "canonical-schedule", title: "Canonical schedule", format: "Talk" },
          }],
        }],
      }],
    });
    expect(JSON.stringify(agenda)).not.toContain("legacy-start");
    expect(JSON.stringify(agenda)).not.toContain("private");
    expect(JSON.stringify(agenda)).not.toContain("secret");
  });

  it("derives Session schedule context from its published Agenda Slot, not legacy Session fields", () => {
    const session = {
      id: "session-1", slug: "canonical-schedule", title: "Canonical schedule", abstract: "Public", format: "Talk", published: true,
      starts_at: "legacy-start", track: "Legacy Track", room: "Legacy Room", cfp_submission: "private", speakers: [], created: timestamp, updated: timestamp,
    };
    const schedule = derivePublicSessionSchedule(
      { id: "slot-1", programme: "programme-main", track: "track-1", start_at: "2026-09-19T08:00:00.000Z", end_at: "2026-09-19T09:00:00.000Z", kind: "session", published: true, display_order: 1, session: "session-1", location_label: "Room from Slot", created: timestamp, updated: timestamp } as any,
      new Map([["programme-main", { id: "programme-main", day: "day-1", appearance_event: "event-main", display_order: 1, created: timestamp, updated: timestamp } as any]]),
      new Map([["event-main", { id: "event-main", name: "WhatTheStack 2026", compact_label: "WTS 2026", destination_url: "https://wts.sh", display_order: 1, published: true, created: timestamp, updated: timestamp } as any]]),
      new Map([["day-1", { id: "day-1", key: "main-day", local_date: "2026-09-19", title: "Main day", display_order: 1, published: true, created: timestamp, updated: timestamp } as any]]),
      new Map([["track-1", { id: "track-1", programme: "programme-main", key: "main", name: "Main", location_label: "Track room", display_order: 1, created: timestamp, updated: timestamp } as any]]),
    );

    expect(schedule).toEqual({
      dayDate: "2026-09-19",
      dayTitle: "Main day",
      event: {
        name: "WhatTheStack 2026",
        compactLabel: "WTS 2026",
        destinationUrl: "https://wts.sh",
      },
      startAt: "2026-09-19T08:00:00.000Z",
      endAt: "2026-09-19T09:00:00.000Z",
      trackName: "Main",
      locationLabel: "Room from Slot",
    });
    expect(JSON.stringify(schedule)).not.toContain("legacy-start");
    expect(JSON.stringify(schedule)).not.toContain("Legacy Track");
    expect(JSON.stringify(schedule)).not.toContain("Legacy Room");
  });
});

describe("programme admin authorization", () => {
  it("does not access PocketBase when the request is not an admin", async () => {
    const operation = vi.fn();
    await expect(runAuthorizedProgrammeOperation(
      async () => { throw new Error("Unauthorized: Admin access required"); },
      operation,
    )).rejects.toThrow("Unauthorized: Admin access required");
    expect(operation).not.toHaveBeenCalled();
  });
});
