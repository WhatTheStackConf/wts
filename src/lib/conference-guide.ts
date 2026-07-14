import { createHash } from "node:crypto";
import DOMPurify from "isomorphic-dompurify";
import type { ConferenceGuide } from ".velite";
import {
  conferenceGuideContent,
  conferenceTimeZone,
} from "~/lib/conference-guide-content";
import type {
  PublicAgenda,
  PublicAgendaSlot,
  PublicSessionDetail,
  PublicSpeakerDetail,
} from "~/lib/conference-public";
import type { PublicPartnerGroup } from "~/lib/partners-public";

export const CONFERENCE_GUIDE_URIS = {
  index: "wts://conference-guide/index",
  agenda: "wts://conference-guide/agenda",
  sessionTemplate: "wts://conference-guide/sessions/{slug}",
  speakerTemplate: "wts://conference-guide/speakers/{slug}",
  partners: "wts://conference-guide/partners",
} as const;

const DEFAULT_CANONICAL_ORIGIN = "https://wts.sh";
const DEFAULT_PROGRAMME_TTL_MS = 60_000;

export interface ConferenceGuidePublishedData {
  agenda: PublicAgenda;
  sessions: PublicSessionDetail[];
  speakers: PublicSpeakerDetail[];
  partnerGroups: PublicPartnerGroup[];
}

interface ConferenceGuideDependencies {
  content?: ConferenceGuide;
  loadPublishedData: () => Promise<ConferenceGuidePublishedData>;
  canonicalOrigin?: string;
  now?: () => Date;
  programmeTtlMs?: number;
}

export interface GuideMetadata {
  schema_version: "1";
  content_version: string;
  programme_version: string;
  generated_at: string;
  time_zone: "Europe/Skopje";
  canonical_url: string;
}

export class ProgrammeUnavailableError extends Error {
  readonly code = "programme_unavailable";

  constructor() {
    super("The Published conference programme is temporarily unavailable.");
    this.name = "ProgrammeUnavailableError";
  }
}

function normalizeGuideText(value: string | null | undefined): string {
  const withBreaks = (value ?? "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/?(?:p|div|li|ul|ol|h[1-6]|blockquote)[^>]*>/gi, (tag) =>
      tag.startsWith("</") || /^<li/i.test(tag) ? "\n" : "",
    );
  const document = DOMPurify.sanitize(withBreaks, {
    ALLOWED_TAGS: [],
    RETURN_DOM: true,
  });
  return (document.textContent ?? "")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function optionalGuideText(value: string | null | undefined): string | undefined {
  return normalizeGuideText(value) || undefined;
}

function canonicalOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
  } catch {
    // Fall through to the production origin rather than emitting malformed links.
  }
  return DEFAULT_CANONICAL_ORIGIN;
}

function canonicalExternalUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function localTime(instant: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: conferenceTimeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
}

function slugUri(kind: "sessions" | "speakers", slug: string): string {
  return `wts://conference-guide/${kind}/${encodeURIComponent(slug)}`;
}

function publicProfileUrl(
  origin: string,
  kind: "sessions" | "speakers",
  slug: string,
): string {
  return `${origin}/${kind}/${encodeURIComponent(slug)}`;
}

function mapAgendaSlot(
  slot: PublicAgendaSlot,
  dayKey: string,
  origin: string,
) {
  return {
    kind: slot.kind,
    day_key: dayKey,
    start_time: localTime(slot.startAt),
    end_time: localTime(slot.endAt),
    location: optionalGuideText(slot.locationLabel),
    track: slot.track
      ? {
          key: normalizeGuideText(slot.track.key),
          name: normalizeGuideText(slot.track.name),
        }
      : undefined,
    session: slot.session
      ? {
          slug: slot.session.slug,
          title: normalizeGuideText(slot.session.title),
          format: optionalGuideText(slot.session.format),
          resource_uri: slugUri("sessions", slot.session.slug),
          canonical_url: publicProfileUrl(origin, "sessions", slot.session.slug),
        }
      : undefined,
    title: optionalGuideText(slot.title),
    summary: optionalGuideText(slot.summary),
  };
}

function sessionSchedule(agenda: PublicAgenda, slug: string, origin: string) {
  for (const day of agenda.days) {
    const slot = day.slots.find((item) => item.session?.slug === slug);
    if (!slot) continue;
    return {
      status: "scheduled" as const,
      day_key: day.key,
      local_date: day.localDate,
      day_title: normalizeGuideText(day.title),
      start_time: localTime(slot.startAt),
      end_time: localTime(slot.endAt),
      location: optionalGuideText(slot.locationLabel),
      track: slot.track
        ? { key: normalizeGuideText(slot.track.key), name: normalizeGuideText(slot.track.name) }
        : undefined,
      agenda_url: `${origin}/agenda`,
    };
  }
  return { status: "not_scheduled" as const };
}

function mapSession(session: PublicSessionDetail, agenda: PublicAgenda, origin: string) {
  return {
    slug: session.slug,
    title: normalizeGuideText(session.title),
    abstract: normalizeGuideText(session.abstract),
    format: optionalGuideText(session.format),
    canonical_url: publicProfileUrl(origin, "sessions", session.slug),
    schedule: sessionSchedule(agenda, session.slug, origin),
    speakers: [...session.speakers]
      .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }))
      .map((speaker) => ({
        slug: speaker.slug,
        display_name: normalizeGuideText(speaker.displayName),
        affiliation: optionalGuideText(speaker.affiliation),
        resource_uri: slugUri("speakers", speaker.slug),
        canonical_url: publicProfileUrl(origin, "speakers", speaker.slug),
      })),
  };
}

function mapSpeaker(speaker: PublicSpeakerDetail, origin: string) {
  return {
    slug: speaker.slug,
    display_name: normalizeGuideText(speaker.displayName),
    affiliation: optionalGuideText(speaker.affiliation),
    bio: normalizeGuideText(speaker.bio),
    canonical_url: publicProfileUrl(origin, "speakers", speaker.slug),
    sessions: [...speaker.sessions]
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }))
      .map((session) => ({
        slug: session.slug,
        title: normalizeGuideText(session.title),
        format: optionalGuideText(session.format),
        resource_uri: slugUri("sessions", session.slug),
        canonical_url: publicProfileUrl(origin, "sessions", session.slug),
      })),
  };
}

function mapPartnerGroups(groups: PublicPartnerGroup[]) {
  return groups.map((group) => ({
    key: group.id,
    title: normalizeGuideText(group.title),
    kind: group.kind,
    type: group.type,
    tier: group.tier,
    partners: group.partners.map((partner) => ({
      name: normalizeGuideText(partner.name),
      type: partner.type,
      tier: partner.tier,
      website_url: canonicalExternalUrl(partner.url),
    })),
  }));
}

function mapLogistics(content: ConferenceGuide, origin: string) {
  return {
    event: {
      name: normalizeGuideText(content.event.name),
      date: {
        status: content.event.date.status,
        local_date: content.event.date.localDate,
      },
      location: {
        status: content.event.location.status,
        city: normalizeGuideText(content.event.location.city),
        country: normalizeGuideText(content.event.location.country),
      },
      time_zone: {
        status: content.event.timeZone.status,
        iana: content.event.timeZone.iana,
      },
    },
    main_venue: { status: content.mainVenue.status },
    pre_conference_venue: {
      status: content.preConferenceVenue.status,
      name: normalizeGuideText(content.preConferenceVenue.name),
      address: normalizeGuideText(content.preConferenceVenue.address),
    },
    tickets: {
      status: content.tickets.status,
      canonical_url: `${origin}${content.tickets.canonicalPath}`,
      regular: content.tickets.regular,
      student: {
        amount: content.tickets.student.amount,
        currency: content.tickets.student.currency,
        verification_email: content.tickets.student.verificationEmail,
      },
      includes: content.tickets.includes.map(normalizeGuideText),
      workshops: content.tickets.workshops,
    },
    code_of_conduct: {
      status: content.codeOfConduct.status,
      canonical_url: `${origin}${content.codeOfConduct.canonicalPath}`,
      reporting_email: content.codeOfConduct.reportingEmail,
    },
    accessibility: {
      status: content.accessibility.status,
      contact_email: content.accessibility.contactEmail,
    },
    accommodation: { status: content.accommodation.status },
    contact: { general_email: content.contact.generalEmail },
  };
}

function mapProgramme(data: ConferenceGuidePublishedData, origin: string) {
  const sessions = [...data.sessions]
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((session) => mapSession(session, data.agenda, origin));
  const speakers = [...data.speakers]
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((speaker) => mapSpeaker(speaker, origin));
  return {
    agenda: {
      days: data.agenda.days.map((day) => ({
        key: day.key,
        local_date: day.localDate,
        title: normalizeGuideText(day.title),
        slots: day.slots.map((slot) => mapAgendaSlot(slot, day.key, origin)),
      })),
    },
    sessions,
    speakers,
    partnerGroups: mapPartnerGroups(data.partnerGroups),
  };
}

type GuideProgramme = ReturnType<typeof mapProgramme>;

interface CachedProgramme {
  programme: GuideProgramme;
  version: string;
  generatedAt: string;
  expiresAt: number;
}

export function createConferenceGuide(dependencies: ConferenceGuideDependencies) {
  const content = dependencies.content ?? conferenceGuideContent;
  const loadPublishedData = dependencies.loadPublishedData;
  const origin = canonicalOrigin(dependencies.canonicalOrigin ?? DEFAULT_CANONICAL_ORIGIN);
  const now = dependencies.now ?? (() => new Date());
  const programmeTtlMs = dependencies.programmeTtlMs ?? DEFAULT_PROGRAMME_TTL_MS;
  let cached: CachedProgramme | undefined;
  let inFlight: Promise<CachedProgramme> | undefined;

  const metadata = (
    canonicalPath: string,
    programmeVersion: string,
    generatedAt: string,
  ): GuideMetadata => ({
    schema_version: "1",
    content_version: content.contentVersion,
    programme_version: programmeVersion,
    generated_at: generatedAt,
    time_zone: content.event.timeZone.iana,
    canonical_url: `${origin}${canonicalPath}`,
  });

  const loadProgramme = async (): Promise<CachedProgramme> => {
    const currentTime = now().getTime();
    if (cached && currentTime < cached.expiresAt) return cached;
    if (inFlight) return inFlight;

    inFlight = (async () => {
      try {
        const programme = mapProgramme(await loadPublishedData(), origin);
        const generatedAt = now().toISOString();
        const version = `sha256:${createHash("sha256").update(JSON.stringify(programme)).digest("hex")}`;
        cached = {
          programme,
          version,
          generatedAt,
          expiresAt: now().getTime() + programmeTtlMs,
        };
        return cached;
      } catch {
        throw new ProgrammeUnavailableError();
      } finally {
        inFlight = undefined;
      }
    })();
    return inFlight;
  };

  return {
    async getIndex() {
      const logistics = mapLogistics(content, origin);
      try {
        const snapshot = await loadProgramme();
        return {
          metadata: metadata("/mcp", snapshot.version, snapshot.generatedAt),
          programme_status: "available" as const,
          logistics,
          programme: {
            agenda: {
              resource_uri: CONFERENCE_GUIDE_URIS.agenda,
              canonical_url: `${origin}/agenda`,
              day_keys: snapshot.programme.agenda.days.map((day) => day.key),
            },
            sessions: snapshot.programme.sessions.map((session) => ({
              slug: session.slug,
              title: session.title,
              resource_uri: slugUri("sessions", session.slug),
              canonical_url: session.canonical_url,
            })),
            speakers: snapshot.programme.speakers.map((speaker) => ({
              slug: speaker.slug,
              display_name: speaker.display_name,
              resource_uri: slugUri("speakers", speaker.slug),
              canonical_url: speaker.canonical_url,
            })),
            partners: {
              resource_uri: CONFERENCE_GUIDE_URIS.partners,
              canonical_url: `${origin}/sponsors`,
            },
          },
        };
      } catch {
        const generatedAt = now().toISOString();
        return {
          metadata: metadata("/mcp", "programme_unavailable", generatedAt),
          programme_status: "programme_unavailable" as const,
          logistics,
        };
      }
    },

    async getAgenda() {
      const snapshot = await loadProgramme();
      return {
        metadata: metadata("/agenda", snapshot.version, snapshot.generatedAt),
        ...snapshot.programme.agenda,
      };
    },

    async getSession(slug: string) {
      const snapshot = await loadProgramme();
      const session = snapshot.programme.sessions.find((item) => item.slug === slug);
      return session
        ? { metadata: metadata(`/sessions/${encodeURIComponent(slug)}`, snapshot.version, snapshot.generatedAt), ...session }
        : null;
    },

    async getSpeaker(slug: string) {
      const snapshot = await loadProgramme();
      const speaker = snapshot.programme.speakers.find((item) => item.slug === slug);
      return speaker
        ? { metadata: metadata(`/speakers/${encodeURIComponent(slug)}`, snapshot.version, snapshot.generatedAt), ...speaker }
        : null;
    },

    async getPartners() {
      const snapshot = await loadProgramme();
      return {
        metadata: metadata("/sponsors", snapshot.version, snapshot.generatedAt),
        groups: snapshot.programme.partnerGroups,
      };
    },
  };
}

export type ConferenceGuideService = ReturnType<typeof createConferenceGuide>;
