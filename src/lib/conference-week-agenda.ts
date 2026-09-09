import { conferenceGuideContent } from "~/lib/conference-guide-content";
import { conferenceWeekTracks, farisWorkshopTime } from "~/lib/conference-week";
import type { AppearanceEventRecord, SessionRecord, SpeakerRecord } from "~/lib/pocketbase-types";
import type { PublicAgenda, PublicEventProgramme, PublicSessionAnnouncement, PublicSessionSchedule } from "~/lib/programme-public";
import { publicAgendaSession, publicAgendaSpeakers } from "~/lib/programme-public";

/** Explicit session assignments, not inferred from a speaker's other appearances.
 * Dates and entry details reuse the already-announced homepage week copy.
 * Only organizer-confirmed session starts/ends are projected; unknowns stay absent.
 */
export const untimedWeekProgrammes = [
  { name: "InfoSec Monday", eventName: "InfoSec Monday", sessions: ["requests-lies-and-stack-traces"] },
  { name: "Workshop Tuesday: iOS + AI", eventName: "Workshop Tuesday", sessions: [
    "ddd-for-ai-assisted-development", "fundamentals-of-native-ios-development",
  ] },
  { name: "DevFest", eventName: "DevFest", sessions: [
    "agentic-accessibility", "designing-multi-agent-systems-sequential-parallel-and-beyond-with-adk",
    "building-a-distributed-multi-agent-system",
  ], details: {
    title: "Pre-DevFest Days: Day Zero x WhatThe(Google)Stack",
    locationLabel: "Faculty of Computer Science & Engineering (FINKI), Skopje",
  } },
  { name: "MAUI Day", eventName: "MAUI Day", sessions: [
    "building-your-first-net-maui-app-workshop",
    "ai-assisted-repository-in-net-maui",
    "building-efficient-offline-ai-agents-with-net-maui-semantic-kernel-and-slm",
    "bulletproof-net-maui-building-apps-that-don-t-crash",
    "xaml-c-expressions-hotreload-and-plenty-of-other-improvements-making-xaml-relevant-in-2026",
    "the-secret-life-of-a-maui-page",
  ] },
  { name: "Workshop Thursday", eventName: "Workshop Thursday", sessions: [
    "workshop-payments-and-monetization-at-scale-for-frontend-engineers",
  ] },
  { name: "Angular Day", eventName: "Angular Day", includeUnassignedSpeakers: true, sessions: [
    // The other published Signal Forms record duplicates this speaker/title.
    "probabilistic-ai-to-deterministic-applications",
    "same-crud-10-times", "beyond-the-chatbox", "offline-first-zero-cost", "the-monorepo-multiplier",
  ] },
] as const;

function preConferenceLocation(): string {
  const venue = conferenceGuideContent.preConferenceVenue;
  return `${venue.name}, ${venue.address}`;
}

/** Preserve event/date-only announcements without treating event starts as talk starts. */
export function announcedWeekSessionAppearance(
  session: SessionRecord,
  events: AppearanceEventRecord[],
): PublicSessionAnnouncement | undefined {
  if (!session.published) return undefined;
  const definition = untimedWeekProgrammes.find((item) => item.sessions.some((slug) => slug === session.slug));
  if (!definition) return undefined;
  const event = events.find((item) => item.published && item.name === definition.eventName);
  const copy = conferenceWeekTracks.find((item) => item.name === definition.name);
  if (!event || !copy?.date) return undefined;
  return {
    dayDate: copy.date,
    event: { name: copy.name, compactLabel: event.compact_label || copy.name, destinationUrl: copy.href || event.destination_url || undefined },
    eventStartTime: copy.startTime,
    locationLabel: "details" in definition ? definition.details.locationLabel : undefined,
  };
}

/** Only organizer-confirmed session times; event starts never imply talk starts.
 * These September 2026 dates are UTC+02:00 in Europe/Skopje.
 */
export function announcedWeekSessionSchedule(
  session: SessionRecord,
  events: AppearanceEventRecord[],
): PublicSessionSchedule | undefined {
  if (!session.published) return undefined;
  const definition = untimedWeekProgrammes.find((item) => item.sessions.some((slug) => slug === session.slug));
  const isFarisWorkshop = session.slug === "workshop-payments-and-monetization-at-scale-for-frontend-engineers";
  if (!definition || (!isFarisWorkshop && !["InfoSec Monday", "Workshop Tuesday"].includes(definition.eventName))) return undefined;
  const event = events.find((item) => item.published && item.name === definition.eventName);
  const copy = conferenceWeekTracks.find((item) => item.name === definition.name);
  if (!event || !copy?.date) return undefined;
  const timing = isFarisWorkshop ? farisWorkshopTime : copy;
  if (!timing.startTime) return undefined;
  const start = session.slug === "fundamentals-of-native-ios-development" ? "18:00" : timing.startTime;
  return {
    dayDate: copy.date,
    dayTitle: copy.name,
    event: { name: copy.name, compactLabel: event.compact_label || copy.name },
    startAt: `${copy.date}T${start}:00+02:00`,
    endAt: timing.endTime ? `${copy.date}T${timing.endTime}:00+02:00` : undefined,
    locationLabel: preConferenceLocation(),
  };
}

/** Add only announced weekday lineups; never expose private PocketBase draft slots.
 * An existing published timed programme takes precedence over its TBA fallback.
 */
export function addAnnouncedWeekProgrammes(
  agenda: PublicAgenda,
  events: AppearanceEventRecord[],
  sessions: SessionRecord[],
  speakers: SpeakerRecord[],
): PublicAgenda {
  const days = agenda.days.map((day) => ({ ...day, programmes: [...day.programmes] }));
  const visibleSessions = new Map(sessions.filter((session) => session.published).map((session) => [session.slug, session]));
  const visibleSpeakers = new Map(speakers.filter((speaker) => speaker.published).map((speaker) => [speaker.id, speaker]));

  for (const definition of untimedWeekProgrammes) {
    const copy = conferenceWeekTracks.find((track) => track.name === definition.name);
    const event = events.find((item) => item.published && item.name === definition.eventName);
    if (!copy?.date || !event) continue;
    let day = days.find((item) => item.localDate === copy.date);
    if (day?.programmes.some((programme) => programme.event.name === event.name || programme.event.name === copy.name)) continue;
    if (!day) {
      day = { key: `week-${copy.date}`, localDate: copy.date, title: copy.date === "2026-09-17" ? "MAUI Day & Workshop Thursday" : copy.name, programmes: [] };
      days.push(day);
    }
    const selectedSessions = definition.sessions.flatMap((slug) => {
      const session = visibleSessions.get(slug);
      return session ? [session] : [];
    });
    const assignedSpeakerIds = new Set(selectedSessions.flatMap((session) => session.speakers || []));
    const programme: PublicEventProgramme = {
      event: { name: copy.name, compactLabel: event.compact_label || copy.name, destinationUrl: copy.href || event.destination_url || undefined },
      tracks: [],
      slots: [],
      untimed: {
        startTime: copy.startTime,
        endTime: copy.endTime,
        ...(["InfoSec Monday", "Workshop Tuesday"].includes(definition.eventName) ? { locationLabel: preConferenceLocation() } : {}),
        ...("includeUnassignedSpeakers" in definition ? {
          unassignedSpeakers: publicAgendaSpeakers(speakers.filter((speaker) =>
            speaker.appearance_events?.includes(event.id) && !assignedSpeakerIds.has(speaker.id))),
        } : {}),
        ...("details" in definition ? {
          title: definition.details.title,
          locationLabel: definition.details.locationLabel,
          // Published event appearances announce speakers independently of sessions.
          speakers: publicAgendaSpeakers(speakers.filter((speaker) => speaker.appearance_events?.includes(event.id))),
        } : {}),
        summary: copy.summary,
        access: copy.access,
        cta: copy.cta,
        highlights: copy.highlights ? [...copy.highlights] : undefined,
        sessions: selectedSessions.map((session) => ({
          ...publicAgendaSession(session, visibleSpeakers),
          schedule: announcedWeekSessionSchedule(session, events),
        })),
      },
    };
    day.programmes.push(programme);
  }
  return { days: days.sort((a, b) => a.localDate.localeCompare(b.localDate)) };
}
