/* T-minus: whole days to the conference, counted in the conference time zone.
 * The idea comes from Counter in Solid Bits (solid-bits.dev). This is a smaller WTS version. */

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Days from today to localDate (YYYY-MM-DD), both in timeZone. Null on the day itself, after it, or for a bad date. */
export function daysUntil(now: Date, localDate: string, timeZone: string): number | null {
  if (!ISO_DATE.test(localDate)) return null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const days = Math.round((Date.parse(`${localDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
  return Number.isFinite(days) && days > 0 ? days : null;
}
