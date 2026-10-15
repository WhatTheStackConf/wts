import assignments from "../../scripts/hosts-2026.manifest.json";
import type { AgendaSlotRecord, SessionRecord, SpeakerRecord } from "~/lib/pocketbase-types";

// The approved publication manifest is also the edition's explicit role source.
// MC status is intentionally not used: an MC can be a guest in another session.
export function sessionHostIds(session: Pick<SessionRecord, "id" | "speakers">): string[] {
  const host = (assignments.hosts as Record<string, string>)[session.id];
  return host && session.speakers?.includes(host) ? [host] : [];
}

export function sharedSlotHosts(
  slot: Pick<AgendaSlotRecord, "kind" | "track">,
  eventId: string,
  speakers: ReadonlyMap<string, SpeakerRecord>,
): SpeakerRecord[] {
  if (eventId !== assignments.event_id || slot.track || !["opening", "closing"].includes(slot.kind)) return [];
  const host = speakers.get(assignments.shared_host);
  return host?.published && host.appearance_events?.includes(eventId) ? [host] : [];
}

/** Remove only the legacy credit we replace with a visible profile block. */
export function withoutHostCredit(text: string, names: string[], html = false): string {
  return names.reduce((value, name) => {
    const suffix = html ? `<p>Hosted by ${name}.</p>` : ` Hosted by ${name}.`;
    return value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
  }, text);
}
