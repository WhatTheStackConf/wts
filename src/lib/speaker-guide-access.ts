import { createHash, timingSafeEqual } from "node:crypto";

const SPEAKER_GUIDE_PATH = "/speaker-guide";
const SPEAKER_GUIDE_PASSWORD_DIGEST =
  "5b6d9aafe4fe6cd8012a3a51bf80e1cb11f978d39f44508fa86c1a902bed4994";

export function requiresSpeakerGuidePassword(pathname: string): boolean {
  return pathname === SPEAKER_GUIDE_PATH || pathname === `${SPEAKER_GUIDE_PATH}/`;
}

export function hasValidSpeakerGuidePassword(
  url: URL,
  expectedDigest = SPEAKER_GUIDE_PASSWORD_DIGEST,
): boolean {
  const suppliedPassword = url.searchParams.get("pw");
  if (!suppliedPassword) return false;

  const suppliedDigest = createHash("sha256").update(suppliedPassword).digest();
  const expected = Buffer.from(expectedDigest, "hex");

  return expected.length === suppliedDigest.length && timingSafeEqual(expected, suppliedDigest);
}
