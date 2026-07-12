import type {
  AgendaSlotKind,
  AgendaSlotRecord,
  AgendaTrackRecord,
  ConferenceDayRecord,
  SessionRecord,
} from "~/lib/pocketbase-types";

export interface PublicSessionSchedule {
  dayDate: string;
  dayTitle: string;
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
  slots: PublicAgendaSlot[];
}

export interface PublicAgenda {
  days: PublicAgendaDay[];
}

export function derivePublicSessionSchedule(
  slot: AgendaSlotRecord,
  daysById: Map<string, ConferenceDayRecord>,
  tracksById: Map<string, AgendaTrackRecord>,
): PublicSessionSchedule | undefined {
  const day = daysById.get(slot.day);
  if (!day || !day.published) return undefined;
  const track = slot.track ? tracksById.get(slot.track) : undefined;
  return {
    dayDate: day.local_date,
    dayTitle: day.title,
    startAt: slot.start_at,
    endAt: slot.end_at,
    trackName: track?.name || undefined,
    locationLabel: slot.location_label || track?.location_label || undefined,
  };
}

/** Maps raw records into the public agenda's allowlisted Day/Slot read model. */
export function buildPublicAgenda(
  days: ConferenceDayRecord[],
  tracks: AgendaTrackRecord[],
  slots: AgendaSlotRecord[],
  sessions: SessionRecord[],
): PublicAgenda {
  const visibleDays = days
    .filter((day) => day.published)
    .sort((a, b) => Number(a.display_order) - Number(b.display_order) || a.local_date.localeCompare(b.local_date));
  const tracksById = new Map(tracks.map((track) => [track.id, track]));
  const sessionsById = new Map(sessions.filter((session) => session.published).map((session) => [session.id, session]));

  return {
    days: visibleDays.map((day) => {
      const slotRows = slots
        .filter((slot) => slot.published && slot.day === day.id)
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
        if (track && track.day !== day.id) continue;
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

      return {
        key: day.key,
        localDate: day.local_date,
        title: day.title,
        slots: visibleSlots,
      };
    }),
  };
}
