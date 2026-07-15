export const FALLBACK_CFP_DEADLINE = "2026-07-30T23:59:59.999Z";

export function cfpDeadlineTimestamp(value: string | null | undefined): number {
  const deadline = value || FALLBACK_CFP_DEADLINE;
  const midnight = /^(\d{4}-\d{2}-\d{2})(?:[T ]00:00:00(?:\.0+)?Z)?$/.exec(deadline);
  return Date.parse(midnight ? `${midnight[1]}T23:59:59.999Z` : deadline);
}
