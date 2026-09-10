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
  "Smaller events and workshops run through the week before everyone meets at the main conference on Saturday. InfoSec Monday, Workshop Tuesday, and Angular Day are free, with limited seats: reserve a ticket for each event you want to attend. DevFest, MAUI Day, and Thursday's workshop have their own registration.";

export interface ConferenceWeekTrack {
  /** Matches the `name` of the corresponding published appearance event. */
  name: string;
  /** ISO date, only where the schedule is confirmed. */
  date?: string;
  /** Confirmed local clock times in Europe/Skopje; absent means unannounced. */
  startTime?: string;
  endTime?: string;
  summary: string;
  /** Named draws for this track. Kept short; the Speakers section carries the full roster. */
  highlights?: readonly string[];
  /** Programme areas, listed on the wide main-conference card. */
  topics?: readonly string[];
  /** Trails the named speakers with "and more...", where the lineup is still growing. */
  moreSpeakers?: boolean;
  /** Entry details for free events or events covered by the WhatTheStack ticket. */
  access?: string;
  /** Independent free reservations in the WTS 2026 Hi.Events catalogue. */
  freeTicketProductId?: number;
  /** Days needing their own entry get an action instead of a note. */
  cta?: { label: string; href: string };
  /** An unannounced day, rendered as a teaser rather than a bookable track. */
  placeholder?: boolean;
  /** Spans the grid, for the day the whole week builds towards. */
  fullWidth?: boolean;
  /** The track's own event page. */
  href?: string;
}

export const farisWorkshopTime = { startTime: "16:30", endTime: "20:00" } as const;

// This Hi.Events deployment supports event checkout, not product query links.
export const conferenceWeekBookingUrl = "https://hievents.foundry.mk/event/5/whatthestack-2026";

export const conferenceWeekTracks: readonly ConferenceWeekTrack[] = [
  {
    name: "InfoSec Monday",
    date: "2026-09-14",
    startTime: "14:00",
    endTime: "18:00",
    summary:
      "Requests, Lies, and Stack Traces: a four-hour, hands-on API security workshop at Base42 Hackerspace. Break and fix vulnerabilities, including the mistakes that keep appearing in AI-generated code.",
    access: "Free entry. 20 seats; one ticket covers InfoSec Monday and its workshop.",
    freeTicketProductId: 15,
    cta: { label: "Reserve a free ticket", href: conferenceWeekBookingUrl },
    href: "/agenda?day=2026-09-14",
  },
  {
    name: "Workshop Tuesday: iOS + AI",
    date: "2026-09-15",
    startTime: "16:00",
    summary:
      "DDD for AI-Assisted Development at 16:00, followed by Fundamentals of Native iOS Development at 18:00. Both sessions take place at Base42 Hackerspace; one ticket covers the whole evening.",
    access: "Free entry. 50 seats; reserve your ticket.",
    freeTicketProductId: 16,
    cta: { label: "Reserve a free ticket", href: conferenceWeekBookingUrl },
    href: "/agenda?day=2026-09-15",
  },
  {
    name: "DevFest",
    date: "2026-09-16",
    startTime: "17:00",
    summary:
      "GDG Skopje takes Wednesday: practical AI, accessibility, and agentic systems at Pre-DevFest Days: Day Zero x WhatThe(Google)Stack.",

    cta: {
      label: "Grab a GDG ticket",
      href: "https://gdg.community.dev/events/details/google-gdg-skopje-presents-pre-devfest-days-day-zero-x-whatthegooglestack-2/",
    },
    href: "https://gdg.community.dev/events/details/google-gdg-skopje-presents-pre-devfest-days-day-zero-x-whatthegooglestack-2/",
  },
  {
    name: "MAUI Day",
    date: "2026-09-17",
    startTime: "10:00",
    summary:
      "A full day of .NET MAUI at FINKI: build your first app, explore offline AI agents, improve reliability, and get into XAML, hot reload, and how MAUI pages work.",
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
      `Faris Aziz's Payments and Monetization at Scale for Frontend Engineers workshop runs ${farisWorkshopTime.startTime}–${farisWorkshopTime.endTime} (3.5 hours, Skopje time) at Base42 Hackerspace. Work through checkout, subscriptions, and payment failures with React, Next.js, and Stripe.`,
    cta: {
      label: "Get a workshop ticket",
      href: conferenceWeekBookingUrl,
    },
    href: "/sessions/workshop-payments-and-monetization-at-scale-for-frontend-engineers",
  },
  {
    name: "Angular Day",
    date: "2026-09-18",
    summary:
      "Angular and frontend engineering with Angular Macedonia and the international community: AI-powered applications, offline-first development, and monorepo architecture. Explore the programme for announced talks and speakers.",
    access: "Free entry. 50 seats; reserve your ticket.",
    freeTicketProductId: 17,
    cta: { label: "Reserve a free ticket", href: conferenceWeekBookingUrl },
    href: "/agenda?day=2026-09-18",
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
    href: "/agenda?day=2026-09-19",
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
