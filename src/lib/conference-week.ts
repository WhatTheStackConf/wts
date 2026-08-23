/**
 * Copy for the "full week" homepage section.
 *
 * Track names match the published `appearance_events` records so the public
 * vocabulary stays consistent with speaker ribbons and the agenda filters.
 * `date` is omitted wherever the schedule is not confirmed yet, mirroring the
 * announced / not_announced convention in `content/conference-guide.json`.
 */

export const conferenceWeekRange = "14-19 September 2026";

export const conferenceWeekEyebrow = "A full week of WhatTheStack";

export const conferenceWeekHeadline = "Six days. One campus. The whole stack.";

export const conferenceWeekIntro =
  "WhatTheStack 2026 is no longer a single Saturday. The week ahead of the main conference turns into focused mini-conferences and hands-on workshops, each one a full day of its own programme.";

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
      "A dedicated cybersecurity and application-security workshop to open the week.",
    access: "Ticket holders only. Limited availability, registration opens closer to the date.",
  },
  {
    name: "Coming Soon",
    date: "2026-09-15",
    summary:
      "One more full day of the programme. We are lining it up and will announce it here.",
    placeholder: true,
  },
  {
    name: "DevFest",
    date: "2026-09-16",
    summary:
      "Pre-DevFest Days: Day Zero x WhatThe(Google)Stack, with GDG Skopje - practical AI, accessibility, and agentic systems.",
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
      "A full day on .NET MAUI and cross-platform development at FINKI, with experts from the international .NET ecosystem.",
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
      "Hands-on pre-conference workshops on software architecture, payments, and frontend engineering - far deeper than a conference slot allows.",
    access: "Workshop add-on, selected at checkout",
  },
  {
    name: "Angular Day",
    date: "2026-09-18",
    summary:
      "A full day for Angular and frontend engineering, built with the international and local Angular community.",
    access: "Included with your WhatTheStack ticket",
  },
  {
    name: "Main Conference Day",
    date: "2026-09-19",
    summary:
      "The week culminates at the Technical Campus, taking over FINKI, FEIT, and the Faculty of Mechanical Engineering. Five stages, an expo, a game corner, and an outdoor after-party to close the week out.",
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
