import { describe, expect, it } from "vite-plus/test";
import { conferenceGuideContent } from "~/lib/conference-guide-content";
import {
  createConferenceGuide,
  ProgrammeUnavailableError,
  type ConferenceGuidePublishedData,
} from "~/lib/conference-guide";

const mainAgendaEvent = {
  name: "WhatTheStack 2026",
  compactLabel: "WTS 2026",
  destinationUrl: "https://wts.sh",
};

function publishedData(): ConferenceGuidePublishedData {
  return {
    agenda: {
      days: [{
        key: "conference-day",
        localDate: "2026-09-19",
        title: "Conference Day",
        programmes: [{
          event: mainAgendaEvent,
          tracks: [],
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
            session: { slug: "safe-systems", title: "Safe <em>Systems</em>", format: "Talk", speakers: [] },
          },
          ],
        }],
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

function announcedPublishedData(): ConferenceGuidePublishedData {
  const data = publishedData();
  const event = { name: "Workshop Tuesday: iOS + AI", compactLabel: "Tuesday" };
  data.agenda.days.unshift({
    key: "tuesday", localDate: "2026-09-15", title: "Workshop Tuesday",
    programmes: [{
      event, tracks: [], slots: [],
      untimed: {
        startTime: "16:00", title: "<b>Tuesday workshops</b>",
        locationLabel: "Base42 Hackerspace, Rimska 25, 1000 Skopje",
        summary: "<p>Free &amp; public.</p>",
        sessions: [{
          slug: "ddd-for-ai-assisted-development", title: "DDD for AI-assisted development", speakers: [],
          schedule: {
            dayDate: "2026-09-15", dayTitle: "Workshop Tuesday", event,
            startAt: "2026-09-15T14:00:00.000Z",
            locationLabel: "Base42 Hackerspace, Rimska 25, 1000 Skopje",
          },
        }, { slug: "lineup-only", title: "Lineup only", speakers: [] }],
      },
    }],
  });
  for (const session of data.agenda.days[0].programmes[0].untimed!.sessions) {
    data.sessions.push({ slug: session.slug, title: session.title, speakers: [], abstract: "Public development session", relatedSessions: [] });
  }
  return data;
}

describe("Conference Guide MC personas", () => {
  it("includes MC status on public speaker resources without inventing sessions", async () => {
    const data = publishedData();
    data.speakers[0].isMc = true;
    data.speakers[0].sessions = [];
    data.speakers[0].sessionCount = 0;
    const guide = createConferenceGuide({ loadPublishedData: async () => data });
    const speaker = await guide.getSpeaker("ada-example");
    expect(speaker).toMatchObject({ is_mc: true, sessions: [], affiliation: "Example Labs" });
    expect(JSON.stringify(speaker)).not.toContain("private-");
    expect((await guide.getSession("safe-systems"))?.speakers[0].is_mc).toBe(false);
  });
});

describe("announced weekday Conference Guide", () => {
  it("keeps announced ranges separate from plannable slots and prefers a later published slot", async () => {
    const data = announcedPublishedData();
    const announced = data.agenda.days[0].programmes[0].untimed!;
    announced.endTime = "20:00";
    announced.sessions[0].schedule!.endAt = "2026-09-15T18:00:00.000Z";
    announced.sessions.push({ slug: "safe-systems", title: "Earlier lineup mention", speakers: [] });
    const guide = createConferenceGuide({ loadPublishedData: async () => data });
    const session = await guide.getSession("ddd-for-ai-assisted-development");
    expect(session?.schedule).toMatchObject({
      status: "announced", start_time: "16:00", end_time: "20:00", end_local_date: "2026-09-15", end_status: "announced",
    });
    expect((await guide.getSession("safe-systems"))?.schedule).toMatchObject({
      status: "scheduled", local_date: "2026-09-19", start_time: "10:00", end_time: "10:35",
    });
    const plan = await guide.planProposedSchedule({ ranked_session_slugs: ["ddd-for-ai-assisted-development", "safe-systems"] });
    expect(plan.selected_sessions.map((session) => session.slug)).toEqual(["safe-systems"]);
    expect(plan.input_outcomes[0].outcome).toBe("unscheduled");
  });

  it("versions announced changes and allowlists lineup speakers and links", async () => {
    const data = announcedPublishedData();
    const announced = data.agenda.days[0].programmes[0].untimed!;
    const publicSpeaker = { slug: "ada-example", name: "<b>Ada &amp; Example</b>", photoUrl: "https://pb.example/private-id/photo.jpg" };
    announced.speakers = [publicSpeaker];
    announced.unassignedSpeakers = [publicSpeaker];
    announced.sessions[0].speakers = [publicSpeaker];
    announced.cta = { label: "<b>Register</b>", href: "/tickets" };
    const guide = createConferenceGuide({ loadPublishedData: async () => data, programmeTtlMs: 0 });
    const before = await guide.getAgenda();
    expect(before.days[0].programmes[0].announced).toMatchObject({
      cta: { label: "Register", canonical_url: "https://wts.sh/tickets" },
      speakers: [{ slug: "ada-example", display_name: "Ada & Example", canonical_url: "https://wts.sh/speakers/ada-example" }],
      unassigned_speakers: [{ slug: "ada-example" }],
    });
    expect(JSON.stringify(before)).not.toMatch(/private-id|photoUrl|<b>/);
    announced.startTime = "17:00";
    const eventChanged = await guide.getAgenda();
    expect(eventChanged.metadata.programme_version).not.toBe(before.metadata.programme_version);
    announced.sessions[0].schedule!.startAt = "2026-09-15T15:00:00.000Z";
    announced.cta = { label: "Unsafe", href: "javascript:alert(1)" };
    const sessionChanged = await guide.getAgenda();
    expect(sessionChanged.metadata.programme_version).not.toBe(eventChanged.metadata.programme_version);
    expect(sessionChanged.days[0].programmes[0].announced?.cta).toBeUndefined();
    expect((await guide.getSession("ddd-for-ai-assisted-development"))?.schedule).toMatchObject({ start_time: "17:00" });
  });

  it("searches partial schedules by their announced date and venue, and rejects unknown ends in planning", async () => {
    const guide = createConferenceGuide({ loadPublishedData: async () => announcedPublishedData() });
    const search = await guide.searchSessions({
      query: "Base42", filters: { date: "2026-09-15", location: "base42 hackerspace, rimska 25, 1000 skopje" },
    });
    expect(search.results.map((session) => session.slug)).toContain("ddd-for-ai-assisted-development");
    expect(search.results.find((session) => session.slug === "ddd-for-ai-assisted-development")?.schedule)
      .toMatchObject({ status: "announced", start_time: "16:00", end_status: "not_announced" });
    const plan = await guide.planProposedSchedule({ must_attend_slugs: ["ddd-for-ai-assisted-development", "lineup-only"] });
    expect(plan.selected_sessions).toEqual([]);
    expect(plan.input_outcomes).toEqual([
      { slug: "ddd-for-ai-assisted-development", requested_as: ["must_attend"], outcome: "end_time_not_announced" },
      { slug: "lineup-only", requested_as: ["must_attend"], outcome: "unscheduled" },
    ]);
    expect(plan.unresolved_hard_constraints[0].reason).toBe("end_time_not_announced");
  });

  it("exposes event starts and lineup sessions without inventing session ends or inheriting event starts", async () => {
    const guide = createConferenceGuide({ loadPublishedData: async () => announcedPublishedData() });
    const agenda = await guide.getAgenda();
    expect(agenda.days[0].programmes[0]).toMatchObject({
      slots: [],
      announced: {
        title: "Tuesday workshops", start_time: "16:00", summary: "Free & public.",
        location: "Base42 Hackerspace, Rimska 25, 1000 Skopje",
        sessions: [
          { slug: "ddd-for-ai-assisted-development", schedule: { status: "announced", local_date: "2026-09-15", start_time: "16:00", end_status: "not_announced" } },
          { slug: "lineup-only", schedule: { status: "announced", local_date: "2026-09-15" } },
        ],
      },
    });
    const session = await guide.getSession("ddd-for-ai-assisted-development");
    expect(session?.schedule).toMatchObject({ status: "announced", start_time: "16:00", end_status: "not_announced" });
    expect(session?.schedule).not.toHaveProperty("end_time");
    expect((await guide.getSession("lineup-only"))?.schedule).not.toHaveProperty("start_time");
    expect(JSON.stringify(agenda)).not.toContain("2026-09-15T14:00");
  });
});

function searchablePublishedData(): ConferenceGuidePublishedData {
  const data = publishedData();
  data.agenda.days[0].programmes[0].slots.push(
    {
      kind: "session",
      startAt: "2026-09-19T09:00:00.000Z",
      endAt: "2026-09-19T10:00:00.000Z",
      locationLabel: "Workshop room",
      track: { key: "platforms", name: "Platforms", locationLabel: "Workshop room" },
      session: { slug: "resilient-platforms", title: "Resilient Platforms", format: "Workshop", speakers: [] },
    },
    {
      kind: "session",
      startAt: "2026-09-19T10:00:00.000Z",
      endAt: "2026-09-19T10:35:00.000Z",
      locationLabel: "Hall A-B",
      track: { key: "systems", name: "Systems", locationLabel: "Stage A" },
      session: { slug: "beta-operations", title: "Operations at Scale", format: "C#", speakers: [] },
    },
    {
      kind: "session",
      startAt: "2026-09-19T11:00:00.000Z",
      endAt: "2026-09-19T11:35:00.000Z",
      locationLabel: "Hall A/B",
      track: { key: "systems", name: "Systems", locationLabel: "Stage A" },
      session: { slug: "alpha-operations", title: "Operations at Scale", format: "C++", speakers: [] },
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
    programmes: [{
      event: mainAgendaEvent,
      tracks: [],
      slots: [{
        kind: "session",
        startAt: "2026-09-20T08:00:00.000Z",
        endAt: "2026-09-20T08:35:00.000Z",
        locationLabel: "Community hall",
        track: { key: "community", name: "Community", locationLabel: "Community hall" },
        session: { slug: "future-community", title: "Future Community", format: "Panel", speakers: [] },
      }],
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

function plannablePublishedData(): ConferenceGuidePublishedData {
  const data = publishedData();
  data.agenda.days[0].programmes[0].slots.push(
    {
      kind: "session",
      startAt: "2026-09-19T08:00:00.000Z",
      endAt: "2026-09-19T08:35:00.000Z",
      locationLabel: "Workshop room",
      track: { key: "platforms", name: "Platforms", locationLabel: "Workshop room" },
      session: { slug: "reliable-runtime", title: "Reliable Runtime", format: "Talk", speakers: [] },
    },
    {
      kind: "session",
      startAt: "2026-09-19T08:15:00.000Z",
      endAt: "2026-09-19T09:00:00.000Z",
      locationLabel: "Studio",
      track: { key: "architecture", name: "Architecture", locationLabel: "Studio" },
      session: { slug: "platform-depth", title: "Platform Depth", format: "Workshop", speakers: [] },
    },
    {
      kind: "break",
      startAt: "2026-09-19T09:00:00.000Z",
      endAt: "2026-09-19T09:15:00.000Z",
      title: "Coffee break",
    },
    {
      kind: "break",
      startAt: "2026-09-19T08:00:00.000Z",
      endAt: "2026-09-19T08:35:00.000Z",
      title: "Track break",
      track: { key: "workshops", name: "Workshops", locationLabel: "Workshop room" },
    },
    {
      kind: "meal",
      startAt: "2026-09-19T10:00:00.000Z",
      endAt: "2026-09-19T11:00:00.000Z",
      title: "Lunch",
    },
    {
      kind: "networking",
      startAt: "2026-09-19T11:00:00.000Z",
      endAt: "2026-09-19T11:30:00.000Z",
      title: "Hallway conversations",
    },
    {
      kind: "other",
      startAt: "2026-09-19T12:00:00.000Z",
      endAt: "2026-09-19T12:15:00.000Z",
      title: "Community update",
    },
    {
      kind: "closing",
      startAt: "2026-09-19T15:00:00.000Z",
      endAt: "2026-09-19T15:30:00.000Z",
      title: "Closing",
    },
    {
      kind: "session",
      startAt: "2026-09-19T13:00:00.000Z",
      endAt: "2026-09-19T14:00:00.000Z",
      locationLabel: "Studio",
      track: { key: "architecture", name: "Architecture", locationLabel: "Studio" },
      session: { slug: "late-architecture", title: "Late Architecture", format: "Talk", speakers: [] },
    },
    {
      kind: "session",
      startAt: "2026-09-19T07:15:00.000Z",
      endAt: "2026-09-19T07:45:00.000Z",
      locationLabel: "Main stage",
      session: { slug: "opening-overlap", title: "Opening Overlap", format: "Talk", speakers: [] },
    },
  );
  data.sessions.push(
    {
      slug: "reliable-runtime",
      title: "Reliable Runtime",
      abstract: "Runtime design without surprises.",
      format: "Talk",
      speakers: [{
        slug: "grace-example",
        displayName: "Grace Example",
        affiliation: "Runtime Guild",
        sessionCount: 1,
      } as never],
      relatedSessions: [],
      popularity: 100,
      review_score: 5,
    } as never,
    {
      slug: "platform-depth",
      title: "Platform Depth",
      abstract: "Detailed platform architecture.",
      format: "Workshop",
      speakers: [{
        slug: "lin-example",
        displayName: "Lin Example",
        affiliation: "Platform Group",
        sessionCount: 1,
      } as never],
      relatedSessions: [],
      popularity: 1,
      review_score: 1,
    } as never,
    {
      slug: "published-unscheduled",
      title: "Published but Unscheduled",
      abstract: "A Published Session without a Published Agenda Slot.",
      speakers: [],
      relatedSessions: [],
    },
    {
      slug: "late-architecture",
      title: "Late Architecture",
      abstract: "Architecture at the end of the day.",
      format: "Talk",
      speakers: [],
      relatedSessions: [],
    },
    {
      slug: "opening-overlap",
      title: "Opening Overlap",
      abstract: "A malformed Published placement overlapping fixed context.",
      format: "Talk",
      speakers: [],
      relatedSessions: [],
    },
  );
  return data;
}

function overnightPlannablePublishedData(): ConferenceGuidePublishedData {
  const data = publishedData();
  data.agenda.days[0].programmes[0].slots.push(
    {
      kind: "session",
      startAt: "2026-09-19T21:00:00.000Z",
      endAt: "2026-09-19T23:30:00.000Z",
      track: { key: "systems", name: "Systems", locationLabel: "Hall A" },
      session: { slug: "overnight-primary", title: "Overnight Primary", format: "Talk", speakers: [] },
    },
    {
      kind: "session",
      startAt: "2026-09-19T21:30:00.000Z",
      endAt: "2026-09-19T22:30:00.000Z",
      track: { key: "platforms", name: "Platforms", locationLabel: "Hall B" },
      session: { slug: "overnight-overlap", title: "Overnight Overlap", format: "Talk", speakers: [] },
    },
  );
  data.agenda.days.push({
    key: "conference-day-two",
    localDate: "2026-09-20",
    title: "Conference day two",
    programmes: [{
      event: mainAgendaEvent,
      tracks: [],
      slots: [{
        kind: "session",
        startAt: "2026-09-19T22:30:00.000Z",
        endAt: "2026-09-19T23:00:00.000Z",
        track: { key: "community", name: "Community", locationLabel: "Hall C" },
        session: { slug: "next-day-overlap", title: "Next Day Overlap", format: "Talk", speakers: [] },
      }],
    }],
  });
  data.sessions.push(
    {
      slug: "overnight-primary",
      title: "Overnight Primary",
      abstract: "A Session crossing midnight.",
      format: "Talk",
      speakers: [],
      relatedSessions: [],
    },
    {
      slug: "overnight-overlap",
      title: "Overnight Overlap",
      abstract: "An overlapping Session on the first Conference Day.",
      format: "Talk",
      speakers: [],
      relatedSessions: [],
    },
    {
      slug: "next-day-overlap",
      title: "Next Day Overlap",
      abstract: "An overlapping Session assigned to the following Conference Day.",
      format: "Talk",
      speakers: [],
      relatedSessions: [],
    },
  );
  return data;
}

describe("Conference Guide", () => {
  it("plans ranked Published Sessions without overlap and returns unscored fixed context", async () => {
    const guide = createConferenceGuide({
      content: conferenceGuideContent,
      loadPublishedData: async () => plannablePublishedData(),
      canonicalOrigin: "https://wts.sh",
      now: () => new Date("2026-07-14T18:00:00.000Z"),
    });

    const proposal = await guide.planProposedSchedule({
      ranked_session_slugs: [
        "platform-depth",
        "safe-systems",
        "reliable-runtime",
        "late-architecture",
      ],
    });

    expect(proposal).toMatchObject({
      metadata: {
        schema_version: "2",
        content_version: "2026-07-23",
        programme_version: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        generated_at: "2026-07-14T18:00:00.000Z",
        time_zone: "Europe/Skopje",
        canonical_url: "https://wts.sh/agenda",
      },
      outcome: "planned_with_issues",
      version_check: { status: "not_provided" },
      policy: {
        method: "caller_priorities_and_schedule_fit_v1",
        equal_priority_tie_break: "published_agenda_order",
      },
      ephemeral: {
        saved: false,
        reserves_attendance: false,
      },
      selected_sessions: [
        {
          slug: "platform-depth",
          priority: { kind: "ranked", rank: 1 },
          canonical_url: "https://wts.sh/sessions/platform-depth",
          speaker_count: 1,
          speakers_truncated: false,
          speakers: [{
            slug: "lin-example",
            canonical_url: "https://wts.sh/speakers/lin-example",
          }],
        },
        {
          slug: "late-architecture",
          priority: { kind: "ranked", rank: 4 },
          canonical_url: "https://wts.sh/sessions/late-architecture",
        },
      ],
    });
    expect(proposal.selected_sessions.map((session) => session.slug)).toEqual([
      "platform-depth",
      "late-architecture",
    ]);
    expect(proposal.selected_sessions[0].end_time <= proposal.selected_sessions[1].start_time).toBe(true);
    expect(proposal.fixed_context.map((slot) => slot.kind)).toEqual([
      "opening",
      "break",
      "meal",
      "networking",
      "other",
      "closing",
    ]);
    for (const slot of proposal.fixed_context) {
      expect(slot).not.toHaveProperty("priority");
      expect(slot).not.toHaveProperty("score");
    }
    expect(proposal.ranked_alternatives.map((alternative) => alternative.slug)).toEqual([
      "safe-systems",
      "reliable-runtime",
    ]);
    const serialized = JSON.stringify(proposal);
    for (const forbidden of [
      '"popularity":100',
      '"review_score":5',
      "private-session-id",
      "private-submission-id",
      "Private Key Takeaways",
      "Private review summary",
      '"published":',
      '"origin":"cfp"',
      "<script>",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("discloses stale and unresolved inputs without retaining Proposed Schedule state", async () => {
    const guide = createConferenceGuide({
      content: conferenceGuideContent,
      loadPublishedData: async () => plannablePublishedData(),
      canonicalOrigin: "https://wts.sh",
      now: () => new Date("2026-07-14T18:00:00.000Z"),
    });
    const input = {
      ranked_session_slugs: ["late-architecture", "platform-depth"],
      must_attend_slugs: [
        "reliable-runtime",
        "safe-systems",
        "published-unscheduled",
        "not-published-or-missing",
      ],
      excluded_session_slugs: ["platform-depth", "excluded-only"],
      availability_windows: [{
        local_date: "2026-09-19",
        start_time: "10:00",
        end_time: "11:00",
      }],
      prior_programme_version: `sha256:${"0".repeat(64)}`,
    };

    const proposal = await guide.planProposedSchedule(input);
    await guide.planProposedSchedule({ ranked_session_slugs: ["platform-depth"] });
    const repeated = await guide.planProposedSchedule(input);

    expect(repeated).toEqual(proposal);
    expect(proposal).toMatchObject({
      outcome: "planned_with_issues",
      version_check: {
        status: "changed",
        prior_programme_version: `sha256:${"0".repeat(64)}`,
        current_programme_version: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
      selected_sessions: [{
        slug: "safe-systems",
        priority: { kind: "must_attend" },
      }],
      unresolved_hard_constraints: expect.arrayContaining([
        expect.objectContaining({
          slug: "reliable-runtime",
          reason: "conflicts_with_selected",
          conflicting_session_slugs: ["safe-systems"],
        }),
        expect.objectContaining({ slug: "published-unscheduled", reason: "unscheduled" }),
        expect.objectContaining({
          slug: "not-published-or-missing",
          reason: "not_published_or_missing",
        }),
      ]),
      ranked_alternatives: [expect.objectContaining({
        slug: "reliable-runtime",
        relationship: "equal_priority",
        contested_with: ["safe-systems"],
      })],
      input_outcomes: expect.arrayContaining([
        expect.objectContaining({ slug: "safe-systems", outcome: "selected" }),
        expect.objectContaining({ slug: "reliable-runtime", outcome: "not_selected_conflict" }),
        expect.objectContaining({ slug: "published-unscheduled", outcome: "unscheduled" }),
        expect.objectContaining({
          slug: "not-published-or-missing",
          outcome: "not_published_or_missing",
        }),
        expect.objectContaining({ slug: "late-architecture", outcome: "unavailable" }),
        expect.objectContaining({ slug: "platform-depth", outcome: "conflicting_input" }),
        expect.objectContaining({ slug: "excluded-only", outcome: "excluded" }),
      ]),
    });
    expect(proposal.policy.equal_priority_tie_break).toBe("published_agenda_order");
    expect(proposal.ranked_alternatives[0].priority).toEqual({ kind: "must_attend" });
  });

  it("reports mutually conflicting inputs and Sessions blocked by fixed Programme-wide context", async () => {
    const guide = createConferenceGuide({
      content: conferenceGuideContent,
      loadPublishedData: async () => plannablePublishedData(),
      canonicalOrigin: "https://wts.sh",
      now: () => new Date("2026-07-14T18:00:00.000Z"),
    });

    const proposal = await guide.planProposedSchedule({
      must_attend_slugs: ["platform-depth", "opening-overlap"],
      excluded_session_slugs: ["platform-depth"],
    });

    expect(proposal).toMatchObject({
      outcome: "no_sessions_selected",
      selected_sessions: [],
      input_outcomes: expect.arrayContaining([
        expect.objectContaining({ slug: "platform-depth", outcome: "conflicting_input" }),
        expect.objectContaining({ slug: "opening-overlap", outcome: "not_selected_conflict" }),
      ]),
      unresolved_hard_constraints: expect.arrayContaining([
        expect.objectContaining({ slug: "platform-depth", reason: "conflicting_input" }),
        expect.objectContaining({
          slug: "opening-overlap",
          reason: "conflicts_with_fixed_context",
          fixed_context: [expect.objectContaining({ kind: "opening", title: "Opening" })],
        }),
      ]),
      conflicts: [expect.objectContaining({
        slug: "opening-overlap",
        reason: "overlaps_fixed_context",
        fixed_context: [expect.objectContaining({ kind: "opening", title: "Opening" })],
      })],
    });
  });

  it("does not apply one Event Programme's fixed Slots to another Event Programme", async () => {
    const data = publishedData();
    data.agenda.days[0].programmes.push({
      event: { name: "Community Warmup", compactLabel: "Warmup" },
      tracks: [],
      slots: [{
        kind: "session",
        startAt: "2026-09-19T07:15:00.000Z",
        endAt: "2026-09-19T07:45:00.000Z",
        session: { slug: "warmup-session", title: "Warmup Session", format: "Talk", speakers: [] },
      }],
    });
    data.sessions.push({
      slug: "warmup-session",
      title: "Warmup Session",
      abstract: "Runs alongside the main Event opening.",
      format: "Talk",
      speakers: [],
      relatedSessions: [],
    });
    const guide = createConferenceGuide({
      content: conferenceGuideContent,
      loadPublishedData: async () => data,
      canonicalOrigin: "https://wts.sh",
    });

    const proposal = await guide.planProposedSchedule({ must_attend_slugs: ["warmup-session"] });

    expect(proposal.selected_sessions).toEqual([
      expect.objectContaining({
        slug: "warmup-session",
        appearance_event: expect.objectContaining({ name: "Community Warmup" }),
      }),
    ]);
    expect(proposal.fixed_context).toEqual([]);
  });

  it("handles overnight intervals across Conference Days and excludes tracked Slots from fixed context", async () => {
    const guide = createConferenceGuide({
      content: conferenceGuideContent,
      loadPublishedData: async () => overnightPlannablePublishedData(),
      canonicalOrigin: "https://wts.sh",
      now: () => new Date("2026-07-14T18:00:00.000Z"),
    });

    const proposal = await guide.planProposedSchedule({
      ranked_session_slugs: ["overnight-primary", "overnight-overlap", "next-day-overlap"],
    });

    expect(proposal.selected_sessions).toEqual([
      expect.objectContaining({
        slug: "overnight-primary",
        local_date: "2026-09-19",
        start_time: "23:00",
        end_time: "01:30",
        end_local_date: "2026-09-20",
      }),
    ]);
    expect(proposal.conflicts).toEqual([
      expect.objectContaining({ slug: "overnight-overlap", reason: "overlaps_selected_session" }),
      expect.objectContaining({ slug: "next-day-overlap", reason: "overlaps_selected_session" }),
    ]);

    const available = await guide.planProposedSchedule({
      must_attend_slugs: ["overnight-primary"],
      availability_windows: [{
        local_date: "2026-09-19",
        start_time: "22:00",
        end_time: "02:00",
      }],
    });
    expect(available.selected_sessions).toEqual([
      expect.objectContaining({ slug: "overnight-primary" }),
    ]);

    const unavailable = await guide.planProposedSchedule({
      must_attend_slugs: ["overnight-primary"],
      availability_windows: [{
        local_date: "2026-09-19",
        start_time: "22:00",
        end_time: "23:59",
      }],
    });
    expect(unavailable).toMatchObject({
      selected_sessions: [],
      unresolved_hard_constraints: [{ slug: "overnight-primary", reason: "unavailable" }],
    });

    const trackedData = plannablePublishedData();
    const trackedGuide = createConferenceGuide({
      content: conferenceGuideContent,
      loadPublishedData: async () => trackedData,
      canonicalOrigin: "https://wts.sh",
    });
    const trackedProposal = await trackedGuide.planProposedSchedule({
      ranked_session_slugs: ["reliable-runtime"],
    });
    expect(trackedProposal.selected_sessions).toEqual([
      expect.objectContaining({ slug: "reliable-runtime" }),
    ]);
    expect(trackedProposal.fixed_context.map((slot) => slot.title)).not.toContain("Track break");
  });

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
        schema_version: "2",
        content_version: "2026-07-23",
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

  it.each([true, false])("publishes the full event venue map even when programme availability is %s", async (available) => {
    const guide = createConferenceGuide({ loadPublishedData: async () => {
      if (!available) throw new Error("Temporarily unavailable");
      return publishedData();
    } });
    const index = await guide.getIndex();
    expect(index.logistics.pre_conference_venue.applies_to_events).toEqual(["InfoSec Monday", "Workshop Thursday"]);
    expect(index.logistics.pre_conference_events).toEqual([
      { name: "InfoSec Monday", local_date: "2026-09-14", location: "Base42 Hackerspace, Rimska 25, 1000 Skopje" },
      { name: "Workshop Tuesday: iOS + AI", local_date: "2026-09-15", location: "Netaville, Skopje" },
      { name: "DevFest", local_date: "2026-09-16", location: "Small FINKI amphitheater, Technical Campus, Skopje" },
      { name: "MAUI Day", local_date: "2026-09-17", location: "INNOFeit, Technical Campus, Skopje" },
      { name: "Workshop Thursday", local_date: "2026-09-17", location: "Base42 Hackerspace, Rimska 25, 1000 Skopje" },
      { name: "Angular Day", local_date: "2026-09-18", location: "Small FINKI amphitheater, Technical Campus, Skopje" },
    ]);
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
        schema_version: "2",
        content_version: "2026-07-23",
        programme_version: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        generated_at: "2026-07-14T18:00:00.000Z",
        time_zone: "Europe/Skopje",
        canonical_url: "https://wts.sh/mcp",
      },
      programme_status: "available",
      logistics: {
        event: { date: { status: "announced", local_date: "2026-09-19" } },
        main_venue: {
          status: "announced",
          name: "Technical Campus",
          spaces: { outdoor_stages: 3, indoor_stages: 2 },
        },
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
      programmes: [{
        appearance_event: { name: "WhatTheStack 2026", compact_label: "WTS 2026" },
        slots: [
          { kind: "opening", start_time: "09:00", end_time: "09:30", end_local_date: "2026-09-19", title: "Opening" },
          {
            kind: "session",
            start_time: "10:00",
            end_time: "10:35",
            end_local_date: "2026-09-19",
            track: { key: "systems", name: "Systems" },
            session: { slug: "safe-systems", resource_uri: "wts://conference-guide/sessions/safe-systems" },
          },
        ],
      }],
    });
    expect(session).toMatchObject({
      slug: "safe-systems",
      title: "Safe Systems",
      abstract: "Build & ship.\nSafely",
      canonical_url: "https://wts.sh/sessions/safe-systems",
      schedule: {
        status: "scheduled",
        day_key: "conference-day",
        appearance_event: { name: "WhatTheStack 2026" },
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
      logistics: {
        main_venue: { status: "announced", name: "Technical Campus" },
      },
    });
    await expect(guide.getAgenda()).rejects.toBeInstanceOf(ProgrammeUnavailableError);
    await expect(guide.getSession("safe-systems")).rejects.toBeInstanceOf(ProgrammeUnavailableError);
    await expect(guide.getSpeaker("ada-example")).rejects.toBeInstanceOf(ProgrammeUnavailableError);
    await expect(guide.getPartners()).rejects.toBeInstanceOf(ProgrammeUnavailableError);
    await expect(guide.planProposedSchedule({ ranked_session_slugs: ["safe-systems"] }))
      .rejects.toBeInstanceOf(ProgrammeUnavailableError);
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
