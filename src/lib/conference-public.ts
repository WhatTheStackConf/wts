import { getAdminPB } from "~/lib/pocketbase-admin-service";
import { getGravatarUrl } from "~/lib/gravatar";
import { getPbFileUrl } from "~/lib/pocketbase-public-url";
import type { SpeakerRecord, SessionRecord } from "~/lib/pocketbase-types";

export { getPbFileUrl } from "~/lib/pocketbase-public-url";

export interface PublicSpeakerSummary {
  slug: string;
  displayName: string;
  photoUrl: string;
  affiliation: string;
  sessionCount: number;
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
  photoUrl: string;
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
const DEFAULT_PROMO_FOOTER_SUFFIX = " — September 19, Skopje";
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
  startsAt?: string;
  track?: string;
  room?: string;
  speakers: PublicSpeakerSummary[];
  /** Populated when related-sessions feature ships; empty at launch. */
  relatedSessions: PublicSessionCard[];
}

export function normalizeSocialHandles(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter((h): h is string => typeof h === "string" && h.length > 0);
  }
  if (typeof raw === "string" && raw.length > 0) return [raw];
  return [];
}

type SpeakerRow = SpeakerRecord & {
  expand?: {
    cfp_applicant?: {
      affiliation?: string;
      bio?: string;
      social_handles?: unknown;
      expand?: { user?: { id: string; name?: string; email?: string; avatar?: string } };
      user?: string;
    };
    user?: { id: string; name?: string; email?: string; avatar?: string };
  };
};

function resolveUser(row: SpeakerRow) {
  return row.expand?.user ?? row.expand?.cfp_applicant?.expand?.user;
}

function mapSpeakerSummary(row: SpeakerRow): PublicSpeakerSummary {
  const user = resolveUser(row);
  const applicant = row.expand?.cfp_applicant;

  if (row.origin === "cfp" && applicant) {
    const displayName = row.display_name || user?.name || "Speaker";
    const photoUrl = user?.avatar
      ? getPbFileUrl("users", user.id, user.avatar)
      : getGravatarUrl(user?.email);
    return {
      slug: row.slug,
      displayName,
      photoUrl,
      affiliation: applicant.affiliation || "",
      sessionCount: 0,
    };
  }

  const displayName = row.display_name || "Speaker";
  const photoUrl = row.photo
    ? getPbFileUrl(row, row.photo)
    : user?.avatar
      ? getPbFileUrl("users", user.id, user.avatar)
      : getGravatarUrl(user?.email);

  return {
    slug: row.slug,
    displayName,
    photoUrl,
    affiliation: row.affiliation || "",
    sessionCount: 0,
  };
}

function mapSpeakerDetail(
  row: SpeakerRow,
  sessions: PublicSessionCard[],
): PublicSpeakerDetail {
  const summary = mapSpeakerSummary(row);
  const user = resolveUser(row);
  const applicant = row.expand?.cfp_applicant;

  if (row.origin === "cfp" && applicant) {
    return {
      ...summary,
      sessionCount: sessions.length,
      bio: applicant.bio || "",
      socialHandles: normalizeSocialHandles(applicant.social_handles),
      sessions,
    };
  }

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
    expand: "cfp_applicant.user,user",
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

export const fetchPublicSpeakers = async (limit?: number): Promise<PublicSpeakerSummary[]> => {
  "use server";
  const [rows, sessions] = await Promise.all([
    fetchPublishedSpeakersRows(),
    fetchPublishedSessionsRows(),
  ]);
  const mapped = sortByDisplayName(
    rows.map((row) => ({
      ...mapSpeakerSummary(row),
      sessionCount: sessionsForSpeaker(sessions, row.id).length,
    })),
  );
  return limit ? mapped.slice(0, limit) : mapped;
};

export const fetchPublicSpeakerTeaser = async (): Promise<{
  preview: PublicSpeakerSummary[];
  total: number;
}> => {
  "use server";
  const [rows, sessions] = await Promise.all([
    fetchPublishedSpeakersRows(),
    fetchPublishedSessionsRows(),
  ]);
  const mapped = rows.map((row) => ({
    ...mapSpeakerSummary(row),
    sessionCount: sessionsForSpeaker(sessions, row.id).length,
  }));
  const preview = shuffleArray(mapped).slice(0, TEASER_SPEAKER_LIMIT);
  return { preview, total: mapped.length };
};

export const fetchPublicSpeakerBySlug = async (
  slug: string,
): Promise<PublicSpeakerDetail | null> => {
  "use server";
  const escaped = slug.replace(/"/g, '\\"');
  const rows = (await getAdminPB().fetchAllRecords("speakers", {
    filter: `published = true && slug = "${escaped}"`,
    expand: "cfp_applicant.user,user",
  })) as SpeakerRow[];
  const row = rows[0];
  if (!row) return null;

  const sessions = await fetchPublishedSessionsRows();
  const speakerSessions = sessionsForSpeaker(sessions, row.id);
  return mapSpeakerDetail(row, speakerSessions);
};

export const fetchPublicSpeakerPromoBySlug = async (
  slug: string,
): Promise<PublicSpeakerPromo | null> => {
  "use server";
  const escaped = slug.replace(/"/g, '\\"');
  const rows = (await getAdminPB().fetchAllRecords("speakers", {
    filter: `published = true && slug = "${escaped}"`,
    expand: "cfp_applicant.user,user",
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
    expand: "speakers.cfp_applicant.user,speakers.user",
  })) as (SessionRecord & { expand?: { speakers?: SpeakerRow[] } })[];

  const session = rows[0];
  if (!session) return null;

  const speakerRows = session.expand?.speakers ?? [];
  const speakers = sortByDisplayName(speakerRows.map(mapSpeakerSummary));

  return {
    slug: session.slug,
    title: session.title,
    abstract: session.abstract,
    format: session.format || undefined,
    startsAt: session.starts_at || undefined,
    track: session.track || undefined,
    room: session.room || undefined,
    speakers,
    relatedSessions: [],
  };
};
