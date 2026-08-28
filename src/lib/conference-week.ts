/**
 * Copy for the "full week" homepage section.
 *
 * Track names match the published `appearance_events` records so the public
 * vocabulary stays consistent with speaker ribbons and the agenda filters.
 * `date` is omitted wherever the schedule is not confirmed yet, mirroring the
 * announced / not_announced convention in `content/conference-guide.json`.
 */

export const conferenceWeekRange = "14-19 September 2026";

export const conferenceWeekEyebrow = "WhatTheStack, Monday to Saturday";

export const conferenceWeekHeadline = "Saturday's the main event. We start Monday.";

export const conferenceWeekIntro =
  "That's how we've always done it. Smaller events and workshops run through the week before everyone meets at the main conference on Saturday. Some events are included with your WTS ticket; a couple need a separate one.";

export interface ConferenceWeekTrack {
  /** Matches the `name` of the corresponding published appearance event. */
  name: string;
  /** ISO date, only where the schedule is confirmed. */
  date?: string;
  summary: string;
  /** Named draws for this track. Kept short; the Speakers section carries the full roster. */
  highlights?: readonly string[];
  /** Programme areas, listed on the wide main-conference card. */
  topics?: readonly string[];
  /** Trails the named speakers with "and more...", where the lineup is still growing. */
  moreSpeakers?: boolean;
  /** How to get in, when the WhatTheStack ticket already covers it. */
  access?: string;
  /** Days needing their own entry get an action instead of a note. */
  cta?: { label: string; href: string };
  /** An unannounced day, rendered as a teaser rather than a bookable track. */
  placeholder?: boolean;
  /** Spans the grid, for the day the whole week builds towards. */
  fullWidth?: boolean;
  /** The track's own event page. */
  href?: string;
}

export const conferenceWeekTracks: readonly ConferenceWeekTrack[] = [
  {
    name: "InfoSec Monday",
    date: "2026-09-14",
    summary:
      "We start with a full-day cybersecurity and application-security workshop.",
    access: "Included with your WTS ticket. Seats are limited; registration opens closer to September.",
  },
  {
    name: "Coming Soon",
    date: "2026-09-15",
    summary:
      "Tuesday is booked. The announcement isn't ready yet, which is why this card is being annoyingly vague.",
    placeholder: true,
  },
  {
    name: "DevFest",
    date: "2026-09-16",
    summary:
      "GDG Skopje takes Wednesday: practical AI, accessibility, and agentic systems at Pre-DevFest Days: Day Zero x WhatThe(Google)Stack.",
    highlights: [
      "Roushanak Rahmat, IBM - Google Developer Expert in AI & Cloud",
      "Josefine Schaefer, Storyblok - GDE and Accessibility Engineer",
    ],
    moreSpeakers: true,
    cta: {
      label: "Grab a GDG ticket",
      href: "https://gdg.community.dev/events/details/google-gdg-skopje-presents-pre-devfest-days-day-zero-x-whatthegooglestack-2/",
    },
    href: "https://gdg.community.dev/events/details/google-gdg-skopje-presents-pre-devfest-days-day-zero-x-whatthegooglestack-2/",
  },
  {
    name: "MAUI Day",
    date: "2026-09-17",
    summary:
      ".NET MAUI gets a full day at FINKI, with speakers from Microsoft and the wider .NET community.",
    highlights: ["Stephane Delcroix, Principal Software Engineer at Microsoft"],
    moreSpeakers: true,
    cta: {
      label: "Register for MAUI Day",
      href: "https://www.eventbrite.nl/e/net-maui-day-skopje-2026-tickets-1992309951697",
    },
    href: "https://mauiday.net/skopje",
  },
  {
    name: "Workshop Thursday",
    date: "2026-09-17",
    summary:
      "Long-form workshops on software architecture, payments, and frontend engineering. The kind of sessions that don't fit into 35 minutes.",
    access: "Workshop add-on, selected at checkout",
  },
  {
    name: "Angular Day",
    date: "2026-09-18",
    summary:
      "Angular and frontend engineering, put together with the local and international Angular community.",
    access: "Included with your WTS ticket",
  },
  {
    name: "Main Conference Day",
    date: "2026-09-19",
    summary:
      "Saturday is the big one: five stages across FINKI, FEIT, and the Faculty of Mechanical Engineering, plus the expo, game corner, and an outdoor after-party.",
    topics: [
      "AI and Machine Learning",
      "Web",
      "Cloud and Infrastructure",
      "DevOps",
      "Security",
      "Architecture",
      "Developer Tooling",
      "Open Source",
      "Careers and Engineering Culture",
    ],
    fullWidth: true,
  },
];

export const conferenceWeekCta = {
  text: "GRAB A TICKET",
  href: "/tickets",
} as const;

/** Long weekday plus day and month, in the conference time zone. */
export function conferenceWeekDayLabel(isoDate: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${isoDate}T12:00:00.000Z`));
}
