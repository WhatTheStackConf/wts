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
import { getPbFileUrl } from "~/lib/pocketbase-public-url";
import { sessionHostIds, sharedSlotHosts, withoutHostCredit } from "~/lib/programme-hosts";

/** Date/event assignment is known, but the session itself has no clock time yet. */
export interface PublicSessionAnnouncement {
  dayDate: string;
  event: PublicAgendaEvent;
  eventStartTime?: string;
  locationLabel?: string;
}

export interface PublicSessionSchedule {
  dayDate: string;
  dayTitle: string;
  event: PublicAgendaEvent;
  startAt: string;
  endAt?: string;
  trackName?: string;
  locationLabel?: string;
}

export interface PublicAgendaSession {
  slug: string;
  title: string;
  format?: string;
  /** Organizer-announced session timing, possibly without a confirmed end. */
  schedule?: PublicSessionSchedule;
  speakers: { slug: string; name: string; photoUrl?: string | null }[];
  /** Explicit hosts, also retained in speakers for participant-list compatibility. */
  hosts?: PublicAgendaSession["speakers"];
}

/** Shared allowlist for timed and announced sessions; never copy private profile fields. */
export function publicAgendaSession(session: SessionRecord, speakersById: ReadonlyMap<string, SpeakerRecord>): PublicAgendaSession {
  const hosts = publicAgendaSpeakers(sessionHostIds(session).flatMap((id) => {
    const speaker = speakersById.get(id);
    return speaker ? [speaker] : [];
  }));
  return {
    slug: session.slug,
    title: session.title,
    format: session.format || undefined,
    ...(hosts.length ? { hosts } : {}),
    speakers: publicAgendaSpeakers((session.speakers || []).flatMap((id) => {
      const speaker = speakersById.get(id);
      return speaker ? [speaker] : [];
    })),
  };
}

export function publicAgendaSpeakers(speakers: SpeakerRecord[]): PublicAgendaSession["speakers"] {
  return speakers.filter((speaker) => speaker.published).map((speaker) => ({
    slug: speaker.slug,
    name: speaker.display_name || speaker.slug || "Speaker",
    photoUrl: speaker.photo ? getPbFileUrl("speakers", speaker.id, speaker.photo) : null,
  })).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export interface PublicAgendaTrack {
  key: string;
  name: string;
  locationLabel?: string;
}

export interface PublicAgendaEvent {
  name: string;
  compactLabel: string;
  destinationUrl?: string;
}

export interface PublicAgendaSlot {
  kind: AgendaSlotKind;
  startAt: string;
  endAt: string;
  locationLabel?: string;
  track?: PublicAgendaTrack;
  session?: PublicAgendaSession;
  /** Announced speaker in a timed slot whose topic has not been published. */
  speakers?: PublicAgendaSession["speakers"];
  title?: string;
  summary?: string;
}

export interface PublicAgendaDay {
  key: string;
  localDate: string;
  title: string;
  programmes: PublicEventProgramme[];
}

export interface PublicEventProgramme {
  event: PublicAgendaEvent;
  tracks: PublicAgendaTrack[];
  slots: PublicAgendaSlot[];
  /** Entry details retained when an announced lineup gains a timetable. */
  details?: {
    summary: string;
    access?: string;
    cta?: { label: string; href: string };
    unassignedSpeakers?: PublicAgendaSession["speakers"];
  };
  /** Announced lineup; individual timings may be only partially confirmed. */
  untimed?: {
    startTime?: string;
    endTime?: string;
    title?: string;
    locationLabel?: string;
    speakers?: PublicAgendaSession["speakers"];
    /** Published event speakers without an assigned public session; topics are TBD. */
    unassignedSpeakers?: PublicAgendaSession["speakers"];
    summary: string;
    sessions: PublicAgendaSession[];
    highlights?: string[];
    access?: string;
    cta?: { label: string; href: string };
  };
}

export interface PublicAgenda {
  days: PublicAgendaDay[];
}

function slotTrack(slot: AgendaSlotRecord, tracksById: Map<string, AgendaTrackRecord>): AgendaTrackRecord | undefined {
  return slot.track ? tracksById.get(slot.track) : undefined;
}

function isForeignTrack(track: AgendaTrackRecord | undefined, programmeId: string): boolean {
  return Boolean(track && track.programme !== programmeId);
}

function slotLocationLabel(slot: AgendaSlotRecord, track: AgendaTrackRecord | undefined): string | undefined {
  return slot.location_label || track?.location_label || undefined;
}

export function derivePublicSessionSchedule(
  slot: AgendaSlotRecord,
  programmesById: Map<string, EventProgrammeRecord>,
  eventsById: Map<string, AppearanceEventRecord>,
  daysById: Map<string, ConferenceDayRecord>,
  tracksById: Map<string, AgendaTrackRecord>,
): PublicSessionSchedule | undefined {
  const programme = programmesById.get(slot.programme);
  if (!programme) return undefined;
  const day = daysById.get(programme.day);
  const event = eventsById.get(programme.appearance_event);
  if (!day?.published || !event?.published) return undefined;
  const track = slotTrack(slot, tracksById);
  if (isForeignTrack(track, programme.id)) return undefined;
  return {
    dayDate: day.local_date,
    dayTitle: day.title,
    event: publicAgendaEvent(event),
    startAt: slot.start_at,
    endAt: slot.end_at,
    trackName: track?.name || undefined,
    locationLabel: slotLocationLabel(slot, track),
  };
}

function publicAgendaEvent(event: AppearanceEventRecord): PublicAgendaEvent {
  return {
    name: event.name,
    compactLabel: event.compact_label || event.name,
    destinationUrl: event.destination_url || undefined,
  };
}

function publicAgendaTrack(track: AgendaTrackRecord): PublicAgendaTrack {
  return { key: track.key, name: track.name, locationLabel: track.location_label || undefined };
}

function trackDisplayOrder(tracksById: Map<string, AgendaTrackRecord>, trackId: string | undefined): number {
  return Number(tracksById.get(trackId || "")?.display_order || 0);
}

function compareAgendaSlots(tracksById: Map<string, AgendaTrackRecord>) {
  return (a: AgendaSlotRecord, b: AgendaSlotRecord): number => {
    const timeOrder = Date.parse(a.start_at) - Date.parse(b.start_at);
    if (timeOrder !== 0) return timeOrder;
    if (!a.track && b.track) return -1;
    if (a.track && !b.track) return 1;
    const trackOrder = trackDisplayOrder(tracksById, a.track) - trackDisplayOrder(tracksById, b.track);
    return trackOrder || Number(a.display_order) - Number(b.display_order);
  };
}

interface PublicSlotContext {
  eventId: string;
  sessionsById: Map<string, SessionRecord>;
  speakersById: Map<string, SpeakerRecord>;
}

function publicAgendaSlot(slot: AgendaSlotRecord, track: AgendaTrackRecord | undefined, { eventId, sessionsById, speakersById }: PublicSlotContext): PublicAgendaSlot | undefined {
  const base = {
    kind: slot.kind,
    startAt: slot.start_at,
    endAt: slot.end_at,
    locationLabel: slotLocationLabel(slot, track),
    track: track ? publicAgendaTrack(track) : undefined,
  };
  if (slot.kind === "session") {
    const session = slot.session ? sessionsById.get(slot.session) : undefined;
    return session ? { ...base, session: publicAgendaSession(session, speakersById) } : undefined;
  }
  const hosts = publicAgendaSpeakers(sharedSlotHosts(slot, eventId, speakersById));
  return {
    ...base,
    title: slot.title || undefined,
    ...(hosts.length ? { speakers: hosts } : {}),
    summary: withoutHostCredit(slot.summary || "", hosts.map((host) => host.name)) || undefined,
  };
}

/** Maps raw records into the public Agenda's allowlisted Day/Event Programme/Slot read model. */
export function buildPublicAgenda(
  days: ConferenceDayRecord[],
  events: AppearanceEventRecord[],
  programmes: EventProgrammeRecord[],
  tracks: AgendaTrackRecord[],
  slots: AgendaSlotRecord[],
  sessions: SessionRecord[],
  speakers: SpeakerRecord[] = [],
): PublicAgenda {
  const visibleDays = days
    .filter((day) => day.published)
    .sort((a, b) => Number(a.display_order) - Number(b.display_order) || a.local_date.localeCompare(b.local_date));
  const tracksById = new Map(tracks.map((track) => [track.id, track]));
  const eventsById = new Map(events.filter((event) => event.published).map((event) => [event.id, event]));
  const sessionsById = new Map(sessions.filter((session) => session.published).map((session) => [session.id, session]));
  const speakersById = new Map(speakers.filter((speaker) => speaker.published).map((speaker) => [speaker.id, speaker]));

  return {
    days: visibleDays.map((day) => {
      const visibleProgrammes = programmes
        .filter((programme) => programme.day === day.id && eventsById.has(programme.appearance_event))
        .sort((a, b) => Number(a.display_order) - Number(b.display_order) || a.id.localeCompare(b.id));

      return {
        key: day.key,
        localDate: day.local_date,
        title: day.title,
        programmes: visibleProgrammes.flatMap((programme) => {
          const event = eventsById.get(programme.appearance_event);
          if (!event) return [];
          const slotContext = { eventId: event.id, sessionsById, speakersById };
          const visibleSlots = slots
            .filter((slot) => slot.published && slot.programme === programme.id)
            .sort(compareAgendaSlots(tracksById))
            .flatMap((slot) => {
              const track = slotTrack(slot, tracksById);
              if (isForeignTrack(track, programme.id)) return [];
              const publicSlot = publicAgendaSlot(slot, track, slotContext);
              return publicSlot ? [publicSlot] : [];
            });

          return visibleSlots.length > 0
            ? [{
              event: publicAgendaEvent(event),
              tracks: tracks
                .filter((track) => track.programme === programme.id)
                .sort((a, b) => Number(a.display_order) - Number(b.display_order) || a.key.localeCompare(b.key))
                .map(publicAgendaTrack),
              slots: visibleSlots,
            }]
            : [];
        }),
      };
    }),
  };
}
