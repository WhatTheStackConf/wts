import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fetchAllRecords = vi.hoisted(() => vi.fn());

vi.mock("~/lib/pocketbase-admin-service", () => ({
  getAdminPB: () => ({ fetchAllRecords }),
}));

import { loadPublicSpeakerPromoBySlug } from "~/lib/conference-public";

const defaults = {
  slug: "ada",
  displayName: "Ada",
  photoUrl: null,
  roleLine: "Speaker @ WhatTheStack",
  statusMessage: "will be there!",
  stack: [],
  cta: undefined,
  footerText: "Join us at ",
  footerLinks: [{ label: "wts.sh", href: "https://wts.sh", color: "#e879f9" }],
  footerSuffix: "",
};

async function promo(config: unknown, row: Record<string, unknown> = {}) {
  fetchAllRecords.mockResolvedValue([{ id: "speaker-1", slug: "ada", display_name: "Ada", published: true, promo: config, ...row }]);
  return loadPublicSpeakerPromoBySlug("ada");
}

describe("speaker promo config", () => {
  beforeEach(() => fetchAllRecords.mockReset());

  it.each([null, "text", 7, []])("falls back to defaults for %j", async (config) => {
    expect(await promo(config)).toStrictEqual(defaults);
  });

  it("uses the speaker affiliation when no role line is configured", async () => {
    expect(await promo({ roleLine: "  " }, { affiliation: "ACME" })).toStrictEqual({ ...defaults, roleLine: "ACME" });
  });

  it("trims and filters a full config", async () => {
    expect(await promo({
      statusMessage: "  speaking!  ",
      roleLine: " Staff Engineer ",
      stack: [{ name: " TypeScript ", color: " #123 " }, { name: "Go" }, { name: "  " }, null, "x", { color: "#fff" }],
      ctaHref: " https://example.com/talk ",
      ctaLabel: " Watch ",
      footerText: " See you at ",
      footerLinks: [{ label: " Site ", href: " https://a.dev " }, { label: "Blog", href: "https://b.dev", color: " #000 " }, { label: "", href: "x" }, { label: "No href" }, 3],
      footerSuffix: " !",
    })).toStrictEqual({
      ...defaults,
      roleLine: "Staff Engineer",
      statusMessage: "speaking!",
      stack: [{ name: "TypeScript", color: "#123" }, { name: "Go", color: "#a855f7" }],
      cta: { href: "https://example.com/talk", label: "Watch" },
      footerText: " See you at ",
      footerLinks: [{ label: "Site", href: "https://a.dev", color: "#e879f9" }, { label: "Blog", href: "https://b.dev", color: "#000" }],
      footerSuffix: " !",
    });
  });

  it.each([
    [{ ctaHref: "/tickets/", ctaLabel: "Buy" }],
    [{ ctaHref: "https://wts.sh/tickets", ctaLabel: "Buy" }],
    [{ ctaHref: "https://example.com", ctaLabel: " " }],
    [{ ctaHref: 5, ctaLabel: "Go" }],
  ])("drops an incomplete or retired CTA %j", async (config) => {
    expect((await promo(config))?.cta).toBeUndefined();
  });

  it("keeps defaults for empty lists and non-string footer fields", async () => {
    expect(await promo({ stack: "x", footerLinks: [], footerText: 1, footerSuffix: null, statusMessage: 3 })).toStrictEqual(defaults);
  });

  it("keeps an explicitly empty footer text", async () => {
    expect(await promo({ footerText: "" })).toStrictEqual({ ...defaults, footerText: "" });
  });
});
