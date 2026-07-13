const MAX_TOKEN_LIFETIME_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export type McpTokenExpiryResult =
  | { success: true; expiresAt: string }
  | { success: false; reason: "invalid" | "past" | "too_long" };

function maximumExpiryTimestamp(now: number) {
  return now + MAX_TOKEN_LIFETIME_DAYS * DAY_MS;
}

export function maximumNewMcpTokenExpiryDate(now = Date.now()) {
  return new Date(maximumExpiryTimestamp(now)).toISOString().slice(0, 10);
}

export function normalizeNewMcpTokenExpiry(
  value?: string | null,
  now = Date.now(),
): McpTokenExpiryResult {
  const maximum = maximumExpiryTimestamp(now);
  if (!value) {
    return { success: true, expiresAt: new Date(maximum).toISOString() };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { success: false, reason: "invalid" };
  }
  const endOfDay = Date.parse(`${value}T23:59:59.999Z`);
  if (
    !Number.isFinite(endOfDay) ||
    new Date(endOfDay).toISOString().slice(0, 10) !== value
  ) {
    return { success: false, reason: "invalid" };
  }
  if (endOfDay <= now) return { success: false, reason: "past" };

  const maximumDate = maximumNewMcpTokenExpiryDate(now);
  if (value > maximumDate) return { success: false, reason: "too_long" };

  return {
    success: true,
    expiresAt: new Date(Math.min(endOfDay, maximum)).toISOString(),
  };
}
