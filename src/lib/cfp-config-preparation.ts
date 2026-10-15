export type ClosedCfpConfig = {
  cfp_open: false;
  cfp_deadline: string | null;
};

const CLOSED_CFP_CONFIG_KEYS = new Set(["cfp_open", "cfp_deadline"]);

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const midnight = `${value}T00:00:00.000Z`;
  return Number.isFinite(Date.parse(midnight)) &&
    new Date(midnight).toISOString().slice(0, 10) === value;
}

function isClosedCfpConfig(data: Record<string, unknown>): boolean {
  return Object.keys(data).every((key) => CLOSED_CFP_CONFIG_KEYS.has(key)) &&
    data.cfp_open === false &&
    (data.cfp_deadline === null || isCalendarDate(data.cfp_deadline));
}

export function parseClosedCfpConfig(value: unknown): ClosedCfpConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Only valid closed CFP configuration can be prepared.");
  }
  const data = value as Record<string, unknown>;
  if (!isClosedCfpConfig(data)) {
    throw new Error("Only valid closed CFP configuration can be prepared.");
  }
  return { cfp_open: false, cfp_deadline: data.cfp_deadline as string | null };
}
