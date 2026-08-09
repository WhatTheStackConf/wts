import type {
  AgendaSlotKind,
  AgendaSlotRecord,
  AgendaTrackRecord,
  AppearanceEventRecord,
  ConferenceDayRecord,
  EventProgrammeRecord,
  SessionRecord,
} from "~/lib/pocketbase-types";

export interface PublicSessionSchedule {
  dayDate: string;
  dayTitle: string;
  event: PublicAgendaEvent;
  startAt: string;
  endAt: string;
  trackName?: string;
  locationLabel?: string;
}

export interface PublicAgendaSession {
  slug: string;
  title: string;
  format?: string;
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
  slots: PublicAgendaSlot[];
}

export interface PublicAgenda {
  days: PublicAgendaDay[];
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
  const track = slot.track ? tracksById.get(slot.track) : undefined;
  if (track && track.programme !== programme.id) return undefined;
  return {
    dayDate: day.local_date,
    dayTitle: day.title,
    event: publicAgendaEvent(event),
    startAt: slot.start_at,
    endAt: slot.end_at,
    trackName: track?.name || undefined,
    locationLabel: slot.location_label || track?.location_label || undefined,
  };
}

function publicAgendaEvent(event: AppearanceEventRecord): PublicAgendaEvent {
  return {
    name: event.name,
    compactLabel: event.compact_label || event.name,
    destinationUrl: event.destination_url || undefined,
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
): PublicAgenda {
  const visibleDays = days
    .filter((day) => day.published)
    .sort((a, b) => Number(a.display_order) - Number(b.display_order) || a.local_date.localeCompare(b.local_date));
  const tracksById = new Map(tracks.map((track) => [track.id, track]));
  const eventsById = new Map(events.filter((event) => event.published).map((event) => [event.id, event]));
  const sessionsById = new Map(sessions.filter((session) => session.published).map((session) => [session.id, session]));

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
          const slotRows = slots
            .filter((slot) => slot.published && slot.programme === programme.id)
            .sort((a, b) => {
              const timeOrder = Date.parse(a.start_at) - Date.parse(b.start_at);
              if (timeOrder !== 0) return timeOrder;
              if (!a.track && b.track) return -1;
              if (a.track && !b.track) return 1;
              const trackOrder = Number(tracksById.get(a.track || "")?.display_order || 0) -
                Number(tracksById.get(b.track || "")?.display_order || 0);
              return trackOrder || Number(a.display_order) - Number(b.display_order);
            });
          const visibleSlots: PublicAgendaSlot[] = [];

          for (const slot of slotRows) {
            const track = slot.track ? tracksById.get(slot.track) : undefined;
            if (track && track.programme !== programme.id) continue;
            if (slot.kind === "session") {
              const session = slot.session ? sessionsById.get(slot.session) : undefined;
              if (!session) continue;
              visibleSlots.push({
                kind: slot.kind,
                startAt: slot.start_at,
                endAt: slot.end_at,
                locationLabel: slot.location_label || track?.location_label || undefined,
                track: track
                  ? { key: track.key, name: track.name, locationLabel: track.location_label || undefined }
                  : undefined,
                session: { slug: session.slug, title: session.title, format: session.format || undefined },
              });
              continue;
            }
            visibleSlots.push({
              kind: slot.kind,
              startAt: slot.start_at,
              endAt: slot.end_at,
              locationLabel: slot.location_label || track?.location_label || undefined,
              track: track
                ? { key: track.key, name: track.name, locationLabel: track.location_label || undefined }
                : undefined,
              title: slot.title || undefined,
              summary: slot.summary || undefined,
            });
          }

          return visibleSlots.length > 0
            ? [{ event: publicAgendaEvent(event), slots: visibleSlots }]
            : [];
        }),
      };
    }),
  };
}
