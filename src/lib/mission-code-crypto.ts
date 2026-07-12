import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const MISSION_CODE_HASH_VERSION = "hmac-sha256-v1" as const;
export const MISSION_CODE_PREFIX_LENGTH = 8;
export const MISSION_CODE_SECRET_LENGTH = 26;

const MISSION_CODE_VERSION = "WTS26";
const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
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

export interface MissionCodeGeneration {
  /** Display this bearer secret once, then discard it. */
  rawCode: string;
  /** This object is safe to persist as a Code Definition. */
  definition: {
    lookupPrefix: string;
    codeHash: string;
    hashVersion: typeof MISSION_CODE_HASH_VERSION;
  };
}

/** Removes only separators the printed format permits before validating its exact shape. */
export function parseMissionCode(rawCode: unknown): ParsedMissionCode | undefined {
  if (typeof rawCode !== "string") return undefined;
  const normalizedCode = rawCode.trim().toUpperCase().replace(/[\s-]/g, "");
  const match = CODE_PATTERN.exec(normalizedCode);
  if (!match) return undefined;
  return { normalizedCode, lookupPrefix: match[1] };
}

/** Detects every separator-tolerant representation accepted by `parseMissionCode`. */
export function containsMissionCode(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return EMBEDDED_CODE_PATTERN.test(value.toUpperCase().replace(/[\s-]/g, ""));
}

export function hashNormalizedMissionCode(normalizedCode: string, pepper: string): string {
  if (!pepper) throw new Error("GAMIFICATION_CODE_PEPPER is required for Mission code operations.");
  return createHmac("sha256", pepper).update(normalizedCode, "utf8").digest("hex");
}

export function verifyMissionCodeHash(normalizedCode: string, expectedHash: string, pepper: string): boolean {
  const actual = Buffer.from(hashNormalizedMissionCode(normalizedCode, pepper), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function randomBase32(length: number): string {
  let value = "";
  while (value.length < length) {
    for (const byte of randomBytes(length - value.length)) {
      value += CROCKFORD_BASE32[byte & 31];
    }
  }
  return value;
}

/** Generates at least 130 bits of opaque bearer-secret entropy plus a random lookup prefix. */
export function createMissionCodeGeneration(pepper: string): MissionCodeGeneration {
  const lookupPrefix = randomBase32(MISSION_CODE_PREFIX_LENGTH);
  const secret = randomBase32(MISSION_CODE_SECRET_LENGTH);
  const rawCode = `${MISSION_CODE_VERSION}-${lookupPrefix}-${secret}`;
  const parsed = parseMissionCode(rawCode);
  if (!parsed) throw new Error("Generated Mission code did not pass validation.");
  return {
    rawCode,
    definition: {
      lookupPrefix,
      codeHash: hashNormalizedMissionCode(parsed.normalizedCode, pepper),
      hashVersion: MISSION_CODE_HASH_VERSION,
    },
  };
}

/** Hashes coarse request data before it is used as a private rate-limit/audit fingerprint. */
export function hashMissionRequestFingerprint(value: string, pepper: string): string {
  if (!pepper) throw new Error("GAMIFICATION_CODE_PEPPER is required for Mission code operations.");
  return createHmac("sha256", pepper).update(`mission-redemption-fingerprint:v1:${value}`, "utf8").digest("hex");
}
