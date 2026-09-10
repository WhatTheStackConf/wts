import { conferenceWeekTracks } from "~/lib/conference-week";
import type { HiEventsRelease } from "~/lib/hievents";

/** Free weekday reservations are independent admission, not conference add-ons. */
export function groupTicketReleases(releases: readonly HiEventsRelease[]) {
  const freeIds = conferenceWeekTracks.flatMap((track) => track.freeTicketProductId ? [track.freeTicketProductId] : []);
  const isBase = (release: HiEventsRelease) => release.title === "Conference entry" || release.title === "Student Ticket";
  return {
    base: releases.filter(isBase),
    addOns: releases.filter((release) => !isBase(release) && !freeIds.includes(release.id)),
    preConference: freeIds.flatMap((id) => releases.filter((release) => release.id === id)),
  };
}
