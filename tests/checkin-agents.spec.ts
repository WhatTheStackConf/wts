import { createHash, randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect, login, status, phoneProvisioning, toolsView, openToolsDisclosure, sessionCookieHeader } from "./checkin-fixtures";
import type { CheckinAdminDTO } from "~/lib/checkin-contract";
import type { CheckinLabelCatalogue } from "~/lib/checkin-label-client";
import type { CheckinLabelProfileResult } from "~/lib/checkin-label-profile-contract";
import type { AgentControlResult, AgentAdminListDTO } from "~/lib/checkin-agent-contract";
import type { AgentMutation } from "~/lib/checkin-agent-client";

const endpoint = "/api/checkin-agents";
async function command<T>(page: Page, endpoint: string, body: object): Promise<T> {
  const result = await page.evaluate(async ({ endpoint, body }) => {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }, { endpoint, body });
  expect(result.status, JSON.stringify(result.data)).toBe(200);
  return result.data;
}

async function fixtureProfile(page: Page) {
  // Real prerequisite commands, explicitly synthetic profile and asset identities.
  // No physical approval is claimed by this setup.
  let overview = await command<CheckinAdminDTO>(page, "/api/checkin", { operation: "admin_list" });
  const base = { operationId: crypto.randomUUID(), reason: "configuration", note: "Synthetic agent browser fixture only" };
  if (!overview.system.enabled) await command(page, "/api/checkin", { operation: "admin_control", command: { ...base, operation: "set_system_enabled", expectedVersion: overview.system.version, enabled: true } });
  let station = overview.stations[2];
  if (!station.enabled) await command(page, "/api/checkin", { operation: "admin_control", command: { ...base, operationId: crypto.randomUUID(), operation: "set_station_enabled", stationId: station.id, expectedVersion: station.version, enabled: true } });
  overview = await command<CheckinAdminDTO>(page, "/api/checkin", { operation: "admin_list" });
  station = overview.stations[2];
  const configured = await command<{ station: CheckinAdminDTO["stations"][number] }>(page, "/api/checkin", { operation: "admin_control", command: { ...base, operationId: crypto.randomUUID(), operation: "configure_station", stationId: station.id, expectedVersion: station.version, label: station.label, location: station.location, printerRef: "test-only-agent-printer" } });
  const profiles = await command<CheckinLabelCatalogue>(page, "/api/checkin-labels", { operation: "list" });
  const latest = profiles.profiles.find((profile) => profile.stationId === station.id);
  const profile = await command<CheckinLabelProfileResult>(page, "/api/checkin-labels", { operation: "configure", command: {
    ...base, operationId: crypto.randomUUID(), stationId: station.id, expectedStationVersion: configured.station.version, expectedVersion: latest?.version ?? 0,
    config: { ...profiles.syntheticConfig, printerRef: "test-only-agent-printer" },
  } });
  return { stationId: station.id, profile: profile.profile };
}

function agentUi(page: Page) {
  const region = page.getByRole("region", { name: "Station agents", exact: true });
  return { region, selector: region.getByLabel("Station for agent administration", { exact: true }),
    issue: region.getByRole("form", { name: "Provision station agent", exact: true }),
    confirm: region.getByRole("form", { name: "Confirm agent action", exact: true }) };
}
async function reviewIssue(page: Page, fixture: Awaited<ReturnType<typeof fixtureProfile>>) {
  const ui = agentUi(page);
  await expect(ui.selector).toBeEnabled();
  await ui.selector.selectOption(fixture.stationId);
  await ui.issue.getByLabel("Expected agent identity (required)", { exact: true }).fill("test-only-pi-agent");
  await ui.issue.getByLabel("Stable printer identity (required)", { exact: true }).fill("test-only-agent-printer");
  await ui.issue.getByLabel("Expected journal identity (required)", { exact: true }).fill("test-only-journal");
  await ui.issue.getByLabel("Pinned Name Label profile (required)", { exact: true }).selectOption(fixture.profile.id);
  await ui.issue.getByLabel("Credential lifetime in hours (required)", { exact: true }).fill("24");
  await ui.issue.getByRole("button", { name: "Review agent issuance", exact: true }).click();
  await expect(ui.confirm.getByLabel("Agent action reason (required)", { exact: true })).toBeFocused();
  await ui.confirm.getByLabel("Agent action reason (required)", { exact: true }).selectOption("configuration");
  await ui.confirm.getByLabel("Agent action note", { exact: true }).fill("Synthetic browser agent issuance only");
  return ui;
}
async function confirmAgent(page: Page, operation: AgentMutation["operation"], retry = false) {
  const response = page.waitForResponse((response) => response.url().endsWith(endpoint) && response.request().postDataJSON()?.operation === operation);
  await agentUi(page).confirm.getByRole("button", { name: retry ? "Retry same agent action" : "Confirm agent action", exact: true }).click();
  const saved = await response;
  expect(saved.status()).toBe(200);
  return { mutation: saved.request().postDataJSON() as AgentMutation, result: await saved.json() as AgentControlResult };
}

test("station agent controls are separate from browser provisioning and keep event work disabled", async ({ page, state }) => {
  await login(page, state.users.admin);
  await page.goto("/admin/checkin");
  const agents = page.getByRole("region", { name: "Station agents", exact: true });
  await expect(agents).toBeVisible();
  await expect(agents.getByRole("heading", { name: "Station agents", exact: true })).toBeVisible();
  await expect(agents.getByText("Agent credentials are not User logins, Station Client Bindings or provisioning QRs.", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto("/checkin-tools");
  expect((await status(page)).operationsEnabled).toBe(false);
  await expect(page.getByRole("button", { name: "Arrivals", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Validate arrival", exact: true })).not.toBeVisible();
});

test("actual agent issuance and revocation remain audited, secret-free in reads, and operator-isolated", async ({ page, state, db, actorPage }, info) => {
  await login(page, state.users.admin);
  const fixture = await fixtureProfile(page);
  await page.goto("/admin/checkin");
  const ui = await reviewIssue(page, fixture);
  await page.setViewportSize({ width: 320, height: 740 });
  await ui.confirm.getByLabel("Agent action reason (required)", { exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(ui.confirm.getByLabel("Agent action note", { exact: true })).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await ui.confirm.screenshot({ path: info.outputPath("agent-confirmation-320.png") });
  const issued = await confirmAgent(page, "admin_issue");
  await expect(ui.confirm).toHaveCount(0);
  expect(issued.result.credential).toMatch(/^wts_agent_[a-f0-9]{64}$/);
  const credential = issued.result.credential!;
  await expect(ui.region.getByLabel("Issued agent credential", { exact: true })).toHaveValue(credential);
  await expect(ui.region.getByLabel("Issued agent credential", { exact: true })).toHaveAttribute("type", "password");
  const readback = await command<AgentAdminListDTO>(page, endpoint, { operation: "admin_list" });
  expect(readback.stations.find((station) => station.stationId === fixture.stationId)).toEqual(issued.result.station);
  expect(JSON.stringify(readback)).not.toContain(credential);
  expect(issued.result.station).toMatchObject({ connection: "never_seen", profile: "unapproved", readyForAuthorization: false, operationsEnabled: false });
  const actions = await db.collection("admin_actions").getFullList({ filter: db.filter("operation_id = {:id}", { id: issued.mutation.command.operationId }) });
  expect(actions).toHaveLength(1);
  const audits = await db.collection("checkin_audit_events").getFullList({ filter: db.filter("admin_action_id = {:id}", { id: issued.result.actionId }) });
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({ operation: "issue_agent", actor_role: "admin", station_id: fixture.stationId, reason: "configuration", note: "Synthetic browser agent issuance only" });
  expect(JSON.stringify({ actions, audits })).not.toContain(credential);
  await ui.region.getByRole("button", { name: "Hide agent credential", exact: true }).click();
  await expect(ui.region.getByLabel("Issued agent credential", { exact: true })).toHaveCount(0);

  const operator = await actorPage(state.users.operator);
  const denied = await operator.evaluate(async (endpoint) => {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "admin_list" }) });
    return response.status;
  }, endpoint);
  expect(denied).toBe(403);
  const wire = await page.request.post(endpoint, { headers: { Cookie: await sessionCookieHeader(page), Origin: "https://foreign.example" }, data: { operation: "admin_list" } });
  expect(wire.status()).toBe(403);
  const machineAsHuman = await page.request.post(endpoint, { headers: { Origin: state.baseURL, Authorization: `Bearer ${credential}`, Cookie: "" }, data: { operation: "admin_list" } });
  expect(machineAsHuman.status()).toBe(403);

  // Bind operator through the actual provisioning form; QR is never machine auth.
  const stations = await command<CheckinAdminDTO>(page, "/api/checkin", { operation: "admin_list" });
  const target = stations.stations.find((station) => station.id === fixture.stationId)!;
  const qr = await command<{ provisionCode: string }>(page, "/api/checkin", { operation: "admin_control", command: {
    operation: "rotate_provision_code", operationId: crypto.randomUUID(), expectedVersion: target.version, stationId: target.id, reason: "configuration", note: "Synthetic browser binding only",
  } });
  await operator.goto("/checkin-tools");
  await phoneProvisioning(operator);
  await operator.getByLabel("Station provisioning code", { exact: true }).fill(qr.provisionCode);
  await operator.getByRole("button", { name: "Review station", exact: true }).click();
  await operator.getByRole("button", { name: "Confirm station binding", exact: true }).click();
  await toolsView(operator, "Diagnostics");
  await openToolsDisclosure(operator, "Agent details");
  const readiness = operator.getByRole("region", { name: "Diagnostics", exact: true });
  await expect(readiness.getByRole("heading", { name: /^Agent readiness/ })).toBeVisible();
  const own = await command<{ station: AgentControlResult["station"] }>(operator, endpoint, { operation: "status" });
  expect(own.station.stationId).toBe(fixture.stationId);
  for (const privateValue of [credential, "test-only-pi-agent", "test-only-printer-serial", "test-only-journal"]) expect(JSON.stringify(own)).not.toContain(privateValue);
  await operator.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => operator.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await readiness.screenshot({ path: info.outputPath("agent-operator-readiness-390.png") });

  await ui.region.getByRole("button", { name: "Refresh station agents", exact: true }).click();
  await expect(ui.selector).toBeEnabled();
  await ui.selector.selectOption(fixture.stationId);
  await ui.region.getByRole("button", { name: "Review agent revocation", exact: true }).click();
  await ui.confirm.getByLabel("Agent action reason (required)", { exact: true }).selectOption("security");
  await ui.confirm.getByLabel("Agent action note", { exact: true }).fill("Synthetic revocation test only");
  const revoked = await confirmAgent(page, "admin_revoke");
  expect(revoked.result.station).toMatchObject({ agentId: issued.result.station.agentId, credentialState: "revoked", readyForAuthorization: false });
  expect(revoked.result).not.toHaveProperty("credential");
  await readiness.getByRole("button", { name: "Refresh readiness", exact: true }).click();
  await expect(readiness.locator("dd").filter({ hasText: /^revoked$/ })).toBeVisible();
  expect((await status(operator)).operationsEnabled).toBe(false);
  const revocationAudit = await db.collection("checkin_audit_events").getFullList({ filter: db.filter("admin_action_id = {:id}", { id: revoked.result.actionId }) });
  expect(revocationAudit).toHaveLength(1);
  expect(revocationAudit[0].reason).toBe("security");
});

test("synthetic heartbeat evidence renders stale, compatible, quarantined and stopped as separate readiness states", async ({ page, state, db }, info) => {
  await login(page, state.users.admin);
  const fixture = await fixtureProfile(page);
  await page.goto("/admin/checkin");
  const ui = await reviewIssue(page, fixture);
  const issued = await confirmAgent(page, "admin_issue");
  await expect(ui.confirm).toHaveCount(0);
  await ui.region.getByRole("button", { name: "Hide agent credential", exact: true }).click();
  const owner = randomBytes(32).toString("hex");
  const credentialHash = createHash("sha256").update(`wts2026:agent:${issued.result.credential}`).digest("hex");
  const storage = (operation: string, nowMs: number, payload?: object) => db.send("/api/wts/checkin-agents", { method: "POST", body: {
    operation: `machine_${operation}`, owner, nowMs, credentialHash, payload,
    ...(operation === "acquire" ? { config: { heartbeatIntervalMs: 5000, heartbeatTimeoutMs: 15000, authorizationTtlMs: 10000 } } : {}),
  }, requestKey: null });
  const heartbeat = { stationId: fixture.stationId, agentIdentity: "test-only-pi-agent", printerIdentity: "test-only-agent-printer", journalIdentity: "test-only-journal", profileId: fixture.profile.id, protocolGeneration: 1, schemaGeneration: 1, journalState: "healthy", journalSequence: 1, journalDigest: "a".repeat(64) };
  // Clock/evidence injection is ONLY through the disposable privileged storage
  // fixture. Browser queries are real; no Pi, printer or approval is simulated as live.
  const beforeTimeout = Date.now() - 16000;
  await storage("acquire", beforeTimeout);
  try {
    await storage("heartbeat", beforeTimeout, heartbeat);
    await storage("acquire", Date.now());
    const card = ui.region.getByRole("article").filter({ has: page.getByRole("heading", { name: `Agent readiness · ${issued.result.station.stationLabel}`, exact: true }) });
    await ui.region.getByRole("button", { name: "Refresh station agents", exact: true }).click();
    await expect(card.locator("dd").filter({ hasText: /^stale$/ })).toBeVisible();
    await expect(card.locator("dd").filter({ hasText: /^unapproved$/ })).toBeVisible();
    await expect(card.getByText(/unready after 15s/)).toBeVisible();
    await storage("heartbeat", Date.now(), { ...heartbeat, journalSequence: 2, journalDigest: "b".repeat(64) });
    await ui.region.getByRole("button", { name: "Refresh station agents", exact: true }).click();
    await expect(card.locator("dt").filter({ hasText: /^Agent connection$/ }).locator("..").locator("dd")).toHaveText("connected");
    await expect(card.locator("dd").filter({ hasText: /^compatible$/ })).toBeVisible();
    await expect(card.locator("dd").filter({ hasText: /^unapproved$/ })).toBeVisible();
    await storage("heartbeat", Date.now(), { ...heartbeat, protocolGeneration: 99, journalSequence: 3, journalDigest: "c".repeat(64) });
    await ui.region.getByRole("button", { name: "Refresh station agents", exact: true }).click();
    await expect(card.locator("dd").filter({ hasText: /^mismatch$/ })).toBeVisible();
    await expect(card.locator("dd").filter({ hasText: /^quarantined$/ })).toBeVisible();
    // A later correct connection report cannot undo the durable quarantine.
    await storage("heartbeat", Date.now(), { ...heartbeat, journalSequence: 4, journalDigest: "d".repeat(64) });
    const overview = await command<CheckinAdminDTO>(page, "/api/checkin", { operation: "admin_list" });
    await command(page, "/api/checkin", { operation: "admin_control", command: { operation: "set_system_enabled", operationId: crypto.randomUUID(), expectedVersion: overview.system.version, enabled: false, reason: "incident", note: "Synthetic station stop evidence" } });
    await ui.region.getByRole("button", { name: "Refresh station agents", exact: true }).click();
    await expect(card.locator("dd").filter({ hasText: /^quarantined$/ })).toBeVisible();
    await expect(card.getByText("Stopped — no future starts", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await card.screenshot({ path: info.outputPath("agent-quarantine-stop-390.png") });
  } finally { await storage("release", Date.now()); }
});

for (const failureMode of ["transport", "empty-json", "null-json"] as const) test(`agent ${failureMode} response loss preserves the exact action across readiness read failure`, async ({ page, state, db }) => {
  await login(page, state.users.admin);
  const fixture = await fixtureProfile(page);
  await page.goto("/admin/checkin");
  const ui = await reviewIssue(page, fixture);
  const submitted: AgentMutation[] = [];
  let committed: AgentControlResult | undefined;
  let failReads = false;
  await page.route(`**${endpoint}`, async (route) => {
    const body = route.request().postDataJSON();
    if (body?.operation === "admin_list" && failReads) return route.abort("failed");
    if (body?.operation !== "admin_issue") return route.continue();
    submitted.push(body);
    if (submitted.length !== 1) return route.continue();
    const response = await route.fetch(); // Real application commits, then synthetic transport/envelope loss.
    expect(response.status(), await response.text()).toBe(200);
    committed = await response.json() as AgentControlResult;
    if (failureMode === "transport") return route.abort("failed");
    await route.fulfill({ status: 200, contentType: "application/json", body: failureMode === "null-json" ? "null" : "{}" });
  });
  await ui.confirm.getByRole("button", { name: "Confirm agent action", exact: true }).click();
  const retry = ui.confirm.getByRole("button", { name: "Retry same agent action", exact: true });
  await expect(retry).toBeEnabled();
  expect(committed).toBeDefined();
  failReads = true;
  await ui.region.getByRole("button", { name: "Refresh station agents", exact: true }).click();
  await expect(ui.region.getByText(/^Agent readiness unavailable/)).toBeVisible();
  await expect(retry).toBeEnabled();
  await expect(ui.confirm.getByLabel("Agent action reason (required)", { exact: true })).toBeDisabled();
  await expect(ui.confirm.getByLabel("Agent action note", { exact: true })).toHaveValue("Synthetic browser agent issuance only");
  await expect(ui.issue.getByLabel("Expected agent identity (required)", { exact: true })).toBeDisabled();
  await expect(ui.confirm.getByRole("button", { name: "Cancel agent action", exact: true })).toBeDisabled();
  const replay = await confirmAgent(page, "admin_issue", true);
  expect(submitted).toHaveLength(2);
  expect(submitted[1]).toEqual(submitted[0]);
  expect(replay.result).toMatchObject({ actionId: committed!.actionId, replayed: true, station: committed!.station });
  expect(replay.result).not.toHaveProperty("credential");
  await expect(ui.confirm).toHaveCount(0);
  await expect(ui.region.getByLabel("Issued agent credential", { exact: true })).toHaveCount(0);
  const actions = await db.collection("admin_actions").getFullList({ filter: db.filter("operation_id = {:id}", { id: submitted[0].command.operationId }) });
  expect(actions).toHaveLength(1);
  expect(JSON.stringify(actions)).not.toContain(committed!.credential!);
});
