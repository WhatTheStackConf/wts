import type { SpeakerRecord } from "~/lib/pocketbase-types";

/** Organizer-confirmed assignments for WTS 2026, keyed by immutable Track keys.
 * Public Stage 1/2/3 have keys stage-2/stage-3/stage-1 respectively.
 * Fireside hosts are independent Session participants, not stage MCs.
 */
const mainDayStageMcs: Readonly<Record<string, string>> = {
  "stage-2": "tony-edwards",
  "stage-3": "stojan-ezhov",
  "stage-1": "dimitar-grozdanov",
  "stage-4": "nikola-dinevski",
  "stage-5": "marijana-ilovska-zlatanovska",
};

export function stageMcRecords(eventId: string, trackKey: string, speakers: ReadonlyMap<string, SpeakerRecord>): SpeakerRecord[] {
  if (eventId !== "wts2026appevent") return [];
  const slug = mainDayStageMcs[trackKey];
  if (!slug) return [];
  return [...speakers.values()].filter((speaker) => speaker.slug === slug && speaker.published
    && speaker.is_mc === true && speaker.appearance_events?.includes(eventId));
}
