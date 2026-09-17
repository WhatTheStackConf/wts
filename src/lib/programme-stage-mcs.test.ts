import { describe, expect, it } from "vite-plus/test";
import { buildPublicAgenda } from "~/lib/programme-public";
import { stageMcRecords } from "~/lib/programme-stage-mcs";
import type { AgendaSlotRecord, AgendaTrackRecord, AppearanceEventRecord, ConferenceDayRecord, EventProgrammeRecord, SpeakerRecord } from "~/lib/pocketbase-types";

const assignments = [
  ["stage-2", "Stage 1", "tony-edwards"],
  ["stage-3", "Stage 2", "stojan-ezhov"],
  ["stage-1", "Stage 3", "dimitar-grozdanov"],
  ["stage-4", "Stage 4", "nikola-dinevski"],
  ["stage-5", "Stage 5", "marijana-ilovska-zlatanovska"],
];
const event = "wts2026appevent";
const speakers = assignments.map(([, , slug]) => ({ id: slug, slug, display_name: slug, published: true, is_mc: true,
  appearance_events: [event], photo: `${slug}.jpg`, user: "private-user", bio: "Private test sentinel" }) as SpeakerRecord);
const byId = new Map(speakers.map(s => [s.id, s]));

describe("per-stage MC assignments", () => {
  it("uses immutable keys, not stage digits, and follows the approved five-person roster", () => {
    for (const [key, , slug] of assignments) expect(stageMcRecords(event, key, byId).map(s => s.slug)).toEqual([slug]);
    expect(stageMcRecords(event, "Stage 1", byId)).toEqual([]);
    expect(stageMcRecords(event, "unknown", byId)).toEqual([]);
    expect(stageMcRecords("weekday", "stage-2", byId)).toEqual([]);
  });

  it("requires a published MC with explicit membership and supports a missing photo", () => {
    const tony = speakers[0];
    for (const change of [{ published: false }, { is_mc: false }, { appearance_events: [] }]) {
      expect(stageMcRecords(event, "stage-2", new Map([[tony.id, { ...tony, ...change }]]))).toEqual([]);
    }
    expect(stageMcRecords(event, "stage-2", new Map())).toEqual([]);
    expect(stageMcRecords(event, "stage-2", new Map([[tony.id, { ...tony, photo: "" }]]))).toHaveLength(1);
  });

  it("does not infer stage MCs from fireside participation or global MC flags", () => {
    for (const slug of ["darko-bozhinovski", "miodrag-cekikj", "other-mc"]) {
      const map = new Map([[slug, { ...speakers[0], id: slug, slug }]]);
      for (const [key] of assignments) expect(stageMcRecords(event, key, map)).toEqual([]);
    }
  });

  it("projects photos and public names on stage headers without leaking private records or altering slots", () => {
    const days = [{ id: "day", key: "main-day", local_date: "2026-09-19", title: "Conference", published: true }] as ConferenceDayRecord[];
    const events = [{ id: event, name: "WTS", published: true }] as AppearanceEventRecord[];
    const programmes = [{ id: "programme", day: "day", appearance_event: event }] as EventProgrammeRecord[];
    const tracks = assignments.map(([key, name], i) => ({ id: key, key, name, programme: "programme", display_order: i })) as AgendaTrackRecord[];
    const slots = [{ id: "opening", programme: "programme", kind: "opening", published: true, title: "Opening", summary: "Opening", start_at: "2026-09-19T08:00:00Z", end_at: "2026-09-19T08:10:00Z" }] as AgendaSlotRecord[];
    const result = buildPublicAgenda(days, events, programmes, tracks, slots, [], speakers).days[0].programmes[0];
    expect(result.tracks.map(t => [t.name, t.mcs?.[0].slug])).toEqual(assignments.map(([, name, slug]) => [name, slug]));
    expect(result.tracks.every(t => t.mcs?.[0].photoUrl?.includes('.jpg'))).toBe(true);
    expect(JSON.stringify(result.tracks)).not.toMatch(/private-user|Private test sentinel|\"user\"|\"bio\"/);
    expect(result.slots).toEqual(buildPublicAgenda(days, events, programmes, tracks, slots, [], []).days[0].programmes[0].slots);
  });
});
