import { describe, expect, it } from "vitest";
import { conferenceGuideContent } from "~/lib/conference-guide-content";
import {
  createConferenceGuide,
  ProgrammeUnavailableError,
  type ConferenceGuidePublishedData,
} from "~/lib/conference-guide";

function publishedData(): ConferenceGuidePublishedData {
  return {
    agenda: {
      days: [{
        key: "conference-day",
        localDate: "2026-09-19",
        title: "Conference Day",
        slots: [
          {
            kind: "opening",
            startAt: "2026-09-19T07:00:00.000Z",
            endAt: "2026-09-19T07:30:00.000Z",
            title: "<strong>Opening</strong>",
            summary: "Doors open &amp; coffee is ready.",
          },
          {
            kind: "session",
            startAt: "2026-09-19T08:00:00.000Z",
            endAt: "2026-09-19T08:35:00.000Z",
            locationLabel: "Main stage",
            track: { key: "systems", name: "Systems", locationLabel: "Stage A" },
            session: { slug: "safe-systems", title: "Safe <em>Systems</em>", format: "Talk" },
          },
        ],
      }],
    },
    sessions: [{
      slug: "safe-systems",
      title: "Safe <em>Systems</em>",
      abstract: "<p>Build &amp; ship.</p><script>ignore()</script><ul><li>Safely</li></ul>",
      format: "Talk",
      speakers: [{
        slug: "ada-example",
        displayName: "Ada Example",
        photoUrl: "https://pb.example/api/files/speakers/private-speaker-id/photo.webp",
        affiliation: "Example Labs",
        sessionCount: 1,
        origin: "cfp",
        published: true,
      } as never],
      relatedSessions: [],
      id: "private-session-id",
      cfp_submission_id: "private-submission-id",
      key_takeaways: "Private Key Takeaways",
      review_summary: "Private review summary",
      created: "2026-01-01T00:00:00.000Z",
    } as never],
    speakers: [{
      slug: "ada-example",
      displayName: "Ada Example",
      photoUrl: "https://pb.example/api/files/speakers/private-speaker-id/photo.webp",
      affiliation: "Example Labs",
      sessionCount: 1,
      bio: "<p>Engineer &amp; community builder.</p>",
      socialHandles: ["https://example.com/ada"],
      sessions: [{ slug: "safe-systems", title: "Safe Systems", format: "Talk" }],
      origin: "cfp",
      cfp_applicant: "private-applicant-id",
      published: true,
      updated: "2026-07-14T00:00:00.000Z",
    } as never],
    partnerGroups: [{
      id: "supporters",
      title: "Supporters",
      kind: "partner",
      type: "supporter",
      partners: [{
        name: "Example Partner",
        logoUrl: "https://pb.example/api/files/partners/private-partner-id/logo.svg",
        url: "https://partner.example/path",
        type: "supporter",
        notes: "Private Partner Note",
        admin_actions: ["Private Admin Action"],
        published: true,
      } as never],
    }],
  };
}

function searchablePublishedData(): ConferenceGuidePublishedData {
  const data = publishedData();
  data.agenda.days[0].slots.push(
    {
      kind: "session",
      startAt: "2026-09-19T09:00:00.000Z",
      endAt: "2026-09-19T10:00:00.000Z",
      locationLabel: "Workshop room",
      track: { key: "platforms", name: "Platforms", locationLabel: "Workshop room" },
      session: { slug: "resilient-platforms", title: "Resilient Platforms", format: "Workshop" },
    },
    {
      kind: "session",
      startAt: "2026-09-19T10:00:00.000Z",
      endAt: "2026-09-19T10:35:00.000Z",
      locationLabel: "Hall A-B",
      track: { key: "systems", name: "Systems", locationLabel: "Stage A" },
      session: { slug: "beta-operations", title: "Operations at Scale", format: "C#" },
    },
    {
      kind: "session",
      startAt: "2026-09-19T11:00:00.000Z",
      endAt: "2026-09-19T11:35:00.000Z",
      locationLabel: "Hall A/B",
      track: { key: "systems", name: "Systems", locationLabel: "Stage A" },
      session: { slug: "alpha-operations", title: "Operations at Scale", format: "C++" },
    },
  );
  data.sessions.push(
    {
      slug: "resilient-platforms",
      title: "Resilient Platforms",
      abstract: `<p>${"Recovery needs context. ".repeat(20)}Safe systems recover without guesswork.</p>`,
      format: "Workshop",
      speakers: [{
        slug: "grace-example",
        displayName: "Grace Example",
        affiliation: "Platform Guild",
        sessionCount: 1,
      } as never],
      relatedSessions: [],
      id: "private-resilient-session-id",
      reviews: ["private-resilient-review"],
    } as never,
    {
      slug: "beta-operations",
      title: "Operations at Scale",
      abstract: "Practical operations patterns.",
      format: "C#",
      speakers: [{
        slug: "lin-example",
        displayName: "Lin Example",
        affiliation: "Operations Group",
        sessionCount: 2,
      } as never],
      relatedSessions: [],
    },
    {
      slug: "alpha-operations",
      title: "Operations at Scale",
      abstract: "Practical operations patterns.",
      format: "C++",
      speakers: [{
        slug: "lin-example",
        displayName: "Lin Example",
        affiliation: "Operations Group",
        sessionCount: 2,
      } as never],
      relatedSessions: [],
    },
  );
  data.agenda.days.push({
    key: "community-day",
    localDate: "2026-09-20",
    title: "Community Day",
    slots: [{
      kind: "session",
      startAt: "2026-09-20T08:00:00.000Z",
      endAt: "2026-09-20T08:35:00.000Z",
      locationLabel: "Community hall",
      track: { key: "community", name: "Community", locationLabel: "Community hall" },
      session: { slug: "future-community", title: "Future Community", format: "Panel" },
    }],
  });
  data.sessions.push({
    slug: "future-community",
    title: "Future Community",
    abstract: "How communities prepare for tomorrow.",
    format: "Panel",
    speakers: [{
      slug: "sam-example",
      displayName: "Sam Example",
      affiliation: "Community Hub",
      sessionCount: 1,
    } as never],
    relatedSessions: [],
  });
  return data;
}

describe("Conference Guide", () => {
  it("ranks Published Session data deterministically with explainable bounded matches", async () => {
    const guide = createConferenceGuide({
      content: conferenceGuideContent,
      loadPublishedData: async () => searchablePublishedData(),
      canonicalOrigin: "https://wts.sh",
      now: () => new Date("2026-07-14T18:00:00.000Z"),
    });

    const ranked = await guide.searchSessions({ query: "safe systems", limit: 10 });
    const repeated = await guide.searchSessions({ query: "safe systems", limit: 10 });
    const tied = await guide.searchSessions({ query: "operations", limit: 10 });

    expect(ranked).toMatchObject({
      metadata: {
        schema_version: "1",
        content_version: "2026-07-14",
        programme_version: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        generated_at: "2026-07-14T18:00:00.000Z",
        time_zone: "Europe/Skopje",
        canonical_url: "https://wts.sh/sessions",
      },
      outcome: "results",
      ranking: {
        method: "deterministic_lexical_v1",
        tie_break: "session_slug_ascending",
      },
      total_matches: 2,
      results: [
        {
          slug: "safe-systems",
          canonical_url: "https://wts.sh/sessions/safe-systems",
          speakers: [{
            slug: "ada-example",
            canonical_url: "https://wts.sh/speakers/ada-example",
          }],
        },
        {
          slug: "resilient-platforms",
          canonical_url: "https://wts.sh/sessions/resilient-platforms",
          speakers: [{
            slug: "grace-example",
            canonical_url: "https://wts.sh/speakers/grace-example",
          }],
        },
      ],
    });
    expect(ranked.results[0].matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "title", snippet: "Safe Systems" }),
    ]));
    expect(ranked.results[1].matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "abstract", snippet: expect.stringContaining("Safe systems") }),
    ]));
    expect(ranked.results[1].matches[0].snippet.length).toBeLessThanOrEqual(240);
    expect(repeated).toEqual(ranked);
    expect(tied.results.map((result) => result.slug)).toEqual([
      "alpha-operations",
      "beta-operations",
    ]);

    const fieldCases = [
      { query: "Grace Example", field: "speaker_name", slug: "resilient-platforms" },
      { query: "Platform Guild", field: "speaker_affiliation", slug: "resilient-platforms" },
      { query: "Workshop", field: "format", slug: "resilient-platforms" },
      { query: "Platforms", field: "track", slug: "resilient-platforms" },
      { query: "Workshop room", field: "location", slug: "resilient-platforms" },
    ] as const;
    for (const fieldCase of fieldCases) {
      const result = await guide.searchSessions({ query: fieldCase.query, limit: 10 });
      expect(result.results[0]).toMatchObject({ slug: fieldCase.slug });
      expect(result.results[0].matches).toEqual(expect.arrayContaining([
        expect.objectContaining({ field: fieldCase.field }),
      ]));
    }

    const serialized = JSON.stringify({ ranked, tied });
    for (const forbidden of [
      "private-resilient-session-id",
      "private-resilient-review",
      '"published"',
      '"origin"',
      "<p>",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("applies every structured Session filter and returns bounded actionable no-result outcomes", async () => {
    const guide = createConferenceGuide({
      content: conferenceGuideContent,
      loadPublishedData: async () => searchablePublishedData(),
      canonicalOrigin: "https://wts.sh",
      now: () => new Date("2026-07-14T18:00:00.000Z"),
    });

    const filterCases = [
      { query: "future", filters: { date: "2026-09-20" }, slug: "future-community" },
      { query: "systems", filters: { format: "workshop" }, slug: "resilient-platforms" },
      { query: "systems", filters: { track: "platforms" }, slug: "resilient-platforms" },
      { query: "systems", filters: { speaker: "grace-example" }, slug: "resilient-platforms" },
      { query: "systems", filters: { location: "WORKSHOP ROOM" }, slug: "resilient-platforms" },
    ] as const;

    for (const filterCase of filterCases) {
      const result = await guide.searchSessions({
        query: filterCase.query,
        filters: filterCase.filters,
        limit: 20,
      });
      expect(result.results.map((session) => session.slug)).toEqual([filterCase.slug]);
    }

    const noResults = await guide.searchSessions({
      query: "systems",
      filters: { location: "Room that does not exist" },
      limit: 20,
    });
    expect(noResults).toMatchObject({
      outcome: "no_results",
      total_matches: 0,
      result_count: 0,
      results: [],
      next_step: expect.stringContaining("remove a structured filter"),
      metadata: { programme_version: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) },
    });

    const bounded = await guide.searchSessions({ query: "operations", limit: 1 });
    expect(bounded).toMatchObject({
      outcome: "results",
      total_matches: 2,
      result_count: 1,
      results: [{ slug: "alpha-operations" }],
    });

    const punctuationCases = [
      { filters: { format: "C++" }, slug: "alpha-operations" },
      { filters: { format: "C#" }, slug: "beta-operations" },
      { filters: { location: "Hall A/B" }, slug: "alpha-operations" },
      { filters: { location: "Hall A-B" }, slug: "beta-operations" },
    ] as const;
    for (const punctuationCase of punctuationCases) {
      const result = await guide.searchSessions({
        query: "operations",
        filters: punctuationCase.filters,
        limit: 20,
      });
      expect(result.results.map((session) => session.slug)).toEqual([punctuationCase.slug]);
    }

    const punctuationQueryCases = [
      { query: "C++", field: "format", slug: "alpha-operations" },
      { query: "C#", field: "format", slug: "beta-operations" },
      { query: "Hall A/B", field: "location", slug: "alpha-operations" },
      { query: "Hall A-B", field: "location", slug: "beta-operations" },
    ] as const;
    for (const punctuationCase of punctuationQueryCases) {
      const result = await guide.searchSessions({ query: punctuationCase.query, limit: 20 });
      expect(result.results.map((session) => session.slug)).toEqual([punctuationCase.slug]);
      expect(result.results[0].matches).toEqual(expect.arrayContaining([
        expect.objectContaining({ field: punctuationCase.field }),
      ]));
    }
  });

  it("combines deploy facts and Published DTOs into strict versioned resources", async () => {
    const guide = createConferenceGuide({
      content: conferenceGuideContent,
      loadPublishedData: async () => publishedData(),
      canonicalOrigin: "https://wts.sh",
      now: () => new Date("2026-07-14T18:00:00.000Z"),
    });

    const index = await guide.getIndex();
    const agenda = await guide.getAgenda();
    const session = await guide.getSession("safe-systems");
    const speaker = await guide.getSpeaker("ada-example");
    const partners = await guide.getPartners();

    expect(index).toMatchObject({
      metadata: {
        schema_version: "1",
        content_version: "2026-07-14",
        programme_version: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        generated_at: "2026-07-14T18:00:00.000Z",
        time_zone: "Europe/Skopje",
        canonical_url: "https://wts.sh/mcp",
      },
      programme_status: "available",
      logistics: {
        event: { date: { status: "announced", local_date: "2026-09-19" } },
        main_venue: { status: "not_announced" },
        accessibility: { status: "not_announced" },
        accommodation: { status: "not_announced" },
      },
      programme: {
        agenda: { resource_uri: "wts://conference-guide/agenda" },
        sessions: [{ slug: "safe-systems", canonical_url: "https://wts.sh/sessions/safe-systems" }],
        speakers: [{ slug: "ada-example", canonical_url: "https://wts.sh/speakers/ada-example" }],
        partners: { resource_uri: "wts://conference-guide/partners" },
      },
    });
    expect(agenda.days[0]).toMatchObject({
      key: "conference-day",
      slots: [
        { kind: "opening", start_time: "09:00", end_time: "09:30", title: "Opening" },
        {
          kind: "session",
          start_time: "10:00",
          end_time: "10:35",
          track: { key: "systems", name: "Systems" },
          session: { slug: "safe-systems", resource_uri: "wts://conference-guide/sessions/safe-systems" },
        },
      ],
    });
    expect(session).toMatchObject({
      slug: "safe-systems",
      title: "Safe Systems",
      abstract: "Build & ship.\nSafely",
      canonical_url: "https://wts.sh/sessions/safe-systems",
      schedule: {
        status: "scheduled",
        day_key: "conference-day",
        track: { key: "systems" },
      },
      speakers: [{ slug: "ada-example", canonical_url: "https://wts.sh/speakers/ada-example" }],
    });
    expect(speaker).toMatchObject({
      slug: "ada-example",
      bio: "Engineer & community builder.",
      sessions: [{ slug: "safe-systems", canonical_url: "https://wts.sh/sessions/safe-systems" }],
    });
    expect(partners.groups[0]).toMatchObject({
      key: "supporters",
      partners: [{ name: "Example Partner", website_url: "https://partner.example/path" }],
    });

    const resources = JSON.stringify({ index, agenda, session, speaker, partners });
    for (const forbidden of [
      "private-session-id",
      "private-speaker-id",
      "private-partner-id",
      "private-submission-id",
      "private-applicant-id",
      "Private Partner Note",
      "Private Key Takeaways",
      "Private review summary",
      "Private Admin Action",
      '"published"',
      '"origin"',
      '"created"',
      '"updated"',
      "<p>",
      "<script>",
    ]) {
      expect(resources).not.toContain(forbidden);
    }
    expect(agenda.metadata.programme_version).toBe(index.metadata.programme_version);
    expect(session?.metadata.programme_version).toBe(index.metadata.programme_version);
    expect(speaker?.metadata.programme_version).toBe(index.metadata.programme_version);
    expect(partners.metadata.programme_version).toBe(index.metadata.programme_version);
  });

  it("keeps deploy facts readable and marks the programme unavailable on source failure", async () => {
    const guide = createConferenceGuide({
      content: conferenceGuideContent,
      loadPublishedData: async () => { throw new Error("PocketBase unavailable"); },
      canonicalOrigin: "https://wts.sh",
      now: () => new Date("2026-07-14T18:00:00.000Z"),
    });

    await expect(guide.getIndex()).resolves.toMatchObject({
      programme_status: "programme_unavailable",
      metadata: { programme_version: "programme_unavailable" },
      logistics: { main_venue: { status: "not_announced" } },
    });
    await expect(guide.getAgenda()).rejects.toBeInstanceOf(ProgrammeUnavailableError);
    await expect(guide.getSession("safe-systems")).rejects.toBeInstanceOf(ProgrammeUnavailableError);
    await expect(guide.getSpeaker("ada-example")).rejects.toBeInstanceOf(ProgrammeUnavailableError);
    await expect(guide.getPartners()).rejects.toBeInstanceOf(ProgrammeUnavailableError);
  });

  it("never serves expired programme data after a failed refresh", async () => {
    let now = Date.parse("2026-07-14T18:00:00.000Z");
    let available = true;
    let loads = 0;
    const guide = createConferenceGuide({
      content: conferenceGuideContent,
      loadPublishedData: async () => {
        loads += 1;
        if (!available) throw new Error("PocketBase unavailable");
        return publishedData();
      },
      canonicalOrigin: "https://wts.sh",
      now: () => new Date(now),
      programmeTtlMs: 60_000,
    });

    await expect(guide.getSession("safe-systems")).resolves.toMatchObject({ slug: "safe-systems" });
    available = false;
    now += 59_999;
    await expect(guide.getSession("safe-systems")).resolves.toMatchObject({ slug: "safe-systems" });
    expect(loads).toBe(1);

    now += 1;
    await expect(guide.getSession("safe-systems")).rejects.toBeInstanceOf(ProgrammeUnavailableError);
    await expect(guide.getIndex()).resolves.toMatchObject({
      programme_status: "programme_unavailable",
      metadata: { programme_version: "programme_unavailable" },
    });
    expect(loads).toBe(3);
  });
});
