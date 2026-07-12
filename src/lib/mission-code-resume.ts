export const PENDING_MISSION_CODE_STORAGE_KEY = "wts.mission-code.pending:v1";
export const PENDING_MISSION_CODE_TTL_MS = 15 * 60 * 1000;

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface PendingMissionCode {
  code: string;
  expiresAt: number;
}

function validPendingCode(code: unknown): code is string {
  return typeof code === "string" && code.length > 0 && code.length <= 160;
}

/** Reads only the `code` fragment parameter; fragments are never sent with HTTP requests. */
export function missionCodeFromFragment(hash: string): string | undefined {
  const code = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash).get("code");
  return validPendingCode(code) ? code : undefined;
}

/** Stores one short-lived pending secret in tab-scoped storage for the login resume path. */
export function savePendingMissionCode(storage: SessionStorageLike, code: string, now = Date.now()): boolean {
  if (!validPendingCode(code)) return false;
  storage.setItem(PENDING_MISSION_CODE_STORAGE_KEY, JSON.stringify({
    code,
    expiresAt: now + PENDING_MISSION_CODE_TTL_MS,
  } satisfies PendingMissionCode));
  return true;
}

export function readPendingMissionCode(storage: SessionStorageLike, now = Date.now()): string | undefined {
  const stored = storage.getItem(PENDING_MISSION_CODE_STORAGE_KEY);
  if (!stored) return undefined;
  try {
    const pending = JSON.parse(stored) as PendingMissionCode;
    if (!validPendingCode(pending.code) || !Number.isFinite(pending.expiresAt) || pending.expiresAt <= now) {
      storage.removeItem(PENDING_MISSION_CODE_STORAGE_KEY);
      return undefined;
    }
    return pending.code;
  } catch {
    storage.removeItem(PENDING_MISSION_CODE_STORAGE_KEY);
    return undefined;
  }
}

export function clearPendingMissionCode(storage: SessionStorageLike): void {
  storage.removeItem(PENDING_MISSION_CODE_STORAGE_KEY);
}

/** The login redirect deliberately contains no code, query parameters, or hash. */
export function setMissionCodeLoginResume(storage: Pick<SessionStorageLike, "setItem">): void {
  storage.setItem("redirect_url", "/missions/redeem");
}
