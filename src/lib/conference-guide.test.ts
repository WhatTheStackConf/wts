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

describe("Conference Guide", () => {
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
