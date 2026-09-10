import type { ConferenceWeekTrack } from "~/lib/conference-week";
import type { PublicSpeakerSummary } from "~/lib/speakers-public";

/** The input roster is already allowlisted and published by fetchPublicSpeakers. */
export function getConferenceWeekSpeakers(
  track: Pick<ConferenceWeekTrack, "name" | "fullWidth">,
  speakers: readonly PublicSpeakerSummary[] = [],
): PublicSpeakerSummary[] {
  if (track.fullWidth) return [];

  const eventName = track.name === "Workshop Tuesday: iOS + AI"
    ? "Workshop Tuesday"
    : track.name;
  const members = speakers.filter((speaker) =>
    speaker.appearanceEvents.some((event) => event.name === eventName),
  );

  return [...new Map(members.map((speaker) => [speaker.slug, speaker])).values()]
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "en"));
}
