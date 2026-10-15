import { conferenceTimeZone } from "~/lib/conference-guide-content";

export const SCHEDULE_TIME_ZONE = conferenceTimeZone;
export const AGENDA_SLOT_KINDS = ["session", "break", "meal", "networking", "opening", "closing", "other"] as const;
export type AgendaSlotKind = (typeof AGENDA_SLOT_KINDS)[number];
export interface ProgrammeDayRef { id: string; key: string; localDate: string; title: string; displayOrder: number; published: boolean }
export interface ProgrammeEventRef { id: string; name: string; published: boolean }
export interface ProgrammeEventProgrammeRef { id: string; dayId: string; appearanceEventId: string; displayOrder: number }
export interface ProgrammeTrackRef { id: string; programmeId: string; key: string; name: string; locationLabel?: string; displayOrder: number }
export interface ProgrammeSessionRef { id: string; published: boolean; speakerIds: string[] }
export interface ProgrammeSpeakerRef { id: string; appearanceEventIds: string[] }
export interface ProgrammeSlotRef { id: string; programmeId: string; trackId?: string; startAt: string; endAt: string; kind: AgendaSlotKind; published: boolean; displayOrder: number; locationLabel?: string; sessionId?: string; title?: string; summary?: string }
export interface ProgrammeValidationContext { events: ProgrammeEventRef[]; days: ProgrammeDayRef[]; programmes: ProgrammeEventProgrammeRef[]; tracks: ProgrammeTrackRef[]; sessions: ProgrammeSessionRef[]; speakers: ProgrammeSpeakerRef[]; slots: ProgrammeSlotRef[] }
export interface AgendaSlotInput { programmeId: string; trackId?: string; startAt: string; endAt: string; kind: AgendaSlotKind; published?: boolean; displayOrder: number; locationLabel?: string; sessionId?: string; title?: string; summary?: string }
export type AgendaSlotValidationResult = { success: true; data: ProgrammeSlotRef } | { success: false; error: string };

export function validateAgendaSlotPublication(slot: ProgrammeSlotRef, context: ProgrammeValidationContext): string | null {
  const programme = context.programmes.find((candidate) => candidate.id === slot.programmeId);
  if (!programme) return "Choose a valid Event Programme.";
  const day = context.days.find((candidate) => candidate.id === programme.dayId);
  if (!day?.published) return "Publish the Conference Day before publishing one of its Slots.";
  const appearanceEvent = context.events.find((candidate) => candidate.id === programme.appearanceEventId);
  if (!appearanceEvent?.published) return "Publish the Appearance Event before publishing one of its Slots.";
  if (slot.kind !== "session") return null;
  const session = context.sessions.find((candidate) => candidate.id === slot.sessionId);
  const missingAppearance = session?.speakerIds.find((speakerId) => {
    const speaker = context.speakers.find((candidate) => candidate.id === speakerId);
    return !speaker?.appearanceEventIds.includes(programme.appearanceEventId);
  });
  return missingAppearance ? "Every Session Speaker needs an Event Appearance for this Appearance Event before publishing the Slot." : null;
}

const localDateFormatter = SCHEDULE_TIME_ZONE
  ? new Intl.DateTimeFormat("en-CA", { timeZone: SCHEDULE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
  : undefined;
const localDateTimeFormatter = SCHEDULE_TIME_ZONE
  ? new Intl.DateTimeFormat("en-CA", { timeZone: SCHEDULE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
  : undefined;
const scheduleTimeFormatter = SCHEDULE_TIME_ZONE
  ? new Intl.DateTimeFormat("en-GB", { timeZone: SCHEDULE_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
  : undefined;
function formatParts(formatter: Intl.DateTimeFormat, date: Date): Record<string, string> {
  return formatter.formatToParts(date).reduce<Record<string, string>>((parts, part) => { if (part.type !== "literal") parts[part.type] = part.value; return parts; }, {});
}
function pad(value: number): string { return String(value).padStart(2, "0"); }
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function isAgendaSlotKind(value: unknown): value is AgendaSlotKind { return typeof value === "string" && AGENDA_SLOT_KINDS.includes(value as AgendaSlotKind); }
function isIsoInstant(value: string): boolean { return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && !Number.isNaN(Date.parse(value)); }
function cleanText(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
export function formatScheduleTime(instant: string): string | null {
  if (!scheduleTimeFormatter || !isIsoInstant(instant)) return null;
  return scheduleTimeFormatter.format(new Date(instant));
}

export function scheduleLocalDate(instant: string): string | null {
  if (!localDateFormatter || !isIsoInstant(instant)) return null;
  const parts = formatParts(localDateFormatter, new Date(instant));
  return parts.year && parts.month && parts.day ? `${parts.year}-${parts.month}-${parts.day}` : null;
}
export function scheduleInstantToLocalDateTime(instant: string): string | null {
  if (!localDateTimeFormatter || !isIsoInstant(instant)) return null;
  const parts = formatParts(localDateTimeFormatter, new Date(instant));
  return parts.year && parts.month && parts.day && parts.hour && parts.minute ? `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` : null;
}
function parseConferenceLocalDateTime(localValue: string): { naiveUtc: number; target: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/.exec(localValue);
  if (!match) throw new Error("Enter a valid conference-local date and time.");
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText), hour = Number(hourText), minute = Number(minuteText);
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute), validDate = new Date(naiveUtc);
  if (validDate.getUTCFullYear() !== year || validDate.getUTCMonth() !== month - 1 || validDate.getUTCDate() !== day || hour > 23 || minute > 59) throw new Error("Enter a valid conference-local date and time.");
  return { naiveUtc, target: `${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}` };
}
export function scheduleLocalDateTimeToInstant(localValue: string): string {
  if (!SCHEDULE_TIME_ZONE || !localDateTimeFormatter) throw new Error("The conference time zone has not been announced.");
  const { naiveUtc, target } = parseConferenceLocalDateTime(localValue);
  const offsetAt = (instant: number) => {
    const parts = formatParts(localDateTimeFormatter, new Date(instant));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute)) - instant;
  };
  const offsets = new Set([-36, -24, 0, 24, 36].map((hours) => offsetAt(naiveUtc + hours * 60 * 60 * 1000)));
  const candidates = [...offsets].map((offset) => new Date(naiveUtc - offset)).filter((candidate) => {
    const parts = formatParts(localDateTimeFormatter, candidate);
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` === target;
  });
  if (candidates.length === 0) throw new Error(`This local time does not exist in ${SCHEDULE_TIME_ZONE}.`);
  if (candidates.length > 1) throw new Error(`This local time is ambiguous in ${SCHEDULE_TIME_ZONE}. Choose a different time.`);
  return candidates[0].toISOString();
}
function overlaps(candidate: ProgrammeSlotRef, existing: ProgrammeSlotRef): boolean {
  return Date.parse(candidate.startAt) < Date.parse(existing.endAt) && Date.parse(candidate.endAt) > Date.parse(existing.startAt);
}

function sharesTrack(candidate: ProgrammeSlotRef, existing: ProgrammeSlotRef): boolean {
  return !candidate.trackId || !existing.trackId || candidate.trackId === existing.trackId;
}

type CleanAgendaSlotFields = Record<"programmeId" | "trackId" | "startAt" | "endAt" | "sessionId" | "title" | "summary" | "locationLabel", string>;

function cleanAgendaSlotFields(input: AgendaSlotInput): CleanAgendaSlotFields {
  return { programmeId: cleanText(input.programmeId), trackId: cleanText(input.trackId), startAt: cleanText(input.startAt), endAt: cleanText(input.endAt), sessionId: cleanText(input.sessionId), title: cleanText(input.title), summary: cleanText(input.summary), locationLabel: cleanText(input.locationLabel) };
}

function slotFieldError(input: AgendaSlotInput, { startAt, endAt }: CleanAgendaSlotFields, day: ProgrammeDayRef): string | null {
  if (!isAgendaSlotKind(input.kind)) return "Choose a valid Slot kind.";
  if (!Number.isInteger(input.displayOrder)) return "Display order must be a whole number.";
  if (!isIsoInstant(startAt) || !isIsoInstant(endAt)) return "Slot times must be ISO instants.";
  if (Date.parse(endAt) <= Date.parse(startAt)) return "Slot end time must be after its start time.";
  if (scheduleLocalDate(startAt) !== day.localDate) return `Slot start time must fall on ${day.localDate} in ${SCHEDULE_TIME_ZONE}.`;
  return null;
}

function slotTrackError(trackId: string, track: ProgrammeTrackRef | undefined, programme: ProgrammeEventProgrammeRef): string | null {
  if (trackId && !track) return "Choose a valid Track.";
  if (track && track.programmeId !== programme.id) return "The selected Track belongs to another Event Programme.";
  return null;
}

function slotContentError(kind: AgendaSlotKind, { sessionId, title, summary }: CleanAgendaSlotFields, sessions: ProgrammeSessionRef[]): string | null {
  if (kind === "session") {
    if (!sessions.some((item) => item.id === sessionId)) return "A Session Slot must select one Session.";
    return title || summary ? "Session Slots use their linked Session title and abstract." : null;
  }
  if (sessionId) return "Non-Session Slots cannot select a Session.";
  return !title || !summary ? "Non-Session Slots require both a title and summary." : null;
}

function agendaSlotCandidate(existingId: string, input: AgendaSlotInput, fields: CleanAgendaSlotFields, programme: ProgrammeEventProgrammeRef, track: ProgrammeTrackRef | undefined): ProgrammeSlotRef {
  const { startAt, endAt, locationLabel, sessionId, title, summary } = fields;
  return { id: existingId, programmeId: programme.id, trackId: track?.id || undefined, startAt, endAt, kind: input.kind, published: Boolean(input.published), displayOrder: input.displayOrder, locationLabel: locationLabel || undefined, sessionId: sessionId || undefined, title: title || undefined, summary: summary || undefined };
}

function agendaSlotFailure(error: string): AgendaSlotValidationResult {
  return { success: false, error };
}

export function validateAgendaSlot(input: AgendaSlotInput, context: ProgrammeValidationContext, existingId = ""): AgendaSlotValidationResult {
  if (!SCHEDULE_TIME_ZONE) {
    return agendaSlotFailure("The conference time zone has not been announced.");
  }
  const fields = cleanAgendaSlotFields(input);
  const programme = context.programmes.find((item) => item.id === fields.programmeId);
  if (!programme) return agendaSlotFailure("Choose a valid Event Programme.");
  const day = context.days.find((item) => item.id === programme.dayId);
  if (!day) return agendaSlotFailure("The Event Programme must belong to a valid Conference Day.");
  const track = fields.trackId ? context.tracks.find((item) => item.id === fields.trackId) : undefined;
  const error = slotFieldError(input, fields, day) ?? slotTrackError(fields.trackId, track, programme) ?? slotContentError(input.kind, fields, context.sessions);
  if (error) return agendaSlotFailure(error);
  const candidate = agendaSlotCandidate(existingId, input, fields, programme, track);
  const conflict = context.slots.some((existing) => existing.id !== existingId && existing.programmeId === candidate.programmeId && overlaps(candidate, existing) && sharesTrack(candidate, existing));
  if (conflict) return agendaSlotFailure("This Slot overlaps a Programme-wide Slot or another Slot in the same Track.");
  return { success: true, data: candidate };
}
export function validateProgrammeKey(value: unknown, label: string): string | null {
  const key = cleanText(value);
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) ? null : `${label} key must use lowercase letters, numbers, and hyphens.`;
}
export function validateProgrammeDate(value: unknown): string | null {
  return isIsoDate(cleanText(value)) ? null : "Conference Day date must use YYYY-MM-DD.";
}
export function normalizedProgrammeText(value: unknown): string { return cleanText(value); }
export function normalizedDisplayOrder(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) ? number : null;
}
