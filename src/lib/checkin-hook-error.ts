import type { CheckinErrorCode } from "~/lib/checkin-contract";
import { CheckinError, pocketBaseFailure } from "~/lib/checkin-service";

export const CHECKIN_STATION_ERROR_CODES: readonly CheckinErrorCode[] = ["forbidden", "invalid_input", "invalid_binding", "revoked_binding", "disabled", "conflict", "unavailable"];

/** Maps a PocketBase hook failure to a known domain code; raw diagnostics never pass through. */
export function checkinHookError(error: unknown, known: readonly CheckinErrorCode[]): CheckinError {
  const { code, status } = pocketBaseFailure(error);
  if (known.includes(code as CheckinErrorCode)) return new CheckinError(code as CheckinErrorCode, status || 400);
  const denied = status === 401 || status === 403;
  return new CheckinError(denied ? "forbidden" : "unavailable", denied ? 403 : 503);
}
