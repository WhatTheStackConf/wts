import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { agentAdminList, mutateAgent, CheckinAgentRequestError } from "~/lib/checkin-agent-client";

const station = {
  stationId: "wts2026station1", stationLabel: "Station One", stationVersion: 2,
  agentId: "testagent000001", credentialState: "active", credentialExpiresAt: "2026-09-15T10:00:00.000Z",
  connection: "never_seen", compatibility: "unknown", profile: "unapproved", journal: "unknown", stopped: false,
  coordinator: "unavailable", readyForAuthorization: false, operationsEnabled: false, reasons: ["agent_unavailable"],
  lastHeartbeatAt: null, heartbeatIntervalMs: 5000, heartbeatTimeoutMs: 15000, authorizationTtlMs: 10000,
};
const mutation = () => ({ operation: "admin_issue" as const, command: {
  operationId: "019875a5-14d0-4ee5-9f56-bd49dc3da733", stationId: "wts2026station1" as const, expectedStationVersion: 1,
  reason: "configuration" as const, note: "Test only", agentIdentity: "test-pi-one", printerIdentity: "test-usb-one",
  journalIdentity: "test-journal-one", profileId: "testprofile0001", credentialLifetimeHours: 24,
} });
afterEach(() => vi.unstubAllGlobals());

describe("agent browser commands", () => {
  it("accepts one-time issuance then an exact secret-free replay", async () => {
    const issued = { actionId: "testaction00001", replayed: false, station, credential: "wts_agent_" + "a".repeat(64) };
    const fetcher = vi.fn().mockResolvedValue(Response.json(issued));
    vi.stubGlobal("fetch", fetcher);
    await expect(mutateAgent(mutation())).resolves.toEqual(issued);
    const replay = { actionId: issued.actionId, replayed: true, station };
    fetcher.mockResolvedValue(Response.json(replay));
    await expect(mutateAgent(mutation())).resolves.toEqual(replay);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer", body: JSON.stringify(mutation()) });
  });
  it("refuses malformed success rather than discarding an unknown issuance", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));
    await expect(mutateAgent(mutation())).rejects.toMatchObject({ ambiguous: true });
  });
  it("pins submitted station and version and suppresses raw failure diagnostics", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ actionId: "testaction00001", replayed: false, station: { ...station, stationId: "wts2026station2" }, credential: "wts_agent_" + "a".repeat(64) }));
    vi.stubGlobal("fetch", fetcher);
    await expect(mutateAgent(mutation())).rejects.toMatchObject({ ambiguous: true });
    fetcher.mockResolvedValue(Response.json({ error: "SECRET raw diagnostic" }, { status: 503 }));
    const failure = await mutateAgent(mutation()).catch((error) => error);
    expect(failure).toBeInstanceOf(CheckinAgentRequestError);
    expect(failure.message).not.toContain("SECRET");
    expect(failure.ambiguous).toBe(true);
  });
  it("keeps one-time credentials out of replay and catalogue envelopes", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ actionId: "testaction00001", replayed: true, station, credential: "wts_agent_" + "a".repeat(64) }));
    vi.stubGlobal("fetch", fetcher);
    await expect(mutateAgent(mutation())).rejects.toMatchObject({ ambiguous: true });
    fetcher.mockResolvedValue(Response.json({ stations: [{ ...station, credential: "secret" }] }));
    await expect(agentAdminList()).rejects.toBeInstanceOf(CheckinAgentRequestError);
  });
});
