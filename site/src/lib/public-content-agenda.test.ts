import { describe, expect, it } from "vite-plus/test";
import type { PublicationGraph } from "~/lib/publication-schema";
import { emptyPublicationGraph } from "~/lib/publication-schema";
import { mapPublicConference } from "~/server/public-content";

const graph: PublicationGraph = {
  ...emptyPublicationGraph(),
  speakers: [
    { id: "ada", slug: "ada", displayName: "Ada", affiliation: "", bio: "", isMc: false, socialHandles: [], photoAssetId: null },
    { id: "zed", slug: "zed", displayName: "", affiliation: "", bio: "", isMc: true, socialHandles: [], photoAssetId: null },
  ],
  sessions: [
    { id: "talk", slug: "talk", title: "Talk", abstract: "", speakerIds: ["ada", "zed"], hostIds: ["zed"] },
    { id: "solo", slug: "solo", title: "Solo", abstract: "", format: "", speakerIds: ["ada"], hostIds: [] },
  ],
  appearanceEvents: [{ id: "main", name: "Main", compactLabel: "", destinationUrl: "https://example.test/", displayOrder: 0 }],
  days: [{ id: "day", key: "day-one", localDate: "2027-09-18", title: "Day", displayOrder: 0 }],
  programmes: [
    { id: "programme", dayId: "day", eventId: "main", displayOrder: 0 },
    { id: "other", dayId: "day", eventId: "main", displayOrder: 1 },
    { id: "unknown-event", dayId: "day", eventId: "missing", displayOrder: 2 },
  ],
  tracks: [
    { id: "late", programmeId: "programme", key: "late", name: "Late", locationLabel: "Annex", displayOrder: 2 },
    { id: "early", programmeId: "programme", key: "early", name: "Early", displayOrder: 1 },
    { id: "foreign", programmeId: "other", key: "foreign", name: "Foreign", displayOrder: 0 },
  ],
  slots: [
    { id: "late-talk", programmeId: "programme", trackId: "late", kind: "session", sessionId: "talk", startAt: "2027-09-18T09:00:00Z", endAt: "2027-09-18T09:30:00Z", displayOrder: 0 },
    { id: "early-solo", programmeId: "programme", trackId: "early", kind: "session", sessionId: "solo", startAt: "2027-09-18T09:00:00Z", endAt: "2027-09-18T09:30:00Z", displayOrder: 5, locationLabel: "Room 1" },
    { id: "plenary", programmeId: "programme", kind: "opening", title: "", summary: "Welcome. Hosted by zed.", hostIds: ["zed"], startAt: "2027-09-18T09:00:00Z", endAt: "2027-09-18T09:10:00Z", displayOrder: 9 },
    { id: "repeat-talk", programmeId: "programme", trackId: "early", kind: "session", sessionId: "talk", startAt: "2027-09-18T10:00:00Z", endAt: "2027-09-18T10:30:00Z", displayOrder: 1 },
    { id: "early-tie-b", programmeId: "programme", trackId: "early", kind: "break", title: "Coffee", hostIds: [], startAt: "2027-09-18T11:00:00Z", endAt: "2027-09-18T11:15:00Z", displayOrder: 4 },
    { id: "early-tie-a", programmeId: "programme", trackId: "early", kind: "meal", summary: "Lunch", hostIds: ["ada"], startAt: "2027-09-18T11:00:00Z", endAt: "2027-09-18T11:15:00Z", displayOrder: 3 },
    { id: "cross-track", programmeId: "programme", trackId: "foreign", kind: "break", hostIds: [], startAt: "2027-09-18T12:00:00Z", endAt: "2027-09-18T12:15:00Z", displayOrder: 0 },
    { id: "missing-session", programmeId: "programme", kind: "session", sessionId: "missing", startAt: "2027-09-18T12:30:00Z", endAt: "2027-09-18T13:00:00Z", displayOrder: 0 },
    { id: "unknown-track", programmeId: "programme", trackId: "nowhere", kind: "closing", summary: "Bye. Hosted by Ada.", hostIds: ["ada"], startAt: "2027-09-18T08:00:00Z", endAt: "2027-09-18T08:30:00Z", displayOrder: 0 },
    { id: "unknown-event-slot", programmeId: "unknown-event", kind: "other", hostIds: [], startAt: "2027-09-18T08:00:00Z", endAt: "2027-09-18T08:30:00Z", displayOrder: 0 },
  ],
};

describe("public agenda mapping", () => {
  it("orders slots by time, untracked first, track order, then slot order, and maps each slot kind", () => {
    const result = mapPublicConference(graph);
    expect(result.agenda).toMatchInlineSnapshot(`
      {
        "days": [
          {
            "key": "day-one",
            "localDate": "2027-09-18",
            "programmes": [
              {
                "event": {
                  "compactLabel": "Main",
                  "destinationUrl": "https://example.test/",
                  "name": "Main",
                },
                "slots": [
                  {
                    "endAt": "2027-09-18T08:30:00Z",
                    "kind": "closing",
                    "locationLabel": undefined,
                    "speakers": [
                      {
                        "name": "Ada",
                        "photoUrl": null,
                        "slug": "ada",
                      },
                    ],
                    "startAt": "2027-09-18T08:00:00Z",
                    "summary": "Bye.",
                    "title": undefined,
                    "track": undefined,
                  },
                  {
                    "endAt": "2027-09-18T09:10:00Z",
                    "kind": "opening",
                    "locationLabel": undefined,
                    "speakers": [
                      {
                        "name": "zed",
                        "photoUrl": null,
                        "slug": "zed",
                      },
                    ],
                    "startAt": "2027-09-18T09:00:00Z",
                    "summary": "Welcome.",
                    "title": undefined,
                    "track": undefined,
                  },
                  {
                    "endAt": "2027-09-18T09:30:00Z",
                    "kind": "session",
                    "locationLabel": "Room 1",
                    "session": {
                      "format": undefined,
                      "slug": "solo",
                      "speakers": [
                        {
                          "name": "Ada",
                          "photoUrl": null,
                          "slug": "ada",
                        },
                      ],
                      "title": "Solo",
                    },
                    "startAt": "2027-09-18T09:00:00Z",
                    "track": {
                      "key": "early",
                      "locationLabel": undefined,
                      "name": "Early",
                    },
                  },
                  {
                    "endAt": "2027-09-18T09:30:00Z",
                    "kind": "session",
                    "locationLabel": "Annex",
                    "session": {
                      "format": undefined,
                      "hosts": [
                        {
                          "name": "zed",
                          "photoUrl": null,
                          "slug": "zed",
                        },
                      ],
                      "slug": "talk",
                      "speakers": [
                        {
                          "name": "Ada",
                          "photoUrl": null,
                          "slug": "ada",
                        },
                        {
                          "name": "zed",
                          "photoUrl": null,
                          "slug": "zed",
                        },
                      ],
                      "title": "Talk",
                    },
                    "startAt": "2027-09-18T09:00:00Z",
                    "track": {
                      "key": "late",
                      "locationLabel": "Annex",
                      "name": "Late",
                    },
                  },
                  {
                    "endAt": "2027-09-18T10:30:00Z",
                    "kind": "session",
                    "locationLabel": undefined,
                    "session": {
                      "format": undefined,
                      "hosts": [
                        {
                          "name": "zed",
                          "photoUrl": null,
                          "slug": "zed",
                        },
                      ],
                      "slug": "talk",
                      "speakers": [
                        {
                          "name": "Ada",
                          "photoUrl": null,
                          "slug": "ada",
                        },
                        {
                          "name": "zed",
                          "photoUrl": null,
                          "slug": "zed",
                        },
                      ],
                      "title": "Talk",
                    },
                    "startAt": "2027-09-18T10:00:00Z",
                    "track": {
                      "key": "early",
                      "locationLabel": undefined,
                      "name": "Early",
                    },
                  },
                  {
                    "endAt": "2027-09-18T11:15:00Z",
                    "kind": "meal",
                    "locationLabel": undefined,
                    "speakers": [
                      {
                        "name": "Ada",
                        "photoUrl": null,
                        "slug": "ada",
                      },
                    ],
                    "startAt": "2027-09-18T11:00:00Z",
                    "summary": "Lunch",
                    "title": undefined,
                    "track": {
                      "key": "early",
                      "locationLabel": undefined,
                      "name": "Early",
                    },
                  },
                  {
                    "endAt": "2027-09-18T11:15:00Z",
                    "kind": "break",
                    "locationLabel": undefined,
                    "startAt": "2027-09-18T11:00:00Z",
                    "summary": undefined,
                    "title": "Coffee",
                    "track": {
                      "key": "early",
                      "locationLabel": undefined,
                      "name": "Early",
                    },
                  },
                ],
                "tracks": [
                  {
                    "key": "early",
                    "locationLabel": undefined,
                    "name": "Early",
                  },
                  {
                    "key": "late",
                    "locationLabel": "Annex",
                    "name": "Late",
                  },
                ],
              },
            ],
            "title": "Day",
          },
        ],
      }
    `);
    expect(result.sessions.map((session) => [session.slug, session.schedule])).toMatchInlineSnapshot(`
      [
        [
          "solo",
          {
            "dayDate": "2027-09-18",
            "dayTitle": "Day",
            "endAt": "2027-09-18T09:30:00Z",
            "event": {
              "compactLabel": "Main",
              "destinationUrl": "https://example.test/",
              "name": "Main",
            },
            "locationLabel": "Room 1",
            "startAt": "2027-09-18T09:00:00Z",
            "trackName": "Early",
          },
        ],
        [
          "talk",
          {
            "dayDate": "2027-09-18",
            "dayTitle": "Day",
            "endAt": "2027-09-18T09:30:00Z",
            "event": {
              "compactLabel": "Main",
              "destinationUrl": "https://example.test/",
              "name": "Main",
            },
            "locationLabel": "Annex",
            "startAt": "2027-09-18T09:00:00Z",
            "trackName": "Late",
          },
        ],
      ]
    `);
  });
});
