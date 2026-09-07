import { conferenceWeekTracks } from "~/lib/conference-week";
import type { AppearanceEventRecord, SessionRecord, SpeakerRecord } from "~/lib/pocketbase-types";
import type { PublicAgenda, PublicEventProgramme } from "~/lib/programme-public";
import { publicAgendaSession, publicAgendaSpeakers } from "~/lib/programme-public";

/** Explicit session assignments, not inferred from a speaker's other appearances.
 * Dates and entry details reuse the already-announced homepage week copy.
 * These are unordered lineups: no start/end instants are fabricated.
 */
export const untimedWeekProgrammes = [
  { name: "InfoSec Monday", eventName: "InfoSec Monday", sessions: ["requests-lies-and-stack-traces"] },
  { name: "Workshop Tuesday: iOS + AI", eventName: "Workshop Tuesday", sessions: [
    "fundamentals-of-native-ios-development", "ddd-for-ai-assisted-development",
  ] },
  { name: "DevFest", eventName: "DevFest", sessions: [
    "agentic-accessibility", "designing-multi-agent-systems-sequential-parallel-and-beyond-with-adk",
  ], details: {
    title: "Pre-DevFest Days: Day Zero x WhatThe(Google)Stack",
    locationLabel: "Faculty of Computer Science & Engineering (FINKI), Skopje",
    // The official page announces speakers separately, without pairing them to talks.
    speakers: ["roushanak-rahmat", "josefine-schaefer"],
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
  { name: "Angular Day", eventName: "Angular Day", sessions: [
    // The other published Signal Forms record duplicates this speaker/title.
    "probabilistic-ai-to-deterministic-applications",
    "same-crud-10-times", "beyond-the-chatbox", "offline-first-zero-cost",
  ] },
] as const;

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
    const programme: PublicEventProgramme = {
      event: { name: copy.name, compactLabel: event.compact_label || copy.name, destinationUrl: copy.href || event.destination_url || undefined },
      tracks: [],
      slots: [],
      untimed: {
        ...("details" in definition ? {
          title: definition.details.title,
          locationLabel: definition.details.locationLabel,
          speakers: publicAgendaSpeakers(speakers.filter((speaker) =>
            definition.details.speakers.some((slug) => slug === speaker.slug) && speaker.appearance_events?.includes(event.id))),
        } : {}),
        summary: copy.summary,
        access: copy.access,
        cta: copy.cta,
        highlights: copy.highlights ? [...copy.highlights] : undefined,
        sessions: definition.sessions.flatMap((slug) => {
          const session = visibleSessions.get(slug);
          if (!session) return [];
          return [publicAgendaSession(session, visibleSpeakers)];
        }),
      },
    };
    day.programmes.push(programme);
  }
  return { days: days.sort((a, b) => a.localDate.localeCompare(b.localDate)) };
}
