import { getAdminPB } from "~/lib/pocketbase-admin-service";
import { requireAdmin } from "~/lib/server-auth";
import { runAuthorizedProgrammeOperation } from "~/lib/programme-admin-authorization";
import {
  normalizedDisplayOrder,
  normalizedProgrammeText,
  type AgendaSlotInput,
  type ProgrammeDayRef,
  type ProgrammeEventProgrammeRef,
  type ProgrammeEventRef,
  type ProgrammeSessionRef,
  type ProgrammeSpeakerRef,
  type ProgrammeSlotRef,
  type ProgrammeTrackRef,
  type ProgrammeValidationContext,
  validateAgendaSlot,
  validateAgendaSlotPublication,
  validateProgrammeDate,
  validateProgrammeKey,
} from "~/lib/programme";
import type {
  AgendaSlotKind,
  AgendaSlotRecord,
  AgendaTrackRecord,
  AppearanceEventRecord,
  ConferenceDayRecord,
  EventProgrammeRecord,
  SessionRecord,
  SpeakerRecord,
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
  programmeId: string;
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
  programmeId: string;
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
  events: ProgrammeEventRef[];
  days: ProgrammeDayRef[];
  programmes: ProgrammeEventProgrammeRef[];
  tracks: ProgrammeTrackRef[];
  slots: ProgrammeSlotRef[];
  sessions: Array<{ id: string; title: string; slug: string; published: boolean }>;
}

export interface EventProgrammeInput {
  dayId: string;
  appearanceEventId: string;
  displayOrder: number;
}

export interface EventProgrammeUpdateInput {
  displayOrder: number;
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

function eventRef(record: AppearanceEventRecord): ProgrammeEventRef {
  return { id: record.id, name: record.name, published: Boolean(record.published) };
}

function eventProgrammeRef(record: EventProgrammeRecord): ProgrammeEventProgrammeRef {
  return {
    id: record.id,
    dayId: record.day,
    appearanceEventId: record.appearance_event,
    displayOrder: Number(record.display_order),
  };
}

function trackRef(record: AgendaTrackRecord): ProgrammeTrackRef {
  return {
    id: record.id,
    programmeId: record.programme,
    key: record.key,
    name: record.name,
    locationLabel: record.location_label || undefined,
    displayOrder: Number(record.display_order),
  };
}

function slotRef(record: AgendaSlotRecord): ProgrammeSlotRef {
  return {
    id: record.id,
    programmeId: record.programme,
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
  return {
    id: record.id,
    published: Boolean(record.published),
    speakerIds: record.speakers || [],
  };
}

function speakerRef(record: SpeakerRecord): ProgrammeSpeakerRef {
  return { id: record.id, appearanceEventIds: record.appearance_events || [] };
}

function slotInput(record: ProgrammeSlotRef): AgendaSlotInput {
  return {
    programmeId: record.programmeId,
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
  const [events, days, programmes, tracks, sessions, speakers, slots] = await Promise.all([
    admin.fetchAllRecords("appearance_events", { fields: "id,name,published" }),
    admin.fetchAllRecords("conference_days"),
    admin.fetchAllRecords("event_programmes"),
    admin.fetchAllRecords("agenda_tracks"),
    admin.fetchAllRecords("sessions", { fields: "id,published,speakers" }),
    admin.fetchAllRecords("speakers", { fields: "id,appearance_events" }),
    admin.fetchAllRecords("agenda_slots"),
  ]);
  return {
    events: (events as AppearanceEventRecord[]).map(eventRef),
    days: (days as ConferenceDayRecord[]).map(dayRef),
    programmes: (programmes as EventProgrammeRecord[]).map(eventProgrammeRef),
    tracks: (tracks as AgendaTrackRecord[]).map(trackRef),
    sessions: (sessions as SessionRecord[]).map(sessionRef),
    speakers: (speakers as SpeakerRecord[]).map(speakerRef),
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
    programme: slot.programmeId,
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
    events: context.events.sort((a, b) => a.name.localeCompare(b.name)),
    days: context.days.sort((a, b) => a.displayOrder - b.displayOrder || a.localDate.localeCompare(b.localDate)),
    programmes: context.programmes.sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id)),
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
      validated.localDate !== day.localDate &&
      context.slots.some(
        (slot) => context.programmes.some(
          (programme) => programme.id === slot.programmeId && programme.dayId === id,
        ),
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
    const programmeIds = new Set(context.programmes.filter((programme) => programme.dayId === id).map((programme) => programme.id));
    if (!published && context.slots.some((slot) => programmeIds.has(slot.programmeId) && slot.published)) {
      return { success: false, error: "Unpublish this Conference Day's Slots before unpublishing the Day." };
    }
    const record = (await getAdminPB().updateRecord("conference_days", id, { published: Boolean(published) })) as ConferenceDayRecord;
    return { success: true, data: dayRef(record) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminCreateEventProgramme = async (input: EventProgrammeInput) => {
  "use server";
  try {
    await authorizeProgrammeAdmin();
    const dayId = normalizedProgrammeText(input.dayId);
    const appearanceEventId = normalizedProgrammeText(input.appearanceEventId);
    const displayOrder = normalizedDisplayOrder(input.displayOrder);
    if (displayOrder === null) return { success: false, error: "Display order must be a whole number." };
    const context = await programmeContext();
    if (!context.days.some((day) => day.id === dayId)) {
      return { success: false, error: "Choose a valid Conference Day." };
    }
    if (!context.events.some((event) => event.id === appearanceEventId)) {
      return { success: false, error: "Choose a valid Appearance Event." };
    }
    if (context.programmes.some((programme) =>
      programme.dayId === dayId && programme.appearanceEventId === appearanceEventId
    )) {
      return { success: false, error: "This Appearance Event already has a Programme on that Conference Day." };
    }
    const record = (await getAdminPB().createRecord("event_programmes", {
      day: dayId,
      appearance_event: appearanceEventId,
      display_order: displayOrder,
    })) as EventProgrammeRecord;
    return { success: true, data: eventProgrammeRef(record) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminUpdateEventProgramme = async (id: string, input: EventProgrammeUpdateInput) => {
  "use server";
  try {
    await authorizeProgrammeAdmin();
    const displayOrder = normalizedDisplayOrder(input.displayOrder);
    if (displayOrder === null) return { success: false, error: "Display order must be a whole number." };
    const record = (await getAdminPB().updateRecord("event_programmes", id, {
      display_order: displayOrder,
    })) as EventProgrammeRecord;
    return { success: true, data: eventProgrammeRef(record) };
  } catch (error) {
    return { success: false, error: actionError(error) };
  }
};

export const adminCreateAgendaTrack = async (input: AgendaTrackInput) => {
  "use server";
  try {
    await authorizeProgrammeAdmin();
    const programmeId = normalizedProgrammeText(input.programmeId);
    const key = normalizedProgrammeText(input.key);
    const keyError = validateProgrammeKey(key, "Track");
    if (keyError) return { success: false, error: keyError };
    const validated = validateTrackInput(input);
    if (!validated.success) return validated;
    const context = await programmeContext();
    if (!context.programmes.some((programme) => programme.id === programmeId)) {
      return { success: false, error: "Choose a valid Event Programme." };
    }
    if (context.tracks.some((track) => track.programmeId === programmeId && track.key === key)) {
      return { success: false, error: "Track key is already in use for this Event Programme." };
    }
    const record = (await getAdminPB().createRecord("agenda_tracks", {
      programme: programmeId,
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
      (existing.kind !== input.kind ||
        existing.sessionId !== (input.sessionId || undefined) ||
        existing.programmeId !== input.programmeId)
    ) {
      return {
        success: false,
        error: "Unpublish this Slot before changing its Event Programme, kind, or linked Session.",
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
    if (published) {
      const publicationError = validateAgendaSlotPublication(existing, context);
      if (publicationError) return { success: false, error: publicationError };
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
