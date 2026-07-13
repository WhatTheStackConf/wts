import type { PartnerRecord } from "~/lib/pocketbase-types";

const PARTNER_LOGO_MAX_BYTES = 5 * 1024 * 1024;
const PARTNER_LOGO_TYPES = [
  "image/svg+xml",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
];
const PARTNER_TYPES = [
  "organizer",
  "sponsor",
  "supporter",
  "community_partner",
  "media",
  "catering",
  "other",
] as const satisfies readonly PartnerRecord["type"][];
const PARTNER_TIERS = ["platinum", "gold", "silver", "bronze"] as const;

/** Serializable file payload for Partner logos (Seroval-safe). */
export type PartnerLogoPayload = {
  name: string;
  type: string;
  data: number[];
};

export type PartnerInput = {
  name: string;
  type: PartnerRecord["type"];
  tier?: PartnerRecord["tier"] | "";
  url?: string;
  notes?: string;
  published?: boolean;
  logo?: PartnerLogoPayload | null;
};

function validatePartnerInput(input: PartnerInput, requireLogo: boolean): string | null {
  const name = input.name?.trim();
  if (!name) return "Partner name is required.";
  if (!PARTNER_TYPES.includes(input.type)) return "Choose a valid Partner type.";
  if (input.tier && !PARTNER_TIERS.includes(input.tier)) {
    return "Choose a valid Sponsor tier.";
  }
  if (input.type === "sponsor" && !input.tier) return "Choose a Sponsor tier.";
  if (requireLogo && !input.logo?.data?.length) return "Logo is required.";
  if (input.logo?.data?.length) {
    if (input.logo.data.length > PARTNER_LOGO_MAX_BYTES) {
      return "Logo must be 5 MB or smaller.";
    }
    if (input.logo.type && !PARTNER_LOGO_TYPES.includes(input.logo.type)) {
      return "Logo must be SVG, PNG, JPEG, WebP, or AVIF.";
    }
  }
  return null;
}

function buildPartnerBody(
  fields: Record<string, string | boolean>,
  logo?: PartnerLogoPayload | null,
): Record<string, unknown> | FormData {
  if (!logo?.data?.length) return fields;

  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    body.append(key, String(value));
  }
  const blob = new Blob([new Uint8Array(logo.data)], {
    type: logo.type || "application/octet-stream",
  });
  body.append("logo", blob, logo.name || "logo");
  return body;
}

export function normalizePartnerInput(input: PartnerInput, requireLogo: boolean) {
  const error = validatePartnerInput(input, requireLogo);
  if (error) return { success: false as const, error };

  const fields = {
    name: input.name.trim(),
    published: input.published ?? false,
    type: input.type,
    tier: input.type === "sponsor" ? input.tier || "" : "",
    url: input.url?.trim() || "",
    notes: input.notes?.trim() || "",
  };

  return {
    success: true as const,
    fields,
    body: buildPartnerBody(fields, input.logo),
  };
}

export function partnerUrlNeedsRemediation(value?: string): boolean {
  const url = value?.trim();
  if (!url) return false;
  try {
    return new URL(url).protocol !== "https:";
  } catch {
    return true;
  }
}

export function partnerSnapshot(record: PartnerRecord) {
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    tier: record.tier,
    published: record.published,
    logo: record.logo,
    url: record.url,
  };
}
