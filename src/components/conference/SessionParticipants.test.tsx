import { renderToString } from "@solidjs/web";
import { describe, expect, it } from "vite-plus/test";
import { SessionParticipants } from "~/components/conference/SessionParticipants";
import type { PublicSpeakerSummary } from "~/lib/conference-public";

const guest: PublicSpeakerSummary = { slug: "guest", displayName: "Guest", photoUrl: null, affiliation: "Independent", isMc: true, sessionCount: 1, appearanceEvents: [] };
const host = { ...guest, slug: "host", displayName: "Host Person", photoUrl: "https://pb.example/host.jpg" };

describe("session participants", () => {
  it("shows the host once, after guests, behind a visible divider with a photo", () => {
    const html = renderToString(() => <SessionParticipants speakers={[host, guest]} hosts={[host]} />);
    const [guests, hosts] = html.split('data-session-hosts');
    expect(guests).toContain('href="/speakers/guest"');
    expect(guests).not.toContain('href="/speakers/host"');
    expect(hosts).toContain('href="/speakers/host"');
    expect(hosts).toContain('host.jpg');
    expect(hosts).toContain('aria-label="Hosts"');
    expect(html).toContain('border-t border-white/20');
    expect(html.match(/href="\/speakers\/host"/g)).toHaveLength(1);
  });

  it("keeps ordinary MC speakers in the speakers list without an empty host section", () => {
    const html = renderToString(() => <SessionParticipants speakers={[guest]} />);
    expect(html).toContain('href="/speakers/guest"');
    expect(html).not.toContain('data-session-hosts');
  });
});
