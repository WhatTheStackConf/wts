import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fetchAllRecords = vi.hoisted(() => vi.fn());

vi.mock("~/lib/pocketbase-admin-service", () => ({
  getAdminPB: () => ({ fetchAllRecords }),
}));

import {
  loadPublicConferenceGuideProgramme,
  loadPublicSessionBySlug,
  loadPublicAgenda,
  loadPublicSpeakerBySlug,
  loadPublicSpeakerTeaser,
  loadPublicSpeakers,
} from "~/lib/conference-public";
import {
  pocketBaseThumbnailSrcSet,
  pocketBaseThumbnailUrl,
} from "~/lib/pocketbase-thumbnail";

describe("PocketBase image thumbnails", () => {
  it("builds responsive optimized image URLs for raster images", () => {
    const url = "https://pb.example/api/files/speakers/speaker-1/photo.png";

    expect(pocketBaseThumbnailUrl(url, "256x256")).toBe(
      `/api/image?src=${encodeURIComponent(url)}&width=256&height=256`,
    );
    expect(pocketBaseThumbnailSrcSet(url, [128, 256])).toBe(
      `/api/image?src=${encodeURIComponent(url)}&width=128&height=128 128w, /api/image?src=${encodeURIComponent(url)}&width=256&height=256 256w`,
    );
  });

  it("optimizes SVG files through the image endpoint", () => {
    const url = "https://pb.example/api/files/partners/partner-1/logo.svg";

    expect(pocketBaseThumbnailUrl(url, "640x320")).toBe(
      `/api/image?src=${encodeURIComponent(url)}&width=640&height=320`,
    );
    expect(
      pocketBaseThumbnailSrcSet(url, [320, 640], {
        aspectRatio: 2,
        mode: "fit",
      }),
    ).toBe(
      `/api/image?src=${encodeURIComponent(url)}&width=320&height=160&fit=contain 320w, /api/image?src=${encodeURIComponent(url)}&width=640&height=320&fit=contain 640w`,
    );
  });

  it("uses width-preserving PocketBase thumbnails for logos", () => {
    const url = "https://pb.example/api/files/partners/partner-1/logo.png";

    expect(
      pocketBaseThumbnailSrcSet(url, [320, 640, 1280], { mode: "width" }),
    ).toBe(
      `/api/image?src=${encodeURIComponent(url)}&width=320 320w, /api/image?src=${encodeURIComponent(url)}&width=640 640w, /api/image?src=${encodeURIComponent(url)}&width=1280 1280w`,
    );
  });
});

describe("announced session detail timing", () => {
  it("shows event-only DevFest timing and the confirmed Angular session time", async () => {
    for (const [slug, event, date, start] of [
      ["building-a-distributed-multi-agent-system", "DevFest", "2026-09-16", "17:00"],
      ["the-monorepo-multiplier", "Angular Day", "2026-09-18", "10:00"],
    ] as const) {
      fetchAllRecords.mockImplementation((collection: string) => Promise.resolve({
        sessions: [{ id: "talk", slug, title: slug, abstract: "", format: "talk", published: true, speakers: [] }],
        appearance_events: [{ id: "event", name: event, published: true }],
      }[collection] || []));
      const session = await loadPublicSessionBySlug(slug);
      if (event === "Angular Day") {
        expect(session?.schedule).toMatchObject({
          dayDate: date, event: { name: event },
          startAt: "2026-09-18T12:15:00+02:00", endAt: "2026-09-18T12:45:00+02:00",
          locationLabel: "Small FINKI amphitheater, Technical Campus, Skopje",
        });
      } else {
        expect(session?.schedule).toBeUndefined();
        expect(session?.announcement).toMatchObject({ dayDate: date, event: { name: event }, eventStartTime: start });
      }
    }
  });

  it("prefers a later published slot to an earlier announced session in the public snapshot", async () => {
    fetchAllRecords.mockImplementation((collection: string) => Promise.resolve({
      sessions: [{ id: "ios", slug: "fundamentals-of-native-ios-development", title: "iOS", abstract: "", published: true, speakers: [] }],
      appearance_events: [{ id: "tuesday", name: "Workshop Tuesday", published: true }, { id: "main", name: "Main", published: true }],
      conference_days: [{ id: "saturday", key: "main-day", local_date: "2026-09-19", title: "Main day", published: true }],
      event_programmes: [{ id: "programme", day: "saturday", appearance_event: "main" }],
      agenda_slots: [{ id: "slot", programme: "programme", session: "ios", kind: "session", published: true, start_at: "2026-09-19T08:00:00Z", end_at: "2026-09-19T09:00:00Z" }],
    }[collection] || []));
    const data = await loadPublicConferenceGuideProgramme();
    expect(data.sessions[0].schedule).toMatchObject({ startAt: "2026-09-19T08:00:00Z", endAt: "2026-09-19T09:00:00Z", event: { name: "Main" } });
  });
  it("uses the same confirmed start on the session page and hides it when its event is unpublished", async () => {
    fetchAllRecords.mockReset();
    let eventPublished = true;
    fetchAllRecords.mockImplementation((collection: string) => Promise.resolve({
      sessions: [{ id: "ios", slug: "fundamentals-of-native-ios-development", title: "iOS", abstract: "", format: "workshop", published: true, speakers: [] }],
      appearance_events: [{ id: "tuesday", name: "Workshop Tuesday", published: eventPublished }],
      agenda_slots: [], event_programmes: [], conference_days: [], agenda_tracks: [],
    }[collection] || []));
    const session = await loadPublicSessionBySlug("fundamentals-of-native-ios-development");
    expect(session?.schedule).toMatchObject({ startAt: "2026-09-15T18:00:00+02:00", endAt: undefined, locationLabel: "Netaville, Skopje" });
    eventPublished = false;
    expect((await loadPublicSessionBySlug("fundamentals-of-native-ios-development"))?.schedule).toBeUndefined();
  });
});

describe("public agenda loading", () => {
  it("loads published speaker names and photos without fetching private profile fields", async () => {
    fetchAllRecords.mockReset();
    fetchAllRecords.mockImplementation((collection: string) => Promise.resolve({
      conference_days: [{ id: "day", key: "main-day", local_date: "2026-09-19", title: "Main day", published: true }],
      appearance_events: [{ id: "event", name: "WhatTheStack 2026", published: true }],
      event_programmes: [{ id: "programme", day: "day", appearance_event: "event" }],
      agenda_tracks: [{ id: "track", programme: "programme", key: "stage-1", name: "Stage 1" }],
      agenda_slots: [{ id: "slot", programme: "programme", track: "track", kind: "session", published: true, session: "session", start_at: "2026-09-19T08:10:00.000Z", end_at: "2026-09-19T08:45:00.000Z" }],
      sessions: [{ id: "session", slug: "systems", title: "Systems", published: true, speakers: ["speaker"] }],
      speakers: [{ id: "speaker", slug: "ada", display_name: "Ada Lovelace", photo: "ada.jpg", published: true }],
    }[collection] || []));

    const agenda = await loadPublicAgenda();

    expect(agenda.days[0].programmes[0].slots[0].session?.speakers).toEqual([
      { slug: "ada", name: "Ada Lovelace", photoUrl: expect.stringMatching(/\/api\/files\/speakers\/speaker\/ada\.jpg$/) },
    ]);
    expect(fetchAllRecords).toHaveBeenCalledWith("speakers", {
      filter: "published = true",
      fields: "id,slug,display_name,photo,appearance_events,published",
      sort: "slug,id",
    });
    expect(fetchAllRecords).toHaveBeenCalledWith("sessions", {
      filter: "published = true",
      fields: "id,slug,title,format,published,speakers",
      sort: "title,id",
    });
  });
});

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
