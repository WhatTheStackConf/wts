import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  hasValidSpeakerGuidePassword,
  requiresSpeakerGuidePassword,
} from "~/lib/speaker-guide-access";

const passwordDigest = createHash("sha256")
  .update("correct password")
  .digest("hex");

describe("speaker guide access", () => {
  it("protects only the speaker guide route", () => {
    expect(requiresSpeakerGuidePassword("/speaker-guide")).toBe(true);
    expect(requiresSpeakerGuidePassword("/speaker-guide/")).toBe(true);
    expect(requiresSpeakerGuidePassword("/speaker-guide-preview")).toBe(false);
    expect(requiresSpeakerGuidePassword("/about")).toBe(false);
  });

  it("accepts only the matching pw query parameter", () => {
    expect(
      hasValidSpeakerGuidePassword(
        new URL("https://wts.sh/speaker-guide?pw=correct%20password"),
        passwordDigest,
      ),
    ).toBe(true);
    expect(
      hasValidSpeakerGuidePassword(
        new URL("https://wts.sh/speaker-guide?pw=wrong"),
        passwordDigest,
      ),
    ).toBe(false);
    expect(
      hasValidSpeakerGuidePassword(
        new URL("https://wts.sh/speaker-guide"),
        passwordDigest,
      ),
    ).toBe(false);
  });
});
