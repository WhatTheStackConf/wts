import { conferenceWeekTracks } from "~/lib/conference-week";
import type { AppearanceEventRecord, SessionRecord, SpeakerRecord } from "~/lib/pocketbase-types";
import { publicAgendaSession, publicAgendaSpeakers, type PublicEventProgramme, type PublicSessionSchedule } from "~/lib/programme-public";

/** Organizer-confirmed running order and 30-minute slots, Europe/Skopje.
 * Session assignments reuse the public Angular lineup, not main-day talks.
 * Kiril's Angular topic is still unannounced; do not create a fake Session.
 */
export const angularDayTalks = [
  { speaker: "nicolas-frizzarin", session: "same-crud-10-times", start: "10:30", end: "11:00", block: "Block 1" },
  { speaker: "angel-petrushevski", session: "beyond-the-chatbox", start: "11:00", end: "11:30", block: "Block 1" },
  { speaker: "aleksandar-atanasov", session: "offline-first-zero-cost", start: "11:30", end: "12:00", block: "Block 1" },
  { speaker: "santosh-yadav", session: "the-monorepo-multiplier", start: "12:15", end: "12:45", block: "Block 2" },
  { speaker: "kiril-zafirov", session: undefined, start: "12:45", end: "13:15", block: "Block 2" },
  { speaker: "michael-egger-zikes", session: "probabilistic-ai-to-deterministic-applications", start: "13:15", end: "13:45", block: "Block 2" },
] as const;

const angularDay = conferenceWeekTracks.find((item) => item.name === "Angular Day")!;
const date = angularDay.date!;
const locationLabel = angularDay.locationLabel;
const instant = (time: string) => `${date}T${time}:00+02:00`;

export function angularDaySessionSchedule(session: SessionRecord, event: AppearanceEventRecord): PublicSessionSchedule | undefined {
  const talk = angularDayTalks.find((item) => item.session === session.slug);
  if (!talk || !session.published || !event.published || event.name !== "Angular Day") return undefined;
  return {
    dayDate: date,
    dayTitle: event.name,
    event: { name: event.name, compactLabel: event.compact_label || event.name },
    startAt: instant(talk.start),
    endAt: instant(talk.end),
    locationLabel,
  };
}

export function buildAngularDayProgramme(
  event: AppearanceEventRecord,
  sessions: SessionRecord[],
  speakers: SpeakerRecord[],
): PublicEventProgramme {
  const copy = angularDay;
  const publicSpeakers = speakers.filter((speaker) => speaker.published);
  const speakersById = new Map(publicSpeakers.map((speaker) => [speaker.id, speaker]));
  const eventSpeakers = publicSpeakers.filter((speaker) => speaker.appearance_events?.includes(event.id));
  const sessionsBySlug = new Map(sessions.filter((session) => session.published).map((session) => [session.slug, session]));
  const scheduledSpeakers = new Set<string>();
  const talkSlots = angularDayTalks.map((talk) => {
    const session = talk.session ? sessionsBySlug.get(talk.session) : undefined;
    const speaker = eventSpeakers.find((item) => item.slug === talk.speaker);
    if (speaker) scheduledSpeakers.add(speaker.id);
    for (const id of session?.speakers || []) scheduledSpeakers.add(id);
    return {
      kind: session ? "session" as const : "other" as const,
      startAt: instant(talk.start),
      endAt: instant(talk.end),
      locationLabel,
      session: session ? publicAgendaSession(session, speakersById) : undefined,
      speakers: !session && speaker ? publicAgendaSpeakers([speaker]) : undefined,
      title: session ? undefined : `${speaker?.display_name || "Speaker"} — Topic: TBD`,
      summary: talk.block,
    };
  });
  const programmeItem = (kind: "opening" | "break", start: string, end: string, title: string) => ({
    kind, startAt: instant(start), endAt: instant(end), title, locationLabel,
  });
  return {
    event: { name: event.name, compactLabel: event.compact_label || event.name, destinationUrl: copy.href || event.destination_url || undefined },
    tracks: [],
    details: {
      summary: copy.summary,
      access: copy.access,
      cta: copy.cta,
      unassignedSpeakers: publicAgendaSpeakers(eventSpeakers.filter((speaker) => !scheduledSpeakers.has(speaker.id))),
    },
    slots: [
      programmeItem("opening", copy.startTime!, angularDayTalks[0].start, "Doors open"),
      ...talkSlots.slice(0, 3),
      programmeItem("break", angularDayTalks[2].end, angularDayTalks[3].start, "Break"),
      ...talkSlots.slice(3),
      programmeItem("break", angularDayTalks[5].end, copy.endTime!, "Break"),
    ],
  };
}
