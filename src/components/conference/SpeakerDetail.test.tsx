import { renderToString } from "@solidjs/web";

import { describe, expect, it, vi } from "vite-plus/test";
import type { PublicSpeakerDetail } from "~/lib/speakers-public";

const state = vi.hoisted(() => ({ profile: null as PublicSpeakerDetail | null }));
vi.mock("@solidjs/router", () => ({ useParams: () => ({ slug: "host" }) }));
vi.mock("~/lib/speakers-public", () => ({ fetchSpeakerBySlug: () => state.profile }));
vi.mock("~/layouts/Layout", () => ({ Layout: (props: { children: unknown }) => props.children }));
vi.mock("~/routes/[...404]", () => ({ default: () => "Not found" }));
import SpeakerDetail from "~/routes/speakers/[slug]/index";

const renderProfile = (isMc: boolean, sessions: PublicSpeakerDetail["sessions"] = []) => {
  state.profile = {
    slug: "host", displayName: "Our Host", photoUrl: null, affiliation: "Independent",
    bio: "Public biography", socialHandles: [], appearanceEvents: [], isMc, sessionCount: sessions.length, sessions,
  };
  return renderToString(() => <SpeakerDetail />).replace(/<!--.*?-->/g, "");
};

describe("speaker detail MC persona", () => {
  it("shows an MC independently of affiliation and bio without a future Sessions promise", () => {
    const html = renderProfile(true);
    expect(html).toContain(">MC</");
    expect(html).toContain("Independent");
    expect(html).toContain("Public biography");
    expect(html).not.toContain("Sessions");
    expect(html).not.toContain("haven't been published yet");
  });
  it("still links an MC's actual sessions", () => {
    const html = renderProfile(true, [{ slug: "actual-talk", title: "An actual talk" }]);
    expect(html).toContain(">MC</");
    expect(html).toContain("Sessions");
    expect(html).toContain('href="/sessions/actual-talk"');
  });
  it("preserves the ordinary speaker empty state", () => {
    const html = renderProfile(false);
    expect(html).not.toContain(">MC</");
    expect(html).toContain("This speaker's sessions haven't been published yet.");
  });
});
