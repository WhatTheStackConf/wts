import { conferenceGuide } from ".velite";

export const conferenceGuideContent = conferenceGuide;
export const conferenceName = conferenceGuide.event.name;
export const conferenceTimeZone = conferenceGuide.event.timeZone.iana;
export const conferenceLocation = `${conferenceGuide.event.location.city}, ${conferenceGuide.event.location.country}`;

function formatConferenceDate(options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: conferenceTimeZone,
    ...options,
  }).format(new Date(`${conferenceGuide.event.date.localDate}T12:00:00.000Z`));
}

export const conferenceLongDate = formatConferenceDate({
  month: "long",
  day: "numeric",
  year: "numeric",
});

export const conferenceShortDate = formatConferenceDate({
  month: "long",
  day: "numeric",
});

export const conferenceDefaultDescription =
  `All things software, all things code. ${conferenceShortDate}, ${conferenceGuide.event.location.city}.`;
export const conferenceDefaultOgSubtitle = `${conferenceShortDate} // ${conferenceLocation}`;

export function conferenceTicketPrice(kind: "regular" | "student"): string {
  const ticket = conferenceGuide.tickets[kind];
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: ticket.currency,
    maximumFractionDigits: 0,
  }).format(ticket.amount);
}
