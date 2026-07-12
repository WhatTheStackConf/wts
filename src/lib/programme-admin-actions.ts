import { getAdminPB } from "~/lib/pocketbase-admin-service";
import { requireAdmin } from "~/lib/server-auth";
import { runAuthorizedProgrammeOperation } from "~/lib/programme-admin-authorization";
import {
  normalizedDisplayOrder,
  normalizedProgrammeText,
  type AgendaSlotInput,
  type ProgrammeDayRef,
  type ProgrammeSessionRef,
  type ProgrammeSlotRef,
  type ProgrammeTrackRef,
  type ProgrammeValidationContext,
  validateAgendaSlot,
  validateProgrammeDate,
  validateProgrammeKey,
} from "~/lib/programme";
import type {
  AgendaSlotKind,
  AgendaSlotRecord,
  AgendaTrackRecord,
  ConferenceDayRecord,
  SessionRecord,
} from "~/lib/pocketbase-types";

export interface ConferenceDayInput {
  key: string;
  localDate: string;
  title: string;
  displayOrder: number;
}

export interface ConferenceDayUpdateInput {
  localDate: string;
  title: string;
  displayOrder: number;
}

export interface AgendaTrackInput {
  dayId: string;
  key: string;
  name: string;
  locationLabel?: string;
  displayOrder: number;
}

export interface AgendaTrackUpdateInput {
  name: string;
  locationLabel?: string;
  displayOrder: number;
}

export interface AdminAgendaSlotInput {
  dayId: string;
  trackId?: string;
  startAt: string;
  endAt: string;
  kind: AgendaSlotKind;
  displayOrder: number;
  locationLabel?: string;
  sessionId?: string;
  title?: string;
  summary?: string;
}

export interface AdminProgrammeData {
  days: ProgrammeDayRef[];
  tracks: ProgrammeTrackRef[];
  slots: ProgrammeSlotRef[];
  sessions: Array<{ id: string; title: string; slug: string; published: boolean }>;
}

function actionError(error: unknown): string {
  const data = (error as { response?: { data?: Record<string, { message?: string }> } })?.response?.data;
  if (data) {
    const messages = Object.values(data)
      .map((item) => item?.message)
      .filter((message): message is string => Boolean(message));
    if (messages.length > 0) return messages.join("; ");
  }
  return error instanceof Error && error.message ? error.message : "Request failed.";
}

async function authorizeProgrammeAdmin(): Promise<void> {
  await runAuthorizedProgrammeOperation(requireAdmin, async () => undefined);
}

function dayRef(record: ConferenceDayRecord): ProgrammeDayRef {
  return {
    id: record.id,
    key: record.key,
    localDate: record.local_date,
    title: record.title,
    displayOrder: Number(record.display_order),
    published: Boolean(record.published),
  };
}

function trackRef(record: AgendaTrackRecord): ProgrammeTrackRef {
  return {
    id: record.id,
    dayId: record.day,
    key: record.key,
    name: record.name,
    locationLabel: record.location_label || undefined,
    displayOrder: Number(record.display_order),
  };
}

function slotRef(record: AgendaSlotRecord): ProgrammeSlotRef {
  return {
    id: record.id,
    dayId: record.day,
    trackId: record.track || undefined,
    startAt: record.start_at,
    endAt: record.end_at,
    kind: record.kind,
    published: Boolean(record.published),
    displayOrder: Number(record.display_order),
    locationLabel: record.location_label || undefined,
    sessionId: record.session || undefined,
    title: record.title || undefined,
    summary: record.summary || undefined,
  };
}

function sessionRef(record: SessionRecord): ProgrammeSessionRef {
  return { id: record.id, published: Boolean(record.published) };
}

function slotInput(record: ProgrammeSlotRef): AgendaSlotInput {
  return {
    dayId: record.dayId,
    trackId: record.trackId,
    startAt: record.startAt,
    endAt: record.endAt,
    kind: record.kind,
    published: record.published,
    displayOrder: record.displayOrder,
    locationLabel: record.locationLabel,
    sessionId: record.sessionId,
    title: record.title,
    summary: record.summary,
  };
}

async function programmeContext(): Promise<ProgrammeValidationContext> {
  const admin = getAdminPB();
  const [days, tracks, sessions, slots] = await Promise.all([
    admin.fetchAllRecords("conference_days"),
    admin.fetchAllRecords("agenda_tracks"),
    admin.fetchAllRecords("sessions", { fields: "id,published" }),
    admin.fetchAllRecords("agenda_slots"),
  ]);
  return {
    days: (days as ConferenceDayRecord[]).map(dayRef),
    tracks: (tracks as AgendaTrackRecord[]).map(trackRef),
    sessions: (sessions as SessionRecord[]).map(sessionRef),
    slots: (slots as AgendaSlotRecord[]).map(slotRef),
  };
}

function validateDayInput(input: ConferenceDayInput | ConferenceDayUpdateInput): {
  success: true;
  localDate: string;
  title: string;
  displayOrder: number;
} | { success: false; error: string } {
  const dateError = validateProgrammeDate(input.localDate);
  if (dateError) return { success: false, error: dateError };
  const title = normalizedProgrammeText(input.title);
  if (!title) return { success: false, error: "Conference Day title is required." };
  const displayOrder = normalizedDisplayOrder(input.displayOrder);
  if (displayOrder === null) return { success: false, error: "Display order must be a whole number." };
  return { success: true, localDate: input.localDate.trim(), title, displayOrder };
}

function validateTrackInput(input: AgendaTrackInput | AgendaTrackUpdateInput): {
  success: true;
  name: string;
  locationLabel: string;
  displayOrder: number;
} | { success: false; error: string } {
  const name = normalizedProgrammeText(input.name);
  if (!name) return { success: false, error: "Track name is required." };
  const displayOrder = normalizedDisplayOrder(input.displayOrder);
  if (displayOrder === null) return { success: false, error: "Display order must be a whole number." };
  return {
    success: true,
    name,
    locationLabel: normalizedProgrammeText(input.locationLabel),
    displayOrder,
  };
}

function slotBody(slot: ProgrammeSlotRef): Record<string, unknown> {
  return {
    day: slot.dayId,
    track: slot.trackId || "",
    start_at: slot.startAt,
    end_at: slot.endAt,
    kind: slot.kind,
    display_order: slot.displayOrder,
    location_label: slot.locationLabel || "",
    session: slot.sessionId || "",
    title: slot.title || "",
    summary: slot.summary || "",
  };
}

function adminProgrammeData(
  context: ProgrammeValidationContext,
  sessionRows: SessionRecord[],
): AdminProgrammeData {
  return {
    days: context.days.sort((a, b) => a.displayOrder - b.displayOrder || a.localDate.localeCompare(b.localDate)),
    tracks: context.tracks.sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)),
    slots: context.slots.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || a.displayOrder - b.displayOrder),
    sessions: sessionRows
      .map((session) => ({
        id: session.id,
        title: session.title,
        slug: session.slug,
        published: Boolean(session.published),
      }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  };
}

export const adminFetchProgramme = async () => {
  "use server";
  try {
    await authorizeProgrammeAdmin();
    const admin = getAdminPB();
    const [context, sessions] = await Promise.all([
      programmeContext(),
      admin.fetchAllRecords("sessions", { fields: "id,title,slug,published", sort: "title" }),
    ]);
    return { success: true, data: adminProgrammeData(context, sessions as SessionRecord[]) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminCreateConferenceDay = async (input: ConferenceDayInput) => {
  "use server";
  try {
    await authorizeProgrammeAdmin();
    const key = normalizedProgrammeText(input.key);
    const keyError = validateProgrammeKey(key, "Conference Day");
    if (keyError) return { success: false, error: keyError };
    const validated = validateDayInput(input);
    if (!validated.success) return validated;

    const context = await programmeContext();
    if (context.days.some((day) => day.key === key)) {
      return { success: false, error: "Conference Day key is already in use." };
    }
    const record = (await getAdminPB().createRecord("conference_days", {
      key,
      local_date: validated.localDate,
      title: validated.title,
      display_order: validated.displayOrder,
      published: false,
    })) as ConferenceDayRecord;
    return { success: true, data: dayRef(record) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminUpdateConferenceDay = async (id: string, input: ConferenceDayUpdateInput) => {
  "use server";
  try {
    await authorizeProgrammeAdmin();
    const validated = validateDayInput(input);
    if (!validated.success) return validated;
    const context = await programmeContext();
    const day = context.days.find((item) => item.id === id);
    if (!day) return { success: false, error: "Conference Day was not found." };
    if (
      context.slots.some(
        (slot) => slot.dayId === id && validated.localDate !== day.localDate,
      )
    ) {
      return { success: false, error: "Move this Day's Slots before changing its local date." };
    }
    const record = (await getAdminPB().updateRecord("conference_days", id, {
      local_date: validated.localDate,
      title: validated.title,
      display_order: validated.displayOrder,
    })) as ConferenceDayRecord;
    return { success: true, data: dayRef(record) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminSetConferenceDayPublished = async (id: string, published: boolean) => {
  "use server";
  try {
    await authorizeProgrammeAdmin();
    const context = await programmeContext();
    const day = context.days.find((candidate) => candidate.id === id);
    if (!day) return { success: false, error: "Conference Day was not found." };
    if (!published && context.slots.some((slot) => slot.dayId === id && slot.published)) {
      return { success: false, error: "Unpublish this Conference Day's Slots before unpublishing the Day." };
    }
    const record = (await getAdminPB().updateRecord("conference_days", id, { published: Boolean(published) })) as ConferenceDayRecord;
    return { success: true, data: dayRef(record) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminCreateAgendaTrack = async (input: AgendaTrackInput) => {
  "use server";
  try {
    await authorizeProgrammeAdmin();
    const dayId = normalizedProgrammeText(input.dayId);
    const key = normalizedProgrammeText(input.key);
    const keyError = validateProgrammeKey(key, "Track");
    if (keyError) return { success: false, error: keyError };
    const validated = validateTrackInput(input);
    if (!validated.success) return validated;
    const context = await programmeContext();
    if (!context.days.some((day) => day.id === dayId)) {
      return { success: false, error: "Choose a valid Conference Day." };
    }
    if (context.tracks.some((track) => track.dayId === dayId && track.key === key)) {
      return { success: false, error: "Track key is already in use for this Conference Day." };
    }
    const record = (await getAdminPB().createRecord("agenda_tracks", {
      day: dayId,
      key,
      name: validated.name,
      location_label: validated.locationLabel,
      display_order: validated.displayOrder,
    })) as AgendaTrackRecord;
    return { success: true, data: trackRef(record) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminUpdateAgendaTrack = async (id: string, input: AgendaTrackUpdateInput) => {
  "use server";
  try {
    await authorizeProgrammeAdmin();
    const validated = validateTrackInput(input);
    if (!validated.success) return validated;
    const record = (await getAdminPB().updateRecord("agenda_tracks", id, {
      name: validated.name,
      location_label: validated.locationLabel,
      display_order: validated.displayOrder,
    })) as AgendaTrackRecord;
    return { success: true, data: trackRef(record) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminCreateAgendaSlot = async (input: AdminAgendaSlotInput) => {
  "use server";
  try {
    await authorizeProgrammeAdmin();
    const context = await programmeContext();
    const validated = validateAgendaSlot({ ...input, published: false }, context);
    if (!validated.success) return validated;
    const record = (await getAdminPB().createRecord("agenda_slots", {
      ...slotBody(validated.data),
      published: false,
    })) as AgendaSlotRecord;
    return { success: true, data: slotRef(record) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminUpdateAgendaSlot = async (id: string, input: AdminAgendaSlotInput) => {
  "use server";
  try {
    await authorizeProgrammeAdmin();
    const context = await programmeContext();
    const existing = context.slots.find((slot) => slot.id === id);
    if (!existing) return { success: false, error: "Agenda Slot was not found." };
    if (
      existing.published &&
      (existing.kind !== input.kind || existing.sessionId !== (input.sessionId || undefined))
    ) {
      return {
        success: false,
        error: "Unpublish this Slot before changing its kind or linked Session.",
      };
    }
    const validated = validateAgendaSlot(
      { ...input, published: existing.published },
      context,
      id,
    );
    if (!validated.success) return validated;
    const record = (await getAdminPB().updateRecord("agenda_slots", id, slotBody(validated.data))) as AgendaSlotRecord;
    return { success: true, data: slotRef(record) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminSetAgendaSlotPublished = async (id: string, published: boolean) => {
  "use server";
  try {
    await authorizeProgrammeAdmin();
    const context = await programmeContext();
    const existing = context.slots.find((slot) => slot.id === id);
    if (!existing) return { success: false, error: "Agenda Slot was not found." };
    const day = context.days.find((candidate) => candidate.id === existing.dayId);
    if (published && !day?.published) {
      return { success: false, error: "Publish the Conference Day before publishing one of its Slots." };
    }

    const validated = validateAgendaSlot(
      { ...slotInput(existing), published: Boolean(published) },
      context,
      id,
    );
    if (!validated.success) return validated;

    const admin = getAdminPB();
    const pb = await admin.getInstance();
    await pb.send(`/api/wts/programme/agenda-slots/${encodeURIComponent(id)}/publication`, {
      method: "POST",
      body: { published: Boolean(published) },
    });
    const record = (await admin.fetchRecordById("agenda_slots", id)) as AgendaSlotRecord;
    return { success: true, data: slotRef(record) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};
