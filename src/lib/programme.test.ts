import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { runAuthorizedProgrammeOperation } from "~/lib/programme-admin-authorization";
import { buildPublicAgenda, derivePublicSessionSchedule } from "~/lib/programme-public";
import {
  type AgendaSlotInput,
  type ProgrammeValidationContext,
  scheduleInstantToLocalDateTime,
  validateAgendaSlot,
} from "~/lib/programme";

const timestamp = "2026-01-01 00:00:00.000Z";

function context(overrides: Partial<ProgrammeValidationContext> = {}): ProgrammeValidationContext {
  return {
    days: [
      { id: "day-1", key: "main-day", localDate: "2026-09-19", title: "Main day", displayOrder: 1, published: true },
      { id: "day-2", key: "after-hours", localDate: "2026-09-20", title: "After hours", displayOrder: 2, published: false },
    ],
    tracks: [
      { id: "track-main", dayId: "day-1", key: "main", name: "Main", displayOrder: 1 },
      { id: "track-side", dayId: "day-1", key: "side", name: "Side", displayOrder: 2 },
      { id: "track-next", dayId: "day-2", key: "next", name: "Next", displayOrder: 1 },
    ],
    sessions: [{ id: "session-1", published: true }, { id: "session-draft", published: false }],
    slots: [],
    ...overrides,
  };
}

function sessionSlot(overrides: Partial<AgendaSlotInput> = {}): AgendaSlotInput {
  return {
    dayId: "day-1",
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

  it("rejects a Track from another Conference Day and invalid Slot kind content", () => {
    expect(validateAgendaSlot(sessionSlot({ trackId: "track-next" }), context())).toMatchObject({
      success: false,
      error: expect.stringContaining("another Conference Day"),
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

  it("blocks same-Track and all-attendee overlaps, including a following Day", () => {
    const existing = {
      id: "all-attendee",
      dayId: "day-1",
      startAt: "2026-09-19T21:30:00.000Z",
      endAt: "2026-09-20T00:30:00.000Z",
      kind: "networking" as const,
      published: false,
      displayOrder: 1,
      title: "After party",
      summary: "All attendee event",
    };
    expect(validateAgendaSlot(sessionSlot({
      dayId: "day-2",
      trackId: "track-next",
      startAt: "2026-09-19T22:00:00.000Z",
      endAt: "2026-09-19T23:00:00.000Z",
    }), context({ slots: [existing] }))).toMatchObject({
      success: false,
      error: expect.stringContaining("all-attendee"),
    });

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

  it("requires a published Day and Slot, omits hidden Tracks, and allowlists public agenda fields", async () => {
    const agenda = buildPublicAgenda(
      [
        { id: "day-1", key: "main-day", local_date: "2026-09-19", title: "Main day", display_order: 1, published: true, private_note: "hide", created: timestamp, updated: timestamp },
        { id: "day-draft", key: "hidden-day", local_date: "2026-09-20", title: "Hidden Day", display_order: 2, published: false, created: timestamp, updated: timestamp },
      ] as any,
      [{ id: "track-1", day: "day-1", key: "main", name: "Main", location_label: "Hall A", display_order: 1, internal_note: "hide", created: timestamp, updated: timestamp } as any],
      [
        { id: "slot-1", day: "day-1", track: "track-1", start_at: "2026-09-19T08:00:00.000Z", end_at: "2026-09-19T09:00:00.000Z", kind: "session", published: true, display_order: 1, session: "session-1", title: "", summary: "", secret: "hide", created: timestamp, updated: timestamp },
        { id: "slot-2", day: "day-1", start_at: "2026-09-19T10:00:00.000Z", end_at: "2026-09-19T10:30:00.000Z", kind: "break", published: false, display_order: 1, title: "Draft break", summary: "hide", created: timestamp, updated: timestamp },
        { id: "slot-3", day: "day-draft", start_at: "2026-09-20T10:00:00.000Z", end_at: "2026-09-20T10:30:00.000Z", kind: "break", published: true, display_order: 1, title: "Hidden Day", summary: "hide", created: timestamp, updated: timestamp },
      ] as any,
      [{ id: "session-1", slug: "canonical-schedule", title: "Canonical schedule", abstract: "Public", format: "Talk", published: true, starts_at: "legacy-start", track: "Legacy Track", room: "Legacy Room", cfp_submission: "private", created: timestamp, updated: timestamp } as any],
    );

    expect(agenda).toEqual({
      days: [{
        key: "main-day",
        localDate: "2026-09-19",
        title: "Main day",
        slots: [{
          kind: "session",
          startAt: "2026-09-19T08:00:00.000Z",
          endAt: "2026-09-19T09:00:00.000Z",
          locationLabel: "Hall A",
          track: { key: "main", name: "Main", locationLabel: "Hall A" },
          session: { slug: "canonical-schedule", title: "Canonical schedule", format: "Talk" },
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
      { id: "slot-1", day: "day-1", track: "track-1", start_at: "2026-09-19T08:00:00.000Z", end_at: "2026-09-19T09:00:00.000Z", kind: "session", published: true, display_order: 1, session: "session-1", location_label: "Room from Slot", created: timestamp, updated: timestamp } as any,
      new Map([["day-1", { id: "day-1", key: "main-day", local_date: "2026-09-19", title: "Main day", display_order: 1, published: true, created: timestamp, updated: timestamp } as any]]),
      new Map([["track-1", { id: "track-1", day: "day-1", key: "main", name: "Main", location_label: "Track room", display_order: 1, created: timestamp, updated: timestamp } as any]]),
    );

    expect(schedule).toEqual({
      dayDate: "2026-09-19",
      dayTitle: "Main day",
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
