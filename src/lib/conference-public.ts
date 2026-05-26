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
