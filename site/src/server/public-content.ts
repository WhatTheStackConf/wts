import { z } from "zod";
import type { PublicAgendaEvent, PublicAgendaSession, PublicAgendaSlot, PublicAgendaTrack, PublicConferenceSnapshot, PublicPartnerGroup, PublicSessionDetail, PublicSessionSchedule, PublicSpeakerDetail, PublicSpeakerSummary } from "../lib/public-contract.ts";
import { editionIdSchema, publicationGraphSchema, type PublicationGraph } from "../lib/publication-schema.ts";
import { openSiteDatabase } from "./storage.ts";

const partnerGroups: Omit<PublicPartnerGroup, "partners">[] = [
  { id: "organizers", title: "Organizers", kind: "organizer", type: "organizer" },
  { id: "platinum-sponsors", title: "Platinum Sponsors", kind: "sponsor", type: "sponsor", tier: "platinum" },
  { id: "gold-sponsors", title: "Gold Sponsors", kind: "sponsor", type: "sponsor", tier: "gold" },
  { id: "silver-sponsors", title: "Silver Sponsors", kind: "sponsor", type: "sponsor", tier: "silver" },
  { id: "bronze-sponsors", title: "Bronze Sponsors", kind: "sponsor", type: "sponsor", tier: "bronze" },
  { id: "bank-sponsors", title: "Bank Sponsor", kind: "sponsor", type: "sponsor", tier: "bank" },
  { id: "media-partners", title: "Media Partners", kind: "partner", type: "media" },
  { id: "supporters", title: "Supporters", kind: "partner", type: "supporter" },
  { id: "community-partners", title: "Community Partners", kind: "partner", type: "community_partner" },
  { id: "bytes-and-beverages", title: "Bytes and Beverages", kind: "partner", type: "catering" },
  { id: "other-partners", title: "Other Partners", kind: "partner", type: "other" },
];

export function mapPublicConference(graph: PublicationGraph): PublicConferenceSnapshot {
  const speakersById = new Map(graph.speakers.map((row) => [row.id, row]));
  const sessionsById = new Map(graph.sessions.map((row) => [row.id, row]));
  const eventsById = new Map(graph.appearanceEvents.map((row) => [row.id, row]));
  const tracksById = new Map(graph.tracks.map((row) => [row.id, row]));
  const byName = <T extends { displayName: string; slug: string }>(a: T, b: T) => a.displayName.localeCompare(b.displayName, "en", { sensitivity: "base" }) || a.slug.localeCompare(b.slug, "en");
  const byTitle = <T extends { title: string; slug: string }>(a: T, b: T) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }) || a.slug.localeCompare(b.slug, "en");
  const eventDto = (row: PublicationGraph["appearanceEvents"][number]): PublicAgendaEvent => ({ name: row.name, compactLabel: row.compactLabel || row.name, destinationUrl: row.destinationUrl || undefined });
  const trackDto = (row: PublicationGraph["tracks"][number]): PublicAgendaTrack => ({ key: row.key, name: row.name, locationLabel: row.locationLabel || undefined });
  const agendaSpeakers = (ids: string[]): PublicAgendaSession["speakers"] => ids.flatMap((id) => {
    const row = speakersById.get(id);
    return row ? [{ slug: row.slug, name: row.displayName || row.slug || "Speaker", photoUrl: row.photoAssetId ? `/media/${row.photoAssetId}` : null }] : [];
  }).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const cardsBySpeaker = new Map(graph.speakers.map((speaker) => [speaker.id, graph.sessions.filter((session) => session.speakerIds.includes(speaker.id)).map((session) => ({ slug: session.slug, title: session.title, format: session.format || undefined })).sort(byTitle)]));
  const summariesById = new Map<string, PublicSpeakerSummary>(graph.speakers.map((row) => {
    const assigned = new Set(graph.appearances.filter((appearance) => appearance.speakerId === row.id).map((appearance) => appearance.eventId));
    const appearanceEvents = graph.appearanceEvents.filter((event) => assigned.has(event.id)).sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name, undefined, { sensitivity: "base" })).map((event) => ({ name: event.name, compactLabel: event.compactLabel || event.name }));
    return [row.id, { slug: row.slug, displayName: row.displayName || row.slug || "Speaker", photoUrl: row.photoAssetId ? `/media/${row.photoAssetId}` : null, affiliation: row.affiliation || "", isMc: row.isMc, sessionCount: cardsBySpeaker.get(row.id)?.length ?? 0, appearanceEvents }];
  }));
  const schedules = new Map<string, PublicSessionSchedule>();
  const days = [...graph.days].sort((a, b) => a.displayOrder - b.displayOrder || a.localDate.localeCompare(b.localDate)).map((day) => ({
    key: day.key, localDate: day.localDate, title: day.title,
    programmes: graph.programmes.filter((programme) => programme.dayId === day.id).sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id)).flatMap((programme) => {
      const event = eventsById.get(programme.eventId);
      if (!event) return [];
      const slots: PublicAgendaSlot[] = graph.slots.filter((slot) => slot.programmeId === programme.id).sort((a, b) => {
        const timeOrder = Date.parse(a.startAt) - Date.parse(b.startAt);
        if (timeOrder) return timeOrder;
        if (!a.trackId && b.trackId) return -1;
        if (a.trackId && !b.trackId) return 1;
        return (tracksById.get(a.trackId || "")?.displayOrder ?? 0) - (tracksById.get(b.trackId || "")?.displayOrder ?? 0) || a.displayOrder - b.displayOrder;
      }).flatMap((slot): PublicAgendaSlot[] => {
        const track = slot.trackId ? tracksById.get(slot.trackId) : undefined;
        if (track && track.programmeId !== programme.id) return [];
        const locationLabel = slot.locationLabel || track?.locationLabel || undefined;
        const common = { startAt: slot.startAt, endAt: slot.endAt, locationLabel, track: track ? trackDto(track) : undefined };
        if (slot.kind === "session") {
          const session = sessionsById.get(slot.sessionId);
          if (!session) return [];
          if (!schedules.has(session.id)) schedules.set(session.id, { dayDate: day.localDate, dayTitle: day.title, event: eventDto(event), startAt: slot.startAt, endAt: slot.endAt, trackName: track?.name || undefined, locationLabel });
          const hosts = agendaSpeakers(session.hostIds);
          return [{ ...common, kind: "session", session: { slug: session.slug, title: session.title, format: session.format || undefined, ...(hosts.length ? { hosts } : {}), speakers: agendaSpeakers(session.speakerIds) } }];
        }
        const hosts = agendaSpeakers(slot.hostIds);
        const summary = hosts.reduce((value, host) => {
          const suffix = ` Hosted by ${host.name}.`;
          return value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
        }, slot.summary || "");
        return [{ ...common, kind: slot.kind, title: slot.title || undefined, ...(hosts.length ? { speakers: hosts } : {}), summary: summary || undefined }];
      });
      return slots.length ? [{ event: eventDto(event), tracks: graph.tracks.filter((track) => track.programmeId === programme.id).sort((a, b) => a.displayOrder - b.displayOrder || a.key.localeCompare(b.key)).map(trackDto), slots }] : [];
    }),
  }));
  const sessions = graph.sessions.map((row): PublicSessionDetail => {
    const hosts = row.speakerIds.filter((id) => row.hostIds.includes(id)).flatMap((id) => { const summary = summariesById.get(id); return summary ? [summary] : []; });
    return {
      slug: row.slug, title: row.title, abstract: row.abstract, format: row.format || undefined,
      schedule: schedules.get(row.id), ...(hosts.length ? { hosts } : {}),
      speakers: row.speakerIds.flatMap((id) => { const summary = summariesById.get(id); return summary ? [summary] : []; }).sort(byName), relatedSessions: [],
    };
  }).sort(byTitle);
  const speakers = graph.speakers.flatMap((row): PublicSpeakerDetail[] => {
    const summary = summariesById.get(row.id);
    return summary ? [{ ...summary, bio: row.bio || "", socialHandles: row.socialHandles, sessions: cardsBySpeaker.get(row.id) ?? [] }] : [];
  }).sort(byName);
  const partners = [...graph.partners].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map((row) => ({ name: row.name, logoUrl: `/media/${row.logoAssetId}`, logoSurface: row.logoSurface, url: row.url || undefined, type: row.type, tier: row.tier || undefined }));
  return { agenda: { days }, sessions, speakers, partnerGroups: partnerGroups.map((group) => ({ ...group, partners: partners.filter((partner) => partner.type === group.type && (!group.tier || partner.tier === group.tier)) })) };
}

export function readPublished(editionId: string, dataDir?: string): PublicConferenceSnapshot {
  editionIdSchema.parse(editionId);
  const db = openSiteDatabase(dataDir);
  try {
    const row = z.strictObject({ graph_json: z.string() }).parse(db.prepare("SELECT s.graph_json FROM editions e JOIN programme_snapshots s ON s.snapshot_id=e.current_snapshot_id AND s.edition_id=e.edition_id WHERE e.edition_id=?").get(editionId));
    return mapPublicConference(publicationGraphSchema.parse(JSON.parse(row.graph_json)));
  } finally { db.close(); }
}
