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
  kind: PublicPartnerGroupKind;
  type: PublicPartnerType;
  tier?: PublicPartnerTier;
}

export interface PublicPartnerGroup extends PublicPartnerGroupConfig {
  partners: PublicPartner[];
}

const PARTNER_GROUPS: PublicPartnerGroupConfig[] = [
  { id: "organizers", title: "Organizers", kind: "organizer", type: "organizer" },
  { id: "platinum-sponsors", title: "Platinum Sponsors", kind: "sponsor", type: "sponsor", tier: "platinum" },
  { id: "gold-sponsors", title: "Gold Sponsors", kind: "sponsor", type: "sponsor", tier: "gold" },
  { id: "silver-sponsors", title: "Silver Sponsors", kind: "sponsor", type: "sponsor", tier: "silver" },
  { id: "bronze-sponsors", title: "Bronze Sponsors", kind: "sponsor", type: "sponsor", tier: "bronze" },
  { id: "media-partners", title: "Media Partners", kind: "partner", type: "media" },
  { id: "supporters", title: "Supporters", kind: "partner", type: "supporter" },
  { id: "community-partners", title: "Community Partners", kind: "partner", type: "community_partner" },
  { id: "bytes-and-beverages", title: "Bytes and Beverages", kind: "partner", type: "catering" },
  { id: "other-partners", title: "Other Partners", kind: "partner", type: "other" },
];

function mapPartner(row: PartnerRecord): PublicPartner {
  return {
    name: row.name,
    logoUrl: getPbFileUrl(row, row.logo || ""),
    url: row.url || undefined,
    type: row.type,
    tier: row.tier || undefined,
  };
}

export function sortPartnerRecords(rows: PartnerRecord[]): PartnerRecord[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function partnerMatchesGroup(partner: PublicPartner, group: PublicPartnerGroupConfig): boolean {
  if (partner.type !== group.type) return false;
  if (group.tier && partner.tier !== group.tier) return false;
  return true;
}

export function buildPublicPartnerGroups(rows: PartnerRecord[]): PublicPartnerGroup[] {
  const partners = sortPartnerRecords(rows.filter((row) => row.published)).map(mapPartner);
  return PARTNER_GROUPS.map((group) => ({
    ...group,
    partners: partners.filter((partner) => partnerMatchesGroup(partner, group)),
  }));
}
