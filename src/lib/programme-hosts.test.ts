import { describe, expect, it } from "vite-plus/test";
import { buildPublicAgenda, publicAgendaSession } from "~/lib/programme-public";
import { sessionHostIds, sharedSlotHosts, slotDjRecords, withoutHostCredit } from "~/lib/programme-hosts";
import type { AgendaSlotRecord, AppearanceEventRecord, ConferenceDayRecord, EventProgrammeRecord, SessionRecord, SpeakerRecord } from "~/lib/pocketbase-types";
import assignments from "../../scripts/hosts-2026.manifest.json";
import djProfile from "../../scripts/dj-2026.manifest.json";

const speakers = assignments.profiles.map(({ record }) => ({ ...record, is_mc: false, published: true, photo: `${record.slug}.jpg` }) as SpeakerRecord);
const darko = speakers[0];
const guest = { ...darko, id: "guest", slug: "guest", display_name: "Guest", is_mc: true };
const byId = new Map([...speakers, guest].map((speaker) => [speaker.id, speaker]));

describe("explicit programme hosts", () => {
  it("lists the DJ on the existing after-party without changing its time, location or kind", () => {
    const dj = { ...djProfile.record, published: true, photo: "dina.jpg" } as SpeakerRecord;
    const slot = { id: "4ww9bfa5kmeeu14", programme: "programme", kind: "other", session: "", track: "", published: true,
      start_at: "2026-09-19T15:00:00Z", end_at: "2026-09-19T16:00:00Z", title: "DJ After Party", location_label: "Stage 1",
      summary: "Closing out the conference, the right way!" } as AgendaSlotRecord;
    const agenda = buildPublicAgenda(
      [{ id: "day", key: "main-day", local_date: "2026-09-19", published: true }] as ConferenceDayRecord[],
      [{ id: assignments.event_id, name: "Conference", published: true }] as AppearanceEventRecord[],
      [{ id: "programme", day: "day", appearance_event: assignments.event_id }] as EventProgrammeRecord[], [], [slot], [], [dj],
    );
    const result = agenda.days[0].programmes[0].slots[0];
    expect(result).toMatchObject({ kind: "other", title: slot.title, summary: slot.summary, startAt: slot.start_at, endAt: slot.end_at, locationLabel: "Stage 1",
      speakers: [{ slug: "dina-damjanovikj", name: "DinaShantina", photoUrl: expect.stringContaining("dina.jpg") }] });
    expect(result.session).toBeUndefined();
    expect(JSON.stringify(result)).not.toMatch(/cfp_applicant|social_handles|\"user\"/);
  });

  it("requires the exact after-party identity and a published affiliated DJ", () => {
    const dj = { ...djProfile.record, published: true } as SpeakerRecord;
    const slot = { id: "4ww9bfa5kmeeu14", kind: "other", session: "" } as const;
    const map = new Map([[dj.id, dj]]);
    expect(slotDjRecords(slot, assignments.event_id, map)).toEqual([dj]);
    expect(slotDjRecords({ ...slot, id: "different-party" }, assignments.event_id, map)).toEqual([]);
    expect(slotDjRecords({ ...slot, kind: "opening" }, assignments.event_id, map)).toEqual([]);
    expect(slotDjRecords({ ...slot, session: "different-session" }, assignments.event_id, map)).toEqual([]);
    expect(slotDjRecords(slot, "different-event", map)).toEqual([]);
    for (const change of [{ published: false }, { is_dj: false }, { appearance_events: [] }]) {
      expect(slotDjRecords(slot, assignments.event_id, new Map([[dj.id, { ...dj, ...change }]]))).toEqual([]);
    }
    expect(slotDjRecords(slot, assignments.event_id, new Map())).toEqual([]);
  });

  it("projects all six approved hosts with photos, preserving participants and not treating other MCs as hosts", () => {
    for (const [id, hostId] of Object.entries(assignments.hosts)) {
      const session = { id, slug: id, title: "Fireside", speakers: [guest.id, hostId] } as SessionRecord;
      const result = publicAgendaSession(session, byId);
      expect(result.hosts).toEqual([expect.objectContaining({ slug: byId.get(hostId)!.slug, photoUrl: expect.stringContaining('.jpg') })]);
      expect(result.speakers).toHaveLength(2);
      expect(sessionHostIds({ ...session, speakers: [guest.id] })).toEqual([]);
    }
    expect(publicAgendaSession({ id: "ordinary", speakers: [darko.id] } as SessionRecord, byId).hosts).toBeUndefined();
  });

  it("never projects unpublished or unlinked hosts", () => {
    const session = { id: "fs26f7995331c81", speakers: [darko.id, guest.id] } as SessionRecord;
    const hidden = new Map(byId).set(darko.id, { ...darko, published: false });
    expect(publicAgendaSession(session, hidden).hosts).toBeUndefined();
    expect(publicAgendaSession({ ...session, speakers: [guest.id] }, byId).hosts).toBeUndefined();
    expect(sharedSlotHosts({ kind: "opening", track: "" }, assignments.event_id, hidden)).toEqual([]);
    expect(sharedSlotHosts({ kind: "closing", track: "" }, "other-event", byId)).toEqual([]);
    expect(sharedSlotHosts({ kind: "break", track: "" }, assignments.event_id, byId)).toEqual([]);
    expect(sharedSlotHosts({ kind: "opening", track: "side" }, assignments.event_id, byId)).toEqual([]);
    expect(sharedSlotHosts({ kind: "opening", track: "" }, assignments.event_id, new Map(byId).set(darko.id, { ...darko, appearance_events: [] }))).toEqual([]);
  });

  it("gives opening and closing a public photo/name without duplicate text or a fake Session", () => {
    const slots = ["opening", "closing"].map((kind) => ({ id: kind, programme: "programme", kind, track: "", published: true,
      start_at: "2026-09-19T08:00:00Z", end_at: "2026-09-19T08:10:00Z", title: kind,
      summary: `${kind}. Hosted by Darko Bozhinovski.` }) as AgendaSlotRecord);
    const result = buildPublicAgenda(
      [{ id: "day", key: "main-day", local_date: "2026-09-19", published: true }] as ConferenceDayRecord[],
      [{ id: assignments.event_id, name: "Conference", published: true }] as AppearanceEventRecord[],
      [{ id: "programme", day: "day", appearance_event: assignments.event_id }] as EventProgrammeRecord[], [], slots, [], speakers,
    );
    for (const slot of result.days[0].programmes[0].slots) {
      expect(slot.speakers).toEqual([{ slug: darko.slug, name: darko.display_name, photoUrl: expect.stringContaining(darko.photo!) }]);
      expect(slot.summary).toBe(`${slot.kind}.`);
      expect(slot.session).toBeUndefined();
    }
    expect(JSON.stringify(result)).not.toMatch(/cfp_applicant|social_handles|photo_sha256|\"user\"/);
  });

  it("only removes the exact legacy credit replaced by visible hosts", () => {
    const name = assignments.profiles[0].record.display_name;
    expect(withoutHostCredit("Intro. Hosted by Darko Bozhinovski.", [name])).toBe("Intro.");
    expect(withoutHostCredit("<p>Intro</p><p>Hosted by Darko Bozhinovski.</p>", [name], true)).toBe("<p>Intro</p>");
    expect(withoutHostCredit("Intro. Hosted by Other.", [name])).toBe("Intro. Hosted by Other.");
    expect(withoutHostCredit("Intro. Hosted by Darko Bozhinovski.", [])).toBe("Intro. Hosted by Darko Bozhinovski.");
  });
});
