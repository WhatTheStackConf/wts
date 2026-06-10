import { getAdminPB } from "~/lib/pocketbase-admin-service";
import { getPbFileUrl } from "~/lib/pocketbase-public-url";
import type { PartnerRecord } from "~/lib/pocketbase-types";

export type PublicPartnerType = PartnerRecord["type"];
export type PublicPartnerTier = NonNullable<PartnerRecord["tier"]>;
export type PublicPartnerGroupKind = "organizer" | "sponsor" | "partner";

export interface PublicPartner {
  name: string;
  logoUrl: string;
  url?: string;
  type: PublicPartnerType;
  tier?: PublicPartnerTier;
}

interface PublicPartnerGroupConfig {
  id: string;
  title: string;
  description: string;
  kind: PublicPartnerGroupKind;
  type: PublicPartnerType;
  tier?: PublicPartnerTier;
}

export interface PublicPartnerGroup extends PublicPartnerGroupConfig {
  partners: PublicPartner[];
}

const PARTNER_GROUPS: PublicPartnerGroupConfig[] = [
  {
    id: "organizers",
    title: "Organizers",
    description: "The community crews building the conference from the ground up.",
    kind: "organizer",
    type: "organizer",
  },
  {
    id: "platinum-sponsors",
    title: "Platinum Sponsors",
    description: "Main-stage partners backing the full WTS experience.",
    kind: "sponsor",
    type: "sponsor",
    tier: "platinum",
  },
  {
    id: "gold-sponsors",
    title: "Gold Sponsors",
    description: "Companies helping us keep the conference ambitious and accessible.",
    kind: "sponsor",
    type: "sponsor",
    tier: "gold",
  },
  {
    id: "silver-sponsors",
    title: "Silver Sponsors",
    description: "Teams supporting the stages, hallway track, and event-day flow.",
    kind: "sponsor",
    type: "sponsor",
    tier: "silver",
  },
  {
    id: "bronze-sponsors",
    title: "Bronze Sponsors",
    description: "Partner companies contributing to the regional developer scene.",
    kind: "sponsor",
    type: "sponsor",
    tier: "bronze",
  },
  {
    id: "sponsors",
    title: "Sponsors",
    description: "Additional sponsors supporting WTS 2026.",
    kind: "sponsor",
    type: "sponsor",
  },
  {
    id: "media-partners",
    title: "Media Partners",
    description: "People and platforms helping the signal travel beyond the venue.",
    kind: "partner",
    type: "media",
  },
  {
    id: "supporters",
    title: "Supporters",
    description: "Companies and organizations lending practical help to WTS.",
    kind: "partner",
    type: "company_supporter",
  },
  {
    id: "community-partners",
    title: "Community Partners",
    description: "Meetups, user groups, and student communities expanding the WTS orbit.",
    kind: "partner",
    type: "supporter",
  },
  {
    id: "bytes-and-beverages",
    title: "Bytes and Beverages",
    description: "Food, coffee, and hospitality partners keeping people charged.",
    kind: "partner",
    type: "catering",
  },
  {
    id: "other-partners",
    title: "Other Partners",
    description: "Special collaborators helping with the parts that do not fit a neat tier.",
    kind: "partner",
    type: "other",
  },
];

function mapPartner(row: PartnerRecord): PublicPartner {
  return {
    name: row.name,
    logoUrl: getPbFileUrl(row, row.logo),
    url: row.url || undefined,
    type: row.type,
    tier: row.tier || undefined,
  };
}

function sortByCreated(rows: PartnerRecord[]): PartnerRecord[] {
  return [...rows].sort((a, b) => a.created.localeCompare(b.created));
}

function partnerMatchesGroup(
  partner: PublicPartner,
  group: PublicPartnerGroupConfig,
): boolean {
  if (partner.type !== group.type) return false;
  if (group.tier && partner.tier !== group.tier) return false;
  if (!group.tier && group.type === "sponsor") return !partner.tier;
  return true;
}

export const fetchPublicPartnerGroups = async (): Promise<PublicPartnerGroup[]> => {
  "use server";
  const rows = (await getAdminPB().fetchAllRecords("partners", {
    filter: `published = true`,
  })) as PartnerRecord[];

  const partners = sortByCreated(rows).map(mapPartner);
  return PARTNER_GROUPS.map((group) => ({
    ...group,
    partners: partners.filter((partner) => partnerMatchesGroup(partner, group)),
  }));
};
