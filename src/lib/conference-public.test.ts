import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchAllRecords = vi.hoisted(() => vi.fn());

vi.mock("~/lib/pocketbase-admin-service", () => ({
  getAdminPB: () => ({ fetchAllRecords }),
}));

import {
  loadPublicSpeakerBySlug,
  loadPublicSpeakerTeaser,
  loadPublicSpeakers,
} from "~/lib/conference-public";

describe("public Speaker Event Appearances", () => {
  beforeEach(() => {
    fetchAllRecords.mockReset();
  });

  it("exposes only Published Appearance Events in catalogue order on Speaker listings", async () => {
    fetchAllRecords.mockImplementation((collection: string) => {
      if (collection === "speakers") {
        return Promise.resolve([
          {
            id: "speaker-1",
            slug: "ada-lovelace",
            display_name: "Ada Lovelace",
            affiliation: "Analytical Engines",
            published: true,
            appearance_events: ["event-later", "event-draft", "event-first"],
          },
        ]);
      }
      if (collection === "sessions") return Promise.resolve([]);
      if (collection === "appearance_events") {
        return Promise.resolve([
          {
            id: "event-later",
            name: "Community Warmup",
            compact_label: "Warmup",
            published: true,
            display_order: 2,
            destination_url: "https://private.example/warmup",
            internal_note: "never expose",
          },
          {
            id: "event-draft",
            name: "Secret Satellite",
            compact_label: "Secret",
            published: false,
            display_order: 1,
          },
          {
            id: "event-first",
            name: "WhatTheStack 2026",
            compact_label: "WTS 2026",
            published: true,
            display_order: 0,
          },
        ]);
      }
      throw new Error(`Unexpected collection ${collection}`);
    });

    const speakers = await loadPublicSpeakers();

    expect(speakers[0].appearanceEvents).toEqual([
      { name: "WhatTheStack 2026", compactLabel: "WTS 2026" },
      { name: "Community Warmup", compactLabel: "Warmup" },
    ]);
    expect(JSON.stringify(speakers)).not.toContain("Secret Satellite");
    expect(JSON.stringify(speakers)).not.toContain("destination_url");
    expect(fetchAllRecords).toHaveBeenCalledWith("appearance_events", {
      filter: "published = true",
      fields: "id,name,compact_label,published,display_order",
      sort: "display_order,name,id",
    });
  });

  it("includes the full published Appearance Event names on a Speaker profile DTO", async () => {
    fetchAllRecords.mockImplementation((collection: string) => {
      if (collection === "speakers") {
        return Promise.resolve([
          {
            id: "speaker-1",
            slug: "ada-lovelace",
            display_name: "Ada Lovelace",
            published: true,
            appearance_events: ["event-1"],
          },
        ]);
      }
      if (collection === "sessions") return Promise.resolve([]);
      if (collection === "appearance_events") {
        return Promise.resolve([
          {
            id: "event-1",
            name: "WhatTheStack Community Warmup: Skopje JS",
            compact_label: "Skopje JS Warmup",
            published: true,
            display_order: 1,
          },
        ]);
      }
      throw new Error(`Unexpected collection ${collection}`);
    });

    const speaker = await loadPublicSpeakerBySlug("ada-lovelace");

    expect(speaker?.appearanceEvents).toEqual([
      {
        name: "WhatTheStack Community Warmup: Skopje JS",
        compactLabel: "Skopje JS Warmup",
      },
    ]);
  });

  it("includes Appearance Events in the homepage Speaker teaser", async () => {
    fetchAllRecords.mockImplementation((collection: string) => {
      if (collection === "speakers") {
        return Promise.resolve([
          {
            id: "speaker-1",
            slug: "ada-lovelace",
            display_name: "Ada Lovelace",
            published: true,
            appearance_events: ["event-1"],
          },
        ]);
      }
      if (collection === "sessions") return Promise.resolve([]);
      if (collection === "appearance_events") {
        return Promise.resolve([
          {
            id: "event-1",
            name: "WhatTheStack 2026",
            compact_label: "WTS 2026",
            published: true,
            display_order: 0,
          },
        ]);
      }
      throw new Error(`Unexpected collection ${collection}`);
    });

    const teaser = await loadPublicSpeakerTeaser();

    expect(teaser.preview[0].appearanceEvents).toEqual([
      { name: "WhatTheStack 2026", compactLabel: "WTS 2026" },
    ]);
  });
});
