import { renderToString } from "@solidjs/web";

import { describe, expect, it, vi } from "vite-plus/test";
import type { PublicSpeakerDetail } from "~/lib/speakers-public";

const state = vi.hoisted(() => ({ profile: null as PublicSpeakerDetail | null }));
vi.mock("@solidjs/router", () => ({ useParams: () => ({ slug: "host" }) }));
vi.mock("~/lib/speakers-public", () => ({ fetchSpeakerBySlug: () => state.profile }));
vi.mock("~/layouts/Layout", () => ({ Layout: (props: { children: unknown }) => props.children }));
vi.mock("~/routes/[...404]", () => ({ default: () => "Not found" }));
import SpeakerDetail from "~/routes/speakers/[slug]/index";

const renderProfile = (isMc: boolean, sessions: PublicSpeakerDetail["sessions"] = [], isDj = false) => {
  state.profile = {
    slug: "host", displayName: "Our Host", photoUrl: null, affiliation: "Independent",
    bio: "Public biography", socialHandles: [], appearanceEvents: [], isMc, isDj, sessionCount: sessions.length, sessions,
  };
  return renderToString(() => <SpeakerDetail />).replace(/<!--.*?-->/g, "");
};

describe("speaker detail MC persona", () => {
  it("shows a DJ without promising an unannounced talk or marking them MC", () => {
    const html = renderProfile(false, [], true);
    expect(html).toContain(">DJ</");
    expect(html).toContain("Public biography");
    expect(html).not.toContain(">MC</");
    expect(html).not.toContain("Sessions");
    expect(html).not.toContain("haven't been published yet");
  });
  it("retains a DJ's real Session links", () => {
    expect(renderProfile(false, [{ slug: "real-session", title: "Real session" }], true)).toContain('href="/sessions/real-session"');
  });
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
