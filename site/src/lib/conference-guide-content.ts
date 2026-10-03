import conferenceGuideData from "../../content/conference-guide.json";
import { conferenceGuideSchema } from "~/lib/conference-guide-schema";
import type { ConferenceGuide } from "~/lib/conference-guide-schema";

const conferenceGuide = conferenceGuideSchema.parse(conferenceGuideData);

export const conferenceGuideContent = conferenceGuide;
export const conferenceName = conferenceGuide.event.name;
export const publicEditionName = `${conferenceName} 2027`;

export function announcedConferenceTimeZone(content: ConferenceGuide): string | undefined {
  return content.event.timeZone.status === "announced"
    ? content.event.timeZone.iana
    : undefined;
}

export const conferenceTimeZone = announcedConferenceTimeZone(conferenceGuide);
export const conferenceLocation = conferenceGuide.event.location.status === "announced"
  && conferenceGuide.event.location.city && conferenceGuide.event.location.country
  ? `${conferenceGuide.event.location.city}, ${conferenceGuide.event.location.country}`
  : undefined;

function formatConferenceDate(options: Intl.DateTimeFormatOptions): string {
  const localDate = conferenceGuide.event.date.status === "announced"
    ? conferenceGuide.event.date.localDate
    : undefined;
  if (!localDate) return "Not announced";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    ...options,
  }).format(new Date(`${localDate}T12:00:00.000Z`));
}

export const conferenceLongDate = formatConferenceDate({ month: "long", day: "numeric", year: "numeric" });
export const conferenceShortDate = formatConferenceDate({ month: "long", day: "numeric" });
export const conferenceDefaultDescription = "All things software, all things code. A community for people who build software.";
export const conferenceDefaultOgSubtitle = "All things software. All things code.";

export function conferenceTicketPrice(kind: "regular" | "student"): string {
  const ticket = conferenceGuide.tickets[kind];
  if (conferenceGuide.tickets.status !== "announced" || !ticket) return "Not announced";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: ticket.currency,
    maximumFractionDigits: 0,
  }).format(ticket.amount);
}
