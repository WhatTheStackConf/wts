// Browser-safe syntax only. Secret generation and hashing stay server-side.
export const MISSION_CODE_PREFIX_LENGTH = 8;
export const MISSION_CODE_SECRET_LENGTH = 26;
export const MISSION_CODE_VERSION = "WTS26";
export const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const CODE_PATTERN = new RegExp(
  `^${MISSION_CODE_VERSION}([${CROCKFORD_BASE32}]{${MISSION_CODE_PREFIX_LENGTH}})([${CROCKFORD_BASE32}]{${MISSION_CODE_SECRET_LENGTH}})$`,
);
const EMBEDDED_CODE_PATTERN = new RegExp(
  `${MISSION_CODE_VERSION}[${CROCKFORD_BASE32}]{${MISSION_CODE_PREFIX_LENGTH + MISSION_CODE_SECRET_LENGTH}}`,
);

export interface ParsedMissionCode {
  normalizedCode: string;
  lookupPrefix: string;
}

/** Syntax validation is not registration, authorization, or reward evidence. */
export function parseMissionCode(rawCode: unknown): ParsedMissionCode | undefined {
  if (typeof rawCode !== "string") return undefined;
  const normalizedCode = rawCode.trim().toUpperCase().replace(/[\s-]/g, "");
  const match = CODE_PATTERN.exec(normalizedCode);
  if (!match) return undefined;
  return { normalizedCode, lookupPrefix: match[1] };
}

export function containsMissionCode(value: unknown): boolean {
  return typeof value === "string" && EMBEDDED_CODE_PATTERN.test(value.toUpperCase().replace(/[\s-]/g, ""));
}
