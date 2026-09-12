import { renderToString } from "@solidjs/web";
import { describe, expect, it } from "vite-plus/test";
import { SpeakerCard } from "./SpeakerCard";
import type { PublicSpeakerSummary } from "~/lib/speakers-public";

const profile: PublicSpeakerSummary = {
  slug: "host", displayName: "Our Host", photoUrl: null, affiliation: "Independent",
  isMc: true, sessionCount: 0, appearanceEvents: [],
};
const renderCard = (isMc: boolean, sessionCount: number, variant: "teaser" | "full") =>
  renderToString(() => <SpeakerCard speaker={{ ...profile, isMc, sessionCount }} variant={variant} layout="featured" />).replace(/<!--.*?-->/g, "");

describe("speaker and MC cards", () => {
  it.each(["teaser", "full"] as const)("labels a zero-session MC without promising talks (%s)", (variant) => {
    const html = renderCard(true, 0, variant);
    expect(html).toContain(">MC</");
    expect(html).toContain("Independent");
    expect(html).not.toContain("Talks not announced yet");
    expect(html).not.toContain("0 sessions");
    expect(html).not.toContain("Featured speaker");
  });
  it("shows actual sessions alongside the MC designation", () => {
    const html = renderCard(true, 2, "full");
    expect(html).toContain(">MC</");
    expect(html).toContain("2 sessions");
  });
  it("preserves ordinary speaker behavior without inferring MC from zero sessions", () => {
    expect(renderCard(false, 0, "full")).toContain("Talks not announced yet");
    expect(renderCard(false, 0, "full")).not.toContain(">MC</");
    expect(renderCard(false, 1, "full")).toContain("1 session");
  });
});
