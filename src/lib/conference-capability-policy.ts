export type ConferenceCapability = "cfp" | "review";
export function capabilityForPath(pathname: string): ConferenceCapability | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/cfp" || path.startsWith("/cfp/")) return "cfp";
  if (path === "/reviewer" || path.startsWith("/reviewer/") || path === "/admin/weights") {
    return "review";
  }
  return null;
}

export type CapabilityAvailability = {
  cfp: boolean;
  review: boolean;
};

export type AvailabilityRecord = {
  availability?: unknown;
  cfp_open?: unknown;
  cfp_deadline?: unknown;
};

export function parseCapabilityAvailability(value: unknown): CapabilityAvailability | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const availability = value as Record<string, unknown>;
  if (typeof availability.cfp !== "boolean" || typeof availability.review !== "boolean") {
    return null;
  }
  return { cfp: availability.cfp, review: availability.review };
}

export function isCapabilityAvailable(
  records: readonly AvailabilityRecord[],
  capability: ConferenceCapability,
): boolean {
  if (records.length !== 1 || typeof records[0]?.cfp_open !== "boolean") return false;
  const availability = parseCapabilityAvailability(records[0].availability);
  return availability?.[capability] === true &&
    (capability !== "cfp" || records[0].cfp_open === true);
}
