import { describe, expect, it } from "vite-plus/test";
import { emptyPublicationGraph, publicationGraphSchema, type PublicationGraph } from "~/lib/publication-schema";

const asset = "a".repeat(64);
const validGraph = (): PublicationGraph => ({
  ...emptyPublicationGraph(),
  speakers: [
    { id: "ada", slug: "ada", displayName: "Ada", affiliation: "", bio: "", isMc: false, socialHandles: [], photoAssetId: asset },
    { id: "zed", slug: "zed", displayName: "Zed", affiliation: "", bio: "", isMc: true, socialHandles: [], photoAssetId: null },
  ],
  sessions: [{ id: "talk", slug: "talk", title: "Talk", abstract: "", speakerIds: ["ada", "zed"], hostIds: ["zed"] }],
  appearanceEvents: [{ id: "main", name: "Main", compactLabel: "Main", displayOrder: 0 }],
  appearances: [{ speakerId: "ada", eventId: "main" }],
  days: [{ id: "day", key: "day-one", localDate: "2027-09-18", title: "Day", displayOrder: 0 }],
  programmes: [{ id: "programme", dayId: "day", eventId: "main", displayOrder: 0 }],
  tracks: [{ id: "track", programmeId: "programme", key: "main", name: "Main", displayOrder: 0 }],
  slots: [
    { id: "talk-slot", programmeId: "programme", trackId: "track", kind: "session", sessionId: "talk", startAt: "2027-09-18T08:00:00Z", endAt: "2027-09-18T08:30:00Z", displayOrder: 0 },
    { id: "break-slot", programmeId: "programme", kind: "break", hostIds: ["zed"], startAt: "2027-09-18T08:30:00Z", endAt: "2027-09-18T09:00:00Z", displayOrder: 1 },
  ],
});

function issues(graph: unknown): string[] {
  const result = publicationGraphSchema.safeParse(graph);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe("publication graph references", () => {
  it("accepts a consistent graph", () => {
    expect(issues(validGraph())).toEqual([]);
  });

  it("reports duplicate IDs, slugs, keys, and appearances in check order", () => {
    const graph = validGraph();
    graph.speakers.push({ ...graph.speakers[0]! });
    graph.sessions.push({ ...graph.sessions[0]! });
    graph.appearanceEvents.push({ ...graph.appearanceEvents[0]! });
    graph.days.push({ ...graph.days[0]! });
    graph.programmes.push({ ...graph.programmes[0]! });
    graph.tracks.push({ ...graph.tracks[0]! });
    graph.slots.push({ ...graph.slots[0]! });
    graph.appearances.push({ ...graph.appearances[0]! });
    expect(issues(graph)).toEqual([
      "Remove duplicate speaker IDs.",
      "Remove duplicate session IDs.",
      "Remove duplicate event IDs.",
      "Remove duplicate day IDs.",
      "Remove duplicate programme IDs.",
      "Remove duplicate track IDs.",
      "Remove duplicate slot IDs.",
      "Remove duplicate speaker slugs.",
      "Remove duplicate session slugs.",
      "Remove duplicate day keys.",
      "Remove duplicate track keys.",
      "Remove duplicate appearances.",
    ]);
  });

  it("reports every broken reference in graph order", () => {
    const graph = validGraph();
    graph.sessions[0] = { ...graph.sessions[0]!, speakerIds: ["ada", "ghost"], hostIds: ["zed"] };
    graph.appearances = [{ speakerId: "ghost", eventId: "main" }, { speakerId: "ada", eventId: "nowhere" }];
    graph.programmes.push({ id: "orphan", dayId: "missing-day", eventId: "main", displayOrder: 1 });
    graph.tracks.push({ id: "lost-track", programmeId: "missing-programme", key: "lost", name: "Lost", displayOrder: 1 });
    graph.slots = [
      { id: "talk-slot", programmeId: "missing-programme", trackId: "track", kind: "session", sessionId: "missing-session", startAt: "2027-09-18T09:00:00Z", endAt: "2027-09-18T09:00:00Z", displayOrder: 0 },
      { id: "break-slot", programmeId: "programme", trackId: "lost-track", kind: "break", hostIds: ["ghost"], startAt: "2027-09-18T08:30:00Z", endAt: "2027-09-18T09:00:00Z", displayOrder: 1 },
      { id: "fine-break", programmeId: "programme", kind: "break", hostIds: ["ada"], startAt: "2027-09-18T08:30:00Z", endAt: "2027-09-18T09:00:00Z", displayOrder: 1 },
    ];
    expect(issues(graph)).toEqual([
      "Reference an approved session speaker.",
      "Session hosts must be participants.",
      "Reference an approved appearance.",
      "Reference an approved appearance.",
      "Reference an approved programme day and event.",
      "Reference an approved track programme.",
      "Reference an approved slot programme.",
      "Use a track from the slot programme.",
      "End the slot after its start.",
      "Reference an approved slot session.",
      "Use a track from the slot programme.",
      "Reference an approved shared-slot host.",
    ]);
  });
});
