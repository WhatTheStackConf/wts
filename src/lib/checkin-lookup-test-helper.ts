import { CheckinAgentService } from "~/lib/checkin-agent-service";
import { CheckinLabelProfileService } from "~/lib/checkin-label-profile-service";
import { SYNTHETIC_LABEL_CONFIG } from "~/lib/checkin-label-render-contract";
import { Coordinator } from "../../runtime/checkin/coordinator";
import type { CheckinStationId } from "~/lib/checkin-contract";
import type { CheckinArrivalSource } from "~/lib/checkin-arrival-source";
import type { CheckinEventContext } from "~/lib/checkin-event-contract";
import { CheckinArrivalService } from "~/lib/checkin-arrival-service";
import { CheckinEventService, type CheckinEventSource } from "~/lib/checkin-event-service";
import { CheckinService } from "~/lib/checkin-service";
import { startCheckinPocketBase } from "~/lib/checkin-pocketbase-test-helper";

export const events: CheckinEventSource = {
  sourceKey: "a".repeat(64),
  discover: async () => ({ state: "complete", events: [{ id: "101", title: "Synthetic conference" }] }),
  options: async () => ({ state: "complete", lists: [{ id: "201", title: "Synthetic list" }], products: [{ id: "401", title: "Test ticket" }], questions: [{ id: "301", title: "Test affiliation", productIds: ["401"] }] }),
};
const qrIdentity = "A-ABC1234";
export async function setup() {
  const test = await startCheckinPocketBase();
  try {
    const admin = await test.user("admin");
    const operator = await test.user("checkin_operator");
    const control = new CheckinService(test.pb, admin.actor);
    const catalogue = new CheckinEventService(test.pb, operator.actor, events);
    const configuration = await new CheckinEventService(test.pb, admin.actor, events).configure({ operationId: crypto.randomUUID(), expectedGeneration: 0, upstreamEventId: "101", member: true, enabled: true, listId: "201", affiliation: { questionId: "301", productIds: ["401"] }, reason: "configuration" });
    await control.adminControl({ operation: "set_system_enabled", operationId: crypto.randomUUID(), expectedVersion: 1, enabled: true, reason: "configuration" });
    const stationId = "wts2026station1";
    await control.adminControl({ operation: "set_station_enabled", operationId: crypto.randomUUID(), expectedVersion: 1, stationId, enabled: true, reason: "configuration" });
    const code = (await control.adminControl({ operation: "rotate_provision_code", operationId: crypto.randomUUID(), expectedVersion: 2, stationId, reason: "configuration" })).provisionCode!;
    const token = "b".repeat(64);
    await control.bind(code, token, (await control.preview(code)).confirmation);
    const initial = await catalogue.catalogue(token);
    const selected = await catalogue.select(token, { ...initial.fence, eventId: configuration.configuration.id, eventGeneration: 1 });
    const source: CheckinArrivalSource = { sourceKey: events.sourceKey, resolve: async () => ({ state: "eligible" as const, attendee: { upstreamAttendeeId: "501", publicId: qrIdentity, productId: "401", name: "Тест Attendee", alreadyCheckedIn: false } }), affiliation: async () => ({ state: "present" as const, text: "Test organisation" }) };
    const service = new CheckinArrivalService(test.pb, operator.actor, source);
    const command = () => ({ operationId: crypto.randomUUID(), context: selected.context!, qrIdentity, affiliationChoice: "fetch" as const });
    return { ...test, admin, operator, control, catalogue, configuration, token, code, source, service, command };
  } catch (error) { await test.cleanup(); throw error; }
}

export async function ready(t: Awaited<ReturnType<typeof setup>>, stationId: CheckinStationId = "wts2026station1", coordinator = new Coordinator(t.pb)) {
  const row = await t.pb.collection("checkin_stations").getOne(stationId);
  let version = Number(row.version);
  const code = row.provision_code_hash ? t.code : (await t.control.adminControl({ operation: "rotate_provision_code", operationId: crypto.randomUUID(), stationId, expectedVersion: version++, reason: "configuration" })).provisionCode!;
  if (!row.enabled) { await t.control.adminControl({ operation: "set_station_enabled", operationId: crypto.randomUUID(), stationId, expectedVersion: version++, enabled: true, reason: "configuration" }); }
  await t.control.adminControl({ operation: "configure_station", operationId: crypto.randomUUID(), stationId, expectedVersion: version++, label: "Test station", location: "Test", printerRef: "test-printer", reason: "configuration" });
  const profiles = new CheckinLabelProfileService(t.pb, t.admin.actor);
  const saved = await profiles.configure({ operationId: crypto.randomUUID(), stationId, expectedVersion: 0, expectedStationVersion: version, reason: "configuration", note: "Synthetic test profile", config: { ...SYNTHETIC_LABEL_CONFIG, synthetic: false, printerRef: "test-printer", stockRef: "test-stock" } });
  await profiles.approve({ operationId: crypto.randomUUID(), profileId: saved.profile.id, expectedVersion: 1, expectedStationVersion: version, reason: "configuration", physicalConfirmation: true, note: "Synthetic attestation only, not physical evidence" });
  const identity = { stationId, agentIdentity: "test-pi", printerIdentity: "test-printer", journalIdentity: "test-journal", profileId: saved.profile.id };
  const issued = await new CheckinAgentService(t.pb, t.admin.actor).issue({ ...identity, operationId: crypto.randomUUID(), expectedStationVersion: version, reason: "configuration", note: "Synthetic agent", credentialLifetimeHours: 24 });
  const heartbeat = () => coordinator.machine(issued.credential!, "heartbeat", { ...identity, protocolGeneration: 1, schemaGeneration: 1, journalSequence: 1, journalDigest: "c".repeat(64), journalState: "healthy" });
  return { coordinator, heartbeat, issued, saved, code };
}
export async function context(t: Awaited<ReturnType<typeof setup>>, token = t.token): Promise<CheckinEventContext> {
  const current = await t.catalogue.catalogue(token);
  return (await t.catalogue.select(token, { ...current.fence, eventId: t.configuration.configuration.id, eventGeneration: 1 })).context!;
}

