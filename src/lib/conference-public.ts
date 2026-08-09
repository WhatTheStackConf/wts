import { getAdminPB } from "~/lib/pocketbase-admin-service";
import { getPbFileUrl } from "~/lib/pocketbase-public-url";
import {
  buildPublicAgenda,
  derivePublicSessionSchedule,
  type PublicAgenda,
  type PublicAgendaDay,
  type PublicAgendaEvent,
  type PublicAgendaSession,
  type PublicAgendaSlot,
  type PublicAgendaTrack,
  type PublicEventProgramme,
  type PublicSessionSchedule,
} from "~/lib/programme-public";
import type { AgendaSlotRecord, AgendaTrackRecord, AppearanceEventRecord, ConferenceDayRecord, EventProgrammeRecord, SpeakerRecord, SessionRecord } from "~/lib/pocketbase-types";
import {
  conferenceGuideContent,
  conferenceShortDate,
} from "~/lib/conference-guide-content";

export { getPbFileUrl } from "~/lib/pocketbase-public-url";
export type {
  PublicAgenda,
  PublicAgendaDay,
  PublicAgendaEvent,
  PublicAgendaSession,
  PublicAgendaSlot,
  PublicAgendaTrack,
  PublicEventProgramme,
  PublicSessionSchedule,
} from "~/lib/programme-public";

export interface PublicSpeakerSummary {
  slug: string;
  displayName: string;
  photoUrl: string | null;
  affiliation: string;
  sessionCount: number;
  appearanceEvents: PublicAppearanceEvent[];
}

export interface PublicAppearanceEvent {
  name: string;
  compactLabel: string;
}

export interface PublicSpeakerDetail extends PublicSpeakerSummary {
  bio: string;
  socialHandles: string[];
  sessions: PublicSessionCard[];
}

export interface PromoStackTag {
  name: string;
  color: string;
}

export interface PromoFooterLink {
  label: string;
  href: string;
  color: string;
}

export interface PublicSpeakerPromo {
  slug: string;
  displayName: string;
  photoUrl: string | null;
  roleLine: string;
  statusMessage: string;
  stack: PromoStackTag[];
  ctaHref: string;
  ctaLabel: string;
  footerText: string;
  footerLinks: PromoFooterLink[];
  footerSuffix: string;
}

interface SpeakerPromoConfig {
  statusMessage?: string;
  roleLine?: string;
  stack?: PromoStackTag[];
  ctaHref?: string;
  ctaLabel?: string;
  footerText?: string;
  footerLinks?: PromoFooterLink[];
  footerSuffix?: string;
}

const DEFAULT_PROMO_STATUS = "will be there!";
const DEFAULT_PROMO_CTA_LABEL = "See you there";
const DEFAULT_PROMO_CTA_HREF = "/tickets";
const DEFAULT_PROMO_FOOTER_TEXT = "Join us at ";
const DEFAULT_PROMO_FOOTER_SUFFIX = ` — ${conferenceShortDate}, ${conferenceGuideContent.event.location.city}`;
const DEFAULT_PROMO_FOOTER_LINKS: PromoFooterLink[] = [
  { label: "wts.sh", href: "https://wts.sh", color: "#e879f9" },
];

function parsePromoStackTag(raw: unknown): PromoStackTag | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.name !== "string" || !item.name.trim()) return null;
  const color =
    typeof item.color === "string" && item.color.trim()
      ? item.color.trim()
      : "#a855f7";
  return { name: item.name.trim(), color };
}

function parsePromoFooterLink(raw: unknown): PromoFooterLink | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (
    typeof item.label !== "string" ||
    !item.label.trim() ||
    typeof item.href !== "string" ||
    !item.href.trim()
  ) {
    return null;
  }
  const color =
    typeof item.color === "string" && item.color.trim()
      ? item.color.trim()
      : "#e879f9";
  return { label: item.label.trim(), href: item.href.trim(), color };
}

function parseSpeakerPromoConfig(raw: unknown): SpeakerPromoConfig {
  if (!raw || typeof raw !== "object") return {};
  const config = raw as Record<string, unknown>;
  const stack = Array.isArray(config.stack)
    ? config.stack
        .map(parsePromoStackTag)
        .filter((tag): tag is PromoStackTag => tag !== null)
    : undefined;
  const footerLinks = Array.isArray(config.footerLinks)
    ? config.footerLinks
        .map(parsePromoFooterLink)
        .filter((link): link is PromoFooterLink => link !== null)
    : undefined;

  return {
    statusMessage:
      typeof config.statusMessage === "string"
        ? config.statusMessage.trim()
        : undefined,
    roleLine:
      typeof config.roleLine === "string" ? config.roleLine.trim() : undefined,
    stack,
    ctaHref:
      typeof config.ctaHref === "string" ? config.ctaHref.trim() : undefined,
    ctaLabel:
      typeof config.ctaLabel === "string" ? config.ctaLabel.trim() : undefined,
    footerText:
      typeof config.footerText === "string"
        ? config.footerText
        : undefined,
    footerLinks,
    footerSuffix:
      typeof config.footerSuffix === "string"
        ? config.footerSuffix
        : undefined,
  };
}

function mapSpeakerPromo(row: SpeakerRow): PublicSpeakerPromo {
  const summary = mapSpeakerSummary(row);
  const config = parseSpeakerPromoConfig(row.promo);

  return {
    slug: summary.slug,
    displayName: summary.displayName,
    photoUrl: summary.photoUrl,
    roleLine: config.roleLine || summary.affiliation || "Speaker @ WhatTheStack",
    statusMessage: config.statusMessage || DEFAULT_PROMO_STATUS,
    stack: config.stack ?? [],
    ctaHref: config.ctaHref || DEFAULT_PROMO_CTA_HREF,
    ctaLabel: config.ctaLabel || DEFAULT_PROMO_CTA_LABEL,
    footerText: config.footerText ?? DEFAULT_PROMO_FOOTER_TEXT,
    footerLinks:
      config.footerLinks && config.footerLinks.length > 0
        ? config.footerLinks
        : DEFAULT_PROMO_FOOTER_LINKS,
    footerSuffix: config.footerSuffix ?? DEFAULT_PROMO_FOOTER_SUFFIX,
  };
}

export interface PublicSessionCard {
  slug: string;
  title: string;
  format?: string;
}

export interface PublicSessionDetail {
  slug: string;
  title: string;
  abstract: string;
  format?: string;
  schedule?: PublicSessionSchedule;
  speakers: PublicSpeakerSummary[];
  /** Populated when related-sessions feature ships; empty at launch. */
  relatedSessions: PublicSessionCard[];
}

export interface PublicConferenceGuideProgramme {
  agenda: PublicAgenda;
  sessions: PublicSessionDetail[];
  speakers: PublicSpeakerDetail[];
}


export function normalizeSocialHandles(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter((h): h is string => typeof h === "string" && h.length > 0);
  }
  if (typeof raw === "string" && raw.length > 0) return [raw];
  return [];
}

type SpeakerRow = SpeakerRecord;

function mapSpeakerSummary(
  row: SpeakerRow,
  appearanceEvents: PublicAppearanceEvent[] = [],
): PublicSpeakerSummary {
  return {
    slug: row.slug,
    displayName: row.display_name || row.slug || "Speaker",
    photoUrl: row.photo ? getPbFileUrl(row, row.photo) : null,
    affiliation: row.affiliation || "",
    sessionCount: 0,
    appearanceEvents,
  };
}

function mapSpeakerDetail(
  row: SpeakerRow,
  sessions: PublicSessionCard[],
  appearanceEvents: PublicAppearanceEvent[] = [],
): PublicSpeakerDetail {
  const summary = mapSpeakerSummary(row, appearanceEvents);

  return {
    ...summary,
    sessionCount: sessions.length,
    bio: row.bio || "",
    socialHandles: normalizeSocialHandles(row.social_handles),
    sessions,
  };
}

function sortByDisplayName<T extends { displayName: string }>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }),
  );
}

function sortByTitle<T extends { title: string }>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  );
}

/** Fisher–Yates shuffle; new array, order random per call (server-side for teaser). */
function shuffleArray<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export const TEASER_SPEAKER_LIMIT = 9;

async function fetchPublishedSpeakersRows(): Promise<SpeakerRow[]> {
  const admin = getAdminPB();
  const rows = await admin.fetchAllRecords("speakers", {
    filter: "published = true",
  });
  return rows as SpeakerRow[];
}

async function fetchPublishedSessionsRows(): Promise<SessionRecord[]> {
  const admin = getAdminPB();
  const rows = await admin.fetchAllRecords("sessions", {
    filter: "published = true",
    expand: "speakers",
    sort: "title",
  });
  return rows as SessionRecord[];
}

async function fetchPublishedAppearanceEventsRows(): Promise<AppearanceEventRecord[]> {
  const rows = await getAdminPB().fetchAllRecords("appearance_events", {
    filter: "published = true",
    fields: "id,name,compact_label,published,display_order",
    sort: "display_order,name,id",
  });
  return (rows as AppearanceEventRecord[]).filter((row) => row.published);
}

function appearanceEventsForSpeaker(
  allEvents: AppearanceEventRecord[],
  speaker: SpeakerRow,
): PublicAppearanceEvent[] {
  const assigned = new Set(speaker.appearance_events || []);
  return allEvents
    .filter((event) => assigned.has(event.id))
    .sort(
      (a, b) =>
        Number(a.display_order) - Number(b.display_order) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    )
    .map((event) => ({
      name: event.name,
      compactLabel: event.compact_label || event.name,
    }));
}

function sessionsForSpeaker(
  allSessions: SessionRecord[],
  speakerId: string,
): PublicSessionCard[] {
  const cards: PublicSessionCard[] = [];
  for (const session of allSessions) {
    const speakerIds = session.speakers ?? [];
    if (!speakerIds.includes(speakerId)) continue;
    cards.push({
      slug: session.slug,
      title: session.title,
      format: session.format || undefined,
    });
  }
  return sortByTitle(cards);
}

export async function loadPublicSpeakers(limit?: number): Promise<PublicSpeakerSummary[]> {
  const [rows, sessions, appearanceEvents] = await Promise.all([
    fetchPublishedSpeakersRows(),
    fetchPublishedSessionsRows(),
    fetchPublishedAppearanceEventsRows(),
  ]);
  const mapped = sortByDisplayName(
    rows.map((row) => ({
      ...mapSpeakerSummary(row, appearanceEventsForSpeaker(appearanceEvents, row)),
      sessionCount: sessionsForSpeaker(sessions, row.id).length,
    })),
  );
  return limit ? mapped.slice(0, limit) : mapped;
}

export const fetchPublicSpeakers = async (limit?: number): Promise<PublicSpeakerSummary[]> => {
  "use server";
  return loadPublicSpeakers(limit);
};

export const loadPublicSpeakerTeaser = async (): Promise<{
  preview: PublicSpeakerSummary[];
  total: number;
}> => {
  const speakers = await loadPublicSpeakers();
  const preview = shuffleArray(speakers).slice(0, TEASER_SPEAKER_LIMIT);
  return { preview, total: speakers.length };
};

export const fetchPublicSpeakerTeaser = async (): Promise<{
  preview: PublicSpeakerSummary[];
  total: number;
}> => {
  "use server";
  return loadPublicSpeakerTeaser();
};

export const loadPublicSpeakerBySlug = async (
  slug: string,
): Promise<PublicSpeakerDetail | null> => {
  const escaped = slug.replace(/"/g, '\\"');
  const rows = (await getAdminPB().fetchAllRecords("speakers", {
    filter: `published = true && slug = "${escaped}"`,
  })) as SpeakerRow[];
  const row = rows[0];
  if (!row) return null;

  const [sessions, appearanceEvents] = await Promise.all([
    fetchPublishedSessionsRows(),
    fetchPublishedAppearanceEventsRows(),
  ]);
  const speakerSessions = sessionsForSpeaker(sessions, row.id);
  return mapSpeakerDetail(
    row,
    speakerSessions,
    appearanceEventsForSpeaker(appearanceEvents, row),
  );
};

export const fetchPublicSpeakerBySlug = async (
  slug: string,
): Promise<PublicSpeakerDetail | null> => {
  "use server";
  return loadPublicSpeakerBySlug(slug);
};

export const fetchPublicSpeakerPromoBySlug = async (
  slug: string,
): Promise<PublicSpeakerPromo | null> => {
  "use server";
  const escaped = slug.replace(/"/g, '\\"');
  const rows = (await getAdminPB().fetchAllRecords("speakers", {
    filter: `published = true && slug = "${escaped}"`,
  })) as SpeakerRow[];
  const row = rows[0];
  if (!row) return null;
  return mapSpeakerPromo(row);
};

export const fetchPublicSessions = async (): Promise<PublicSessionCard[]> => {
  "use server";
  const rows = await fetchPublishedSessionsRows();
  return sortByTitle(
    rows.map((s) => ({
      slug: s.slug,
      title: s.title,
      format: s.format || undefined,
    })),
  );
};

/** Returns the public agenda only from published Day and Slot records. */
export const fetchPublicAgenda = async (): Promise<PublicAgenda> => {
  "use server";
  const admin = getAdminPB();
  const [days, events, programmes, tracks, slots, sessions] = await Promise.all([
    admin.fetchAllRecords("conference_days", {
      filter: "published = true",
      fields: "id,key,local_date,title,display_order,published",
      sort: "display_order,local_date,id",
    }),
    admin.fetchAllRecords("appearance_events", {
      filter: "published = true",
      fields: "id,name,compact_label,destination_url,published,display_order",
      sort: "display_order,name,id",
    }),
    admin.fetchAllRecords("event_programmes", {
      fields: "id,day,appearance_event,display_order",
      sort: "day,display_order,id",
    }),
    admin.fetchAllRecords("agenda_tracks", {
      fields: "id,programme,key,name,location_label,display_order",
      sort: "programme,display_order,id",
    }),
    admin.fetchAllRecords("agenda_slots", {
      filter: "published = true",
      fields: "id,programme,track,start_at,end_at,kind,published,display_order,location_label,session,title,summary",
      sort: "programme,start_at,track,display_order,id",
    }),
    admin.fetchAllRecords("sessions", {
      filter: "published = true",
      fields: "id,slug,title,format,published",
      sort: "title,id",
    }),
  ]);
  return buildPublicAgenda(
    days as ConferenceDayRecord[],
    events as AppearanceEventRecord[],
    programmes as EventProgrammeRecord[],
    tracks as AgendaTrackRecord[],
    slots as AgendaSlotRecord[],
    sessions as SessionRecord[],
  );
};

function scheduleFromPublicAgenda(
  agenda: PublicAgenda,
  sessionSlug: string,
): PublicSessionSchedule | undefined {
  for (const day of agenda.days) {
    for (const programme of day.programmes) {
      const slot = programme.slots.find((item) => item.session?.slug === sessionSlug);
      if (!slot) continue;
      return {
        dayDate: day.localDate,
        dayTitle: day.title,
        event: programme.event,
        startAt: slot.startAt,
        endAt: slot.endAt,
        trackName: slot.track?.name,
        locationLabel: slot.locationLabel,
      };
    }
  }
  return undefined;
}

/** Loads one allowlisted Published programme snapshot for Conference Guide composition. */
export const fetchPublicConferenceGuideProgramme = async (): Promise<PublicConferenceGuideProgramme> => {
  "use server";
  const [speakerRows, rawSessionRows, agenda] = await Promise.all([
    fetchPublishedSpeakersRows(),
    fetchPublishedSessionsRows(),
    fetchPublicAgenda(),
  ]);
  const sessionRows = rawSessionRows as Array<SessionRecord & {
    expand?: { speakers?: SpeakerRow[] };
  }>;

  const sessions = sortByTitle(sessionRows.map((session) => ({
    slug: session.slug,
    title: session.title,
    abstract: session.abstract,
    format: session.format || undefined,
    schedule: scheduleFromPublicAgenda(agenda, session.slug),
    speakers: sortByDisplayName(
      (session.expand?.speakers ?? [])
        .filter((speaker) => speaker.published)
        .map((speaker) => mapSpeakerSummary(speaker)),
    ),
    relatedSessions: [],
  })));
  const speakers = sortByDisplayName(
    speakerRows.map((speaker) => mapSpeakerDetail(
      speaker,
      sessionsForSpeaker(rawSessionRows, speaker.id),
    )),
  );

  return { agenda, sessions, speakers };
};

export const fetchHasPublishedSessions = async (): Promise<boolean> => {
  "use server";
  const admin = getAdminPB();
  const rows = await admin.fetchAllRecords("sessions", {
    filter: "published = true",
    fields: "id",
  });
  return rows.length > 0;
};

export const fetchPublicSessionBySlug = async (
  slug: string,
): Promise<PublicSessionDetail | null> => {
  "use server";
  const admin = getAdminPB();
  const escaped = slug.replace(/"/g, '\\"');
  const rows = (await admin.fetchAllRecords("sessions", {
    filter: `published = true && slug = "${escaped}"`,
    expand: "speakers",
  })) as (SessionRecord & { expand?: { speakers?: SpeakerRow[] } })[];

  const session = rows[0];
  if (!session) return null;

  const speakerRows = (session.expand?.speakers ?? []).filter((speaker) => speaker.published);
  const speakers = sortByDisplayName(
    speakerRows.map((speaker) => mapSpeakerSummary(speaker)),
  );

  const [slots, programmes, events, days, tracks] = await Promise.all([
    admin.fetchAllRecords("agenda_slots", {
      filter: `session = "${session.id.replace(/"/g, '\\"')}" && published = true`,
    }),
    admin.fetchAllRecords("event_programmes"),
    admin.fetchAllRecords("appearance_events"),
    admin.fetchAllRecords("conference_days"),
    admin.fetchAllRecords("agenda_tracks"),
  ]);
  const scheduleSlot = (slots as AgendaSlotRecord[])[0];
  const schedule = scheduleSlot
    ? derivePublicSessionSchedule(
        scheduleSlot,
        new Map((programmes as EventProgrammeRecord[]).map((programme) => [programme.id, programme])),
        new Map((events as AppearanceEventRecord[]).map((event) => [event.id, event])),
        new Map((days as ConferenceDayRecord[]).map((day) => [day.id, day])),
        new Map((tracks as AgendaTrackRecord[]).map((track) => [track.id, track])),
      )
    : undefined;

  return {
    slug: session.slug,
    title: session.title,
    abstract: session.abstract,
    format: session.format || undefined,
    schedule,
    speakers,
    relatedSessions: [],
  };
};
