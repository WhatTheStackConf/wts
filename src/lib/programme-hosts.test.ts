import { describe, expect, it } from "vite-plus/test";
import { buildPublicAgenda, publicAgendaSession } from "~/lib/programme-public";
import { sessionHostIds, sharedSlotHosts, withoutHostCredit } from "~/lib/programme-hosts";
import type { AgendaSlotRecord, AppearanceEventRecord, ConferenceDayRecord, EventProgrammeRecord, SessionRecord, SpeakerRecord } from "~/lib/pocketbase-types";
import assignments from "../../scripts/hosts-2026.manifest.json";

const speakers = assignments.profiles.map(({ record }) => ({ ...record, published: true, photo: `${record.slug}.jpg` }) as SpeakerRecord);
const darko = speakers[0];
const guest = { ...darko, id: "guest", slug: "guest", display_name: "Guest", is_mc: true };
const byId = new Map([...speakers, guest].map((speaker) => [speaker.id, speaker]));

describe("explicit programme hosts", () => {
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
