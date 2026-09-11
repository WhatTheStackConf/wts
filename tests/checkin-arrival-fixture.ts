import { createHash, randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import type PocketBase from "pocketbase";
import { expect, status, phoneProvisioning, toolsView } from "./checkin-fixtures";
import type { CheckinAdminDTO, CheckinStationId } from "~/lib/checkin-contract";
import type { CheckinLabelCatalogue } from "~/lib/checkin-label-client";
import type { CheckinLabelProfileResult } from "~/lib/checkin-label-profile-contract";
import type { AgentControlResult } from "~/lib/checkin-agent-contract";
import type { CheckinAdminEventCatalogue, CheckinConfigureEventResult, CheckinEventCatalogue } from "~/lib/checkin-event-contract";

export async function arrivalCommand<T>(page: Page, endpoint: string, body: object): Promise<T> {
  const response = await page.evaluate(async ({ endpoint, body }) => {
    const result = await fetch(endpoint, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: result.status, data: await result.json() };
  }, { endpoint, body });
  expect(response.status, JSON.stringify(response.data)).toBe(200);
  return response.data;
}

/** Real administrative prerequisites, with explicitly SYNTHETIC physical
 * attestation and heartbeat evidence. This never connects a Pi or printer. */
export async function arrivalPrerequisites(admin: Page, db: PocketBase, stationIds: CheckinStationId[] = ["wts2026station1"]) {
  const base = () => ({ operationId: crypto.randomUUID(), reason: "configuration", note: "Synthetic arrival browser test only" });
  const overview = () => arrivalCommand<CheckinAdminDTO>(admin, "/api/checkin", { operation: "admin_list" });
  const control = (command: object) => arrivalCommand(admin, "/api/checkin", { operation: "admin_control", command: { ...base(), ...command } });
  const start = await overview();
  if (!start.system.enabled) await control({ operation: "set_system_enabled", expectedVersion: start.system.version, enabled: true });
  const stations: { stationId: CheckinStationId; label: string; provisionCode: string; credentialHash: string; heartbeat: {
    stationId: CheckinStationId; agentIdentity: string; printerIdentity: string; journalIdentity: string; profileId: string;
    protocolGeneration: number; schemaGeneration: number; journalState: string; journalSequence: number; journalDigest: string;
  } }[] = [];
  for (const stationId of stationIds) {
    let station = (await overview()).stations.find((entry) => entry.id === stationId)!;
    const printer = `arrival-test-printer-${stationId}`;
    await control({ operation: "configure_station", stationId, expectedVersion: station.version, label: station.label, location: station.location, printerRef: printer });
    station = (await overview()).stations.find((entry) => entry.id === stationId)!;
    if (!station.enabled) await control({ operation: "set_station_enabled", stationId, expectedVersion: station.version, enabled: true });
    station = (await overview()).stations.find((entry) => entry.id === stationId)!;
    const qr = await arrivalCommand<{ provisionCode: string }>(admin, "/api/checkin", { operation: "admin_control", command: {
      ...base(), operation: "rotate_provision_code", stationId, expectedVersion: station.version,
    } });
    station = (await overview()).stations.find((entry) => entry.id === stationId)!;
    const catalogue = await arrivalCommand<CheckinLabelCatalogue>(admin, "/api/checkin-labels", { operation: "list" });
    const latest = catalogue.profiles.find((entry) => entry.stationId === stationId);
    const profile = await arrivalCommand<CheckinLabelProfileResult>(admin, "/api/checkin-labels", { operation: "configure", command: {
      ...base(), stationId, expectedStationVersion: station.version, expectedVersion: latest?.version ?? 0,
      config: { ...catalogue.syntheticConfig, synthetic: false, printerRef: printer, stockRef: "arrival-test-stock" },
    } });
    await arrivalCommand(admin, "/api/checkin-labels", { operation: "approve", command: {
      ...base(), profileId: profile.profile.id, expectedVersion: profile.profile.version, expectedStationVersion: station.version, physicalConfirmation: true,
    } });
    const issued = await arrivalCommand<AgentControlResult>(admin, "/api/checkin-agents", { operation: "admin_issue", command: {
      ...base(), stationId, expectedStationVersion: station.version, agentIdentity: `arrival-test-pi-${stationId}`, printerIdentity: printer,
      journalIdentity: `arrival-test-journal-${stationId}`, profileId: profile.profile.id, credentialLifetimeHours: 24,
    } });
    const agent = await db.collection("checkin_agents").getOne(issued.station.agentId!);
    stations.push({ stationId, label: station.label, provisionCode: qr.provisionCode, credentialHash: createHash("sha256").update(`wts2026:agent:${issued.credential}`).digest("hex"), heartbeat: {
      stationId, agentIdentity: `arrival-test-pi-${stationId}`, printerIdentity: printer, journalIdentity: `arrival-test-journal-${stationId}`,
      profileId: profile.profile.id, protocolGeneration: 1, schemaGeneration: 1, journalState: "healthy", journalSequence: Number(agent.journal_sequence) + 1, journalDigest: randomBytes(32).toString("hex"),
    } });
  }
  const events = [];
  for (const upstreamEventId of ["501", "502"]) {
    const catalogue = await arrivalCommand<CheckinAdminEventCatalogue>(admin, "/api/checkin-events", { operation: "admin_catalogue" });
    const prior = catalogue.events.find((entry) => entry.upstreamEventId === upstreamEventId)?.configuration;
    const configured = await arrivalCommand<CheckinConfigureEventResult>(admin, "/api/checkin-events", { operation: "configure", command: {
      ...base(), upstreamEventId, expectedGeneration: prior?.generation ?? 0, member: true, enabled: true, listId: "701", affiliation: { questionId: "801", productIds: ["601"] },
    } });
    events.push(configured.configuration);
  }
  const owner = randomBytes(32).toString("hex");
  const machine = (operation: string, values: object = {}) => db.send("/api/wts/checkin-agents", { method: "POST", requestKey: null, body: {
    operation: `machine_${operation}`, owner, nowMs: Date.now(), ...values,
  } });
  await machine("acquire", { config: { heartbeatIntervalMs: 5000, heartbeatTimeoutMs: 15000, authorizationTtlMs: 10000 } });
  let ticking: Promise<void> | undefined;
  let failure: unknown;
  const tick = async () => {
    await machine("pulse");
    for (const station of stations) await machine("heartbeat", { credentialHash: station.credentialHash, payload: station.heartbeat });
  };
  await tick();
  const timer = setInterval(() => {
    if (ticking) return;
    ticking = tick().catch((error: unknown) => { failure = error; }).finally(() => { ticking = undefined; });
  }, 2000);
  return { stations, events, async cleanup() { clearInterval(timer); await ticking; await machine("release"); if (failure) throw failure; } };
}

export async function bindArrivalPhone(page: Page, code: string, eventId: string) {
  await page.goto("/checkin-tools");
  await phoneProvisioning(page);
  await page.getByLabel("Station provisioning code", { exact: true }).fill(code);
  await page.getByRole("button", { name: "Review station", exact: true }).click();
  await page.getByRole("button", { name: "Confirm station binding", exact: true }).click();
  await expect.poll(async () => (await status(page)).bindingState).toBe("bound");
  await page.getByLabel("Event for this phone", { exact: true }).selectOption(eventId);
  await page.getByRole("button", { name: "Select event for this phone", exact: true }).click();
  await expect(page.getByText("Event selection saved for this phone only. Other phones and existing work are unchanged.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Select event for this phone", exact: true })).toBeDisabled();
  expect((await arrivalCommand<CheckinEventCatalogue>(page, "/api/checkin-events", { operation: "catalogue" })).context).toMatchObject({ eventId });
  await toolsView(page, "Arrivals");
  await expect(page.getByLabel("Attendee QR identity", { exact: true })).toBeEnabled();
}
