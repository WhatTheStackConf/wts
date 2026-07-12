export const SCHEDULE_TIME_ZONE = "Europe/Skopje";

export const AGENDA_SLOT_KINDS = [
  "session",
  "break",
  "meal",
  "networking",
  "opening",
  "closing",
  "other",
] as const;

export type AgendaSlotKind = (typeof AGENDA_SLOT_KINDS)[number];

export interface ProgrammeDayRef {
  id: string;
  key: string;
  localDate: string;
  title: string;
  displayOrder: number;
  published: boolean;
}

export interface ProgrammeTrackRef {
  id: string;
  dayId: string;
  key: string;
  name: string;
  locationLabel?: string;
  displayOrder: number;
}

export interface ProgrammeSessionRef {
  id: string;
  published: boolean;
}

export interface ProgrammeSlotRef {
  id: string;
  dayId: string;
  trackId?: string;
  startAt: string;
  endAt: string;
  kind: AgendaSlotKind;
  published: boolean;
  displayOrder: number;
  locationLabel?: string;
  sessionId?: string;
  title?: string;
  summary?: string;
}

export interface ProgrammeValidationContext {
  days: ProgrammeDayRef[];
  tracks: ProgrammeTrackRef[];
  sessions: ProgrammeSessionRef[];
  slots: ProgrammeSlotRef[];
}

export interface AgendaSlotInput {
  dayId: string;
  trackId?: string;
  startAt: string;
  endAt: string;
  kind: AgendaSlotKind;
  published?: boolean;
  displayOrder: number;
  locationLabel?: string;
  sessionId?: string;
  title?: string;
  summary?: string;
}

export type AgendaSlotValidationResult =
  | { success: true; data: ProgrammeSlotRef }
  | { success: false; error: string };

const localDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SCHEDULE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const localDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SCHEDULE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formatParts(formatter: Intl.DateTimeFormat, date: Date): Record<string, string> {
  return formatter.formatToParts(date).reduce<Record<string, string>>((parts, part) => {
    if (part.type !== "literal") parts[part.type] = part.value;
    return parts;
  }, {});
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isAgendaSlotKind(value: unknown): value is AgendaSlotKind {
  return typeof value === "string" && AGENDA_SLOT_KINDS.includes(value as AgendaSlotKind);
}

function isIsoInstant(value: string): boolean {
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Returns the local conference date for an instant in Europe/Skopje. */
export function scheduleLocalDate(instant: string): string | null {
  if (!isIsoInstant(instant)) return null;
  const parts = formatParts(localDateFormatter, new Date(instant));
  if (!parts.year || !parts.month || !parts.day) return null;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Formats a schedule instant for an admin datetime-local field in the conference timezone. */
export function scheduleInstantToLocalDateTime(instant: string): string | null {
  if (!isIsoInstant(instant)) return null;
  const parts = formatParts(localDateTimeFormatter, new Date(instant));
  if (!parts.year || !parts.month || !parts.day || !parts.hour || !parts.minute) return null;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Converts an admin datetime-local value to an unambiguous Europe/Skopje instant. */
export function scheduleLocalDateTimeToInstant(localValue: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/.exec(localValue);
  if (!match) throw new Error("Enter a valid Europe/Skopje local date and time.");

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute);
  const validDate = new Date(naiveUtc);
  if (
    validDate.getUTCFullYear() !== year ||
    validDate.getUTCMonth() !== month - 1 ||
    validDate.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  ) {
    throw new Error("Enter a valid Europe/Skopje local date and time.");
  }

  const target = `${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}`;
  const candidates = [1, 2]
    .map((offsetHours) => new Date(naiveUtc - offsetHours * 60 * 60 * 1000))
    .filter((candidate) => {
      const parts = formatParts(localDateTimeFormatter, candidate);
      return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` === target;
    });

  if (candidates.length === 0) {
    throw new Error("This local time does not exist in Europe/Skopje.");
  }
  if (candidates.length > 1) {
    throw new Error("This local time is ambiguous in Europe/Skopje. Choose a different time.");
  }
  return candidates[0].toISOString();
}

function overlaps(candidate: ProgrammeSlotRef, existing: ProgrammeSlotRef): boolean {
  return Date.parse(candidate.startAt) < Date.parse(existing.endAt) &&
    Date.parse(candidate.endAt) > Date.parse(existing.startAt);
}

/** Validates the complete programme constraint set before a Slot is persisted. */
export function validateAgendaSlot(
  input: AgendaSlotInput,
  context: ProgrammeValidationContext,
  existingId = "",
): AgendaSlotValidationResult {
  const dayId = cleanText(input.dayId);
  const trackId = cleanText(input.trackId);
  const startAt = cleanText(input.startAt);
  const endAt = cleanText(input.endAt);
  const sessionId = cleanText(input.sessionId);
  const title = cleanText(input.title);
  const summary = cleanText(input.summary);
  const locationLabel = cleanText(input.locationLabel);

  const day = context.days.find((item) => item.id === dayId);
  if (!day) return { success: false, error: "Choose a valid Conference Day." };
  if (!isAgendaSlotKind(input.kind)) return { success: false, error: "Choose a valid Slot kind." };
  if (!Number.isInteger(input.displayOrder)) {
    return { success: false, error: "Display order must be a whole number." };
  }
  if (!isIsoInstant(startAt) || !isIsoInstant(endAt)) {
    return { success: false, error: "Slot times must be ISO instants." };
  }
  if (Date.parse(endAt) <= Date.parse(startAt)) {
    return { success: false, error: "Slot end time must be after its start time." };
  }
  if (scheduleLocalDate(startAt) !== day.localDate) {
    return {
      success: false,
      error: `Slot start time must fall on ${day.localDate} in ${SCHEDULE_TIME_ZONE}.`,
    };
  }

  const track = trackId ? context.tracks.find((item) => item.id === trackId) : undefined;
  if (trackId && !track) return { success: false, error: "Choose a valid Track." };
  if (track && track.dayId !== day.id) {
    return { success: false, error: "The selected Track belongs to another Conference Day." };
  }

  if (input.kind === "session") {
    const session = context.sessions.find((item) => item.id === sessionId);
    if (!session) return { success: false, error: "A Session Slot must select one Session." };
    if (title || summary) {
      return { success: false, error: "Session Slots use their linked Session title and abstract." };
    }
  } else {
    if (sessionId) return { success: false, error: "Non-Session Slots cannot select a Session." };
    if (!title || !summary) {
      return { success: false, error: "Non-Session Slots require both a title and summary." };
    }
  }

  const candidate: ProgrammeSlotRef = {
    id: existingId,
    dayId: day.id,
    trackId: track?.id || undefined,
    startAt,
    endAt,
    kind: input.kind,
    published: Boolean(input.published),
    displayOrder: input.displayOrder,
    locationLabel: locationLabel || undefined,
    sessionId: sessionId || undefined,
    title: title || undefined,
    summary: summary || undefined,
  };

  for (const existing of context.slots) {
    if (existing.id === existingId || !overlaps(candidate, existing)) continue;
    const conflicts = !candidate.trackId || !existing.trackId || candidate.trackId === existing.trackId;
    if (conflicts) {
      return {
        success: false,
        error: "This Slot overlaps an all-attendee Slot or another Slot in the same Track.",
      };
    }
  }

  return { success: true, data: candidate };
}

export function validateProgrammeKey(value: unknown, label: string): string | null {
  const key = cleanText(value);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) {
    return `${label} key must use lowercase letters, numbers, and hyphens.`;
  }
  return null;
}

export function validateProgrammeDate(value: unknown): string | null {
  const date = cleanText(value);
  return isIsoDate(date) ? null : "Conference Day date must use YYYY-MM-DD.";
}

export function normalizedProgrammeText(value: unknown): string {
  return cleanText(value);
}

export function normalizedDisplayOrder(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) ? number : null;
}
