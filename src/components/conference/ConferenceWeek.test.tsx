import { renderToString } from "@solidjs/web";
import { describe, expect, it } from "vite-plus/test";
import { ConferenceWeek, TrackCard } from "~/components/conference/ConferenceWeek";
import type { PublicSpeakerSummary } from "~/lib/speakers-public";

const weekdayEvents = [
  "InfoSec Monday",
  "Workshop Tuesday",
  "DevFest",
  "MAUI Day",
  "Workshop Thursday",
  "Angular Day",
];

function speaker(slug: string, displayName: string, events: string[]): PublicSpeakerSummary {
  return {
    slug,
    displayName,
    photoUrl: null,
    affiliation: "",
    sessionCount: 0,
    appearanceEvents: events.map((name) => ({ name, compactLabel: name })),
  };
}

const renderWeek = (speakers?: PublicSpeakerSummary[]) =>
  renderToString(() => <ConferenceWeek speakers={speakers} />).replace(/<!--.*?-->/g, "");
const cards = (html: string) => html.match(/<article\b[^>]*>[\s\S]*?<\/article>/g) ?? [];

describe("homepage conference week cards", () => {
  it("shows each event's confirmed venue without stale Tuesday or MAUI locations", () => {
    const renderedCards = cards(renderWeek());
    const venues = [
      "Base42 Hackerspace, Rimska 25, 1000 Skopje", "Netaville, Skopje",
      "Small FINKI amphitheater, Technical Campus, Skopje", "INNOFeit, Technical Campus, Skopje",
      "Base42 Hackerspace, Rimska 25, 1000 Skopje", "Small FINKI amphitheater, Technical Campus, Skopje",
    ];
    venues.forEach((venue, index) => expect(renderedCards[index]).toContain(venue));
    expect(renderedCards[1]).not.toContain("Base42");
    expect(renderedCards[3]).not.toContain("FINKI");
  });

  it.each([undefined, [], [speaker("unrelated", "Unrelated Speaker", ["Another Event"])]] as const)(
    "keeps static events, confirmed times and ticket CTAs visible without matching roster data (%j)",
    (roster) => {
      const html = renderWeek(roster ? [...roster] : undefined);
      expect(cards(html)).toHaveLength(7);
      for (const name of weekdayEvents) expect(html).toContain(name);
      expect(html).toContain("Main Conference Day");
      expect(html).toContain("14:00–18:00");
      expect(html).toContain("Starts at 16:00");
      expect(html).toContain("On the agenda");
      expect(html).toContain("Reserve a free ticket");
      expect(html).toContain('href="/tickets"');
      expect(html).not.toContain('/speakers/');
      expect(html).not.toContain("Unrelated Speaker");
      expect(html).not.toContain("More speakers to come.");
    },
  );

  it("places each newly published speaker only on their own event card", () => {
    const roster = weekdayEvents.map((event, index) => speaker(`new-${index}`, `New Speaker ${index}`, [event]));
    const renderedCards = cards(renderWeek(roster));
    for (const [index, card] of renderedCards.slice(0, 6).entries()) {
      expect(card.match(/href="\/speakers\/[^"]+"/g)).toEqual([`href="/speakers/new-${index}"`]);
      expect(card).toContain(`New Speaker ${index}`);
    }
  });

  it("keeps internal CTAs in the same tab without an external arrow", () => {
    const html = renderToString(() => <TrackCard track={{
      name: "Workshop Thursday",
      summary: "A workshop.",
      href: "https://example.com/event",
      cta: { label: "Get a workshop ticket", href: "/tickets" },
    }} />);
    const cta = html.match(/<a\b[^>]*href="\/tickets"[^>]*>[\s\S]*?<\/a>/)?.[0];
    expect(cta).toContain("Get a workshop ticket");
    expect(cta).not.toContain("target=");
    expect(cta).not.toContain("rel=");
    expect(cta).not.toMatch(/↗|&#8599;/);
  });

  it("marks external CTAs independently of internal event headings", () => {
    const html = renderToString(() => <TrackCard track={{
      name: "InfoSec Monday",
      summary: "A workshop.",
      href: "/agenda?day=2026-09-14",
      cta: { label: "Reserve a free ticket", href: "https://example.com/checkout" },
    }} />);
    const links = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? [];
    expect(links[0]).toContain('href="/agenda?day=2026-09-14"');
    expect(links[0]).not.toContain("target=");
    expect(links[0]).not.toMatch(/↗|&#8599;/);
    expect(links[1]).toContain('target="_blank"');
    expect(links[1]).toContain('rel="noopener noreferrer"');
    expect(links[1]).toMatch(/↗|&#8599;/);
  });

  it("keeps each free event's entry details and reservation in one bottom region", () => {
    const renderedCards = cards(renderWeek());
    for (const name of ["InfoSec Monday", "Workshop Tuesday: iOS + AI", "Angular Day"]) {
      const card = renderedCards.find((card) => card.includes(name))!;
      expect(card).toContain("Free entry.");
      expect(card).toContain("Reserve a free ticket");
      const bottomRegions = card.match(/<div[^>]*class="[^"]*mt-auto[^"]*"[^>]*>[\s\S]*?<\/div>/g) ?? [];
      expect(bottomRegions).toHaveLength(1);
      expect(bottomRegions[0]).toContain("Free entry.");
      expect(bottomRegions[0]).toContain("Reserve a free ticket");
    }
  });

  it("renders linked, deduplicated event members on all six weekdays, not the main-day card", () => {
    const ana = speaker("ana-new", "Ana New", weekdayEvents);
    const zoe = speaker("zoe-example", "Zoe Example", weekdayEvents);
    const html = renderWeek([
      zoe,
      speaker("main-day-only", "Main Day Only", ["Main Conference Day"]),
      ana,
      ana,
      speaker("unassigned", "Unassigned Speaker", []),
    ]);
    const renderedCards = cards(html);
    expect(renderedCards).toHaveLength(7);
    for (const card of renderedCards.slice(0, 6)) {
      expect(card.match(/href="\/speakers\/ana-new"/g)).toHaveLength(1);
      expect(card).toMatch(/href="\/speakers\/ana-new"[^>]*>Ana New<\/a>/);
      expect(card).toMatch(/href="\/speakers\/zoe-example"[^>]*>Zoe Example<\/a>/);
      expect(card.indexOf("Ana New")).toBeLessThan(card.indexOf("Zoe Example"));
      expect(card).not.toContain("Main Day Only");
      expect(card).not.toContain("Unassigned Speaker");
    }
    expect(renderedCards[6]).not.toContain('/speakers/');
    expect(renderedCards[6]).toContain("On the agenda");
  });
});
