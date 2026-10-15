import { afterEach, expect, it, vi } from "vite-plus/test";
import { mutateAgent } from "~/lib/checkin-agent-client";

const station = {
  stationId: "wts2026station1", stationLabel: "Station One", stationVersion: 2,
  agentId: "testagent000001", credentialState: "revoked", credentialExpiresAt: null,
  connection: "never_seen", compatibility: "unknown", profile: "unapproved", journal: "unknown", stopped: false,
  coordinator: "unavailable", readyForAuthorization: false, operationsEnabled: false, reasons: [],
  lastHeartbeatAt: null, heartbeatIntervalMs: 5000, heartbeatTimeoutMs: 15000, authorizationTtlMs: 10000,
};
const command = { operationId: "019875a5-14d0-4ee5-9f56-bd49dc3da733", stationId: "wts2026station1" as const, expectedStationVersion: 1, reason: "security" as const, note: "Test only" };
const revoke = { operation: "admin_revoke" as const, command: { ...command, agentId: "testagent000001" } };
const issue = { operation: "admin_issue" as const, command: { ...command, agentIdentity: "test-pi", printerIdentity: "test-usb", journalIdentity: "test-journal", profileId: "", credentialLifetimeHours: 24 } };
const credential = "wts_agent_" + "a".repeat(64);
afterEach(() => vi.unstubAllGlobals());
async function outcome(mutation: Parameters<typeof mutateAgent>[0], body: object) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
  return mutateAgent(mutation).then(() => "accepted", (error) => `rejected:${error.ambiguous}`);
}

it("accepts only results consistent with the submitted revocation or issuance", async () => {
  const result = { actionId: "testaction00001", replayed: false, station };
  expect(await outcome(revoke, result)).toBe("accepted");
  expect(await outcome(revoke, { ...result, replayed: true })).toBe("accepted");
  expect(await outcome(revoke, { ...result, credential })).toBe("rejected:true");
  expect(await outcome(revoke, { ...result, station: { ...station, credentialState: "active" } })).toBe("rejected:true");
  expect(await outcome(revoke, { ...result, station: { ...station, agentId: "otheragent00001" } })).toBe("rejected:true");
  expect(await outcome(revoke, { ...result, station: { ...station, stationVersion: 3 } })).toBe("rejected:true");
  const active = { ...station, credentialState: "active" };
  expect(await outcome(issue, { ...result, station: active, credential })).toBe("accepted");
  expect(await outcome(issue, { ...result, station: active, replayed: true })).toBe("accepted");
  expect(await outcome(issue, { ...result, station: active })).toBe("rejected:true");
  expect(await outcome(issue, { ...result, station: { ...active, agentId: null }, credential })).toBe("rejected:true");
  expect(await outcome(issue, { ...result, station, credential })).toBe("rejected:true");
});
