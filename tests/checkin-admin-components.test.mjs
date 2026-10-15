// Run: node --test tests/checkin-admin-components.test.mjs
// Mounted production admin components; client modules are explicit test doubles.
// Set CHECKIN_ADMIN_COMPONENTS_SNAPSHOT=<file> to also write DOM checkpoints.
import { after, before, test } from "node:test";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const ids = {
  fixture: `${root}tests/__checkin-admin-components-fixture.tsx`,
  harness: `${root}tests/__checkin-admin-components-harness.ts`,
  agent: `${root}tests/__checkin-admin-agent-client.ts`,
  label: `${root}tests/__checkin-admin-label-client.ts`,
  event: `${root}tests/__checkin-admin-event-client.ts`,
  checkin: `${root}tests/__checkin-admin-checkin-client.ts`,
  guards: `${root}tests/__checkin-admin-guards.ts`,
};
const harness = `
import { CheckinAgentRequestError } from "${root}src/lib/checkin-agent-client.ts";
import { CheckinLabelRequestError } from "${root}src/lib/checkin-label-client.ts";
import { CheckinEventRequestError } from "${root}src/lib/checkin-event-client.ts";
import { CheckinMonitoringRequestError } from "${root}src/lib/checkin-monitoring-client.ts";
let uuid = 0;
crypto.randomUUID = () => \`00000000-0000-4000-8000-\${String(++uuid).padStart(12, "0")}\`;
const state = { calls: [], plan: {}, defaults: {}, ...(window.__initialHarness ?? {}) };
window.harness = state;
const errors = {
  agent: (e) => new CheckinAgentRequestError(e.message, e.ambiguous),
  label: (e) => new CheckinLabelRequestError(e.message, e.ambiguous),
  event: (e) => new CheckinEventRequestError(e.message, e.ambiguous),
  monitoring: (e) => new CheckinMonitoringRequestError(e.message, e.ambiguous, e.status),
  plain: (e) => new Error(e.message),
  value: (e) => e.message,
};
export function respond(name, ...args) {
  state.calls.push({ name, args: JSON.parse(JSON.stringify(args)) });
  const step = state.plan[name]?.length ? state.plan[name].shift() : state.defaults[name];
  if (!step) return new Promise(() => {});
  return new Promise((resolve, reject) => setTimeout(() => step.error ? reject(errors[step.error.type](step.error)) : resolve(structuredClone(step.value)), 0));
}
`;
const fakes = {
  agent: `export * from "${root}src/lib/checkin-agent-client.ts";
import { respond } from "${ids.harness}";
export const agentAdminList = () => respond("agentAdminList");
export const agentStatus = () => respond("agentStatus");
export const mutateAgent = (mutation) => respond("mutateAgent", mutation);`,
  label: `export * from "${root}src/lib/checkin-label-client.ts";
import { respond } from "${ids.harness}";
export const listLabelProfiles = () => respond("listLabelProfiles");
export const mutateLabelProfile = (mutation) => respond("mutateLabelProfile", mutation);
export const previewNameLabel = (text, profile) => respond("previewNameLabel", text, profile ?? null);`,
  event: `export * from "${root}src/lib/checkin-event-client.ts";
import { respond } from "${ids.harness}";
export const checkinAdminEventCatalogue = () => respond("checkinAdminEventCatalogue");
export const checkinAdminEventOptions = (id) => respond("checkinAdminEventOptions", id);
export const configureCheckinEvent = (command) => respond("configureCheckinEvent", command);
export const checkinEventCatalogue = () => respond("checkinEventCatalogue");
export const selectCheckinEvent = (selection) => respond("selectCheckinEvent", selection);`,
  checkin: `export * from "${root}src/lib/checkin-client.ts";
import { respond } from "${ids.harness}";
export const checkinAdminList = (bindingPage, auditPage) => respond("checkinAdminList", bindingPage, auditPage);
export const checkinAdminControl = (input) => respond("checkinAdminControl", input);
export const checkinStatus = () => respond("checkinStatus");
export const checkinPrinters = (fence) => respond("checkinPrinters", fence);
export const selectCheckinPrinter = (confirmation, authority) => respond("selectCheckinPrinter", confirmation, authority.expectedActorId);`,
  guards: `const user = () => ({ id: "adminuser000001", role: "admin", name: "Synthetic admin" });
export const useRequireAdmin = () => ({ authorized: () => true, user });
export const useRequireCheckinOperator = () => ({ authorized: () => true, user });
export const useAuth = () => ({ get user() { return user(); }, logout: async () => {} });`,
};
const fixture = `
import { render } from "@solidjs/web";
import { Head } from "@solidjs/meta";
import { respond } from "${ids.harness}";
import AdminCheckinPage from "~/components/checkin/AdminCheckinPage";
import CheckinToolsPage from "~/components/checkin/CheckinToolsPage";
import { CheckinAgentAdmin } from "~/components/checkin/CheckinAgentAdmin";
import { CheckinLabelAdmin } from "~/components/checkin/CheckinLabelAdmin";
import { CheckinEventAdmin } from "~/components/checkin/CheckinEventAdmin";
import { CheckinMonitoringPanel } from "~/components/checkin/checkin-monitoring";
import "~/styles/app.css";
const client = {
  dashboard: (audience, offset) => respond("dashboard", audience, offset),
  configure: (command) => respond("configure", command),
  acknowledge: (id) => respond("acknowledge", id),
};
const views = {
  admin: () => <AdminCheckinPage />,
  tools: () => <CheckinToolsPage />,
  agents: () => <CheckinAgentAdmin />,
  labels: () => <CheckinLabelAdmin />,
  events: () => <CheckinEventAdmin />,
  monitoring: () => <CheckinMonitoringPanel audience="admin" readiness={[]} client={client} />,
};
const view = views[new URLSearchParams(location.search).get("c")];
render(() => <Head><main class="mx-auto max-w-4xl p-3">{view()}</main></Head>, document.getElementById("app"));
`;
const virtual = new Map([[ids.fixture, fixture], [ids.harness, harness], ...Object.entries(fakes).map(([key, source]) => [ids[key], source])]);

const stationIds = ["wts2026station1", "wts2026station2", "wts2026station3"];
const readiness = (n, extra = {}) => ({ stationId: stationIds[n - 1], stationLabel: `Station ${n}`, stationVersion: n, agentId: null, credentialState: "not_issued", credentialExpiresAt: null, connection: "never_seen", compatibility: "unknown", profile: "unconfigured", journal: "unknown", stopped: false, coordinator: "connected", readyForAuthorization: false, operationsEnabled: false, reasons: [], lastHeartbeatAt: null, heartbeatIntervalMs: 5000, heartbeatTimeoutMs: 15000, authorizationTtlMs: 5000, ...extra });
const agentList = { stations: [readiness(1, { agentId: "agent-one", credentialState: "active" }), readiness(2), readiness(3, { agentId: "agent-three", credentialState: "revoked" })] };
const config = (printerRef, synthetic = false) => ({ rendererVersion: "wts-name-label-v1", fontVersion: "noto-sans-2.008-latin-cyrillic-v1", printerRef, stockRef: "stock-a", synthetic, media: { widthMm: 50, heightMm: 30, kind: "precut-gap" }, raster: { width: 600, height: 360 }, printable: { x: 12, y: 12, width: 576, height: 336 }, margins: { top: 0, right: 0, bottom: 0, left: 0 }, offset: { x: 0, y: 0 }, direction: 0, feed: { mode: "gap", gapDots: 24, advanceDots: 0 }, density: 3, threshold: 128 });
const labelStations = [{ id: stationIds[0], label: "Station 1", printerRef: "printer-1", version: 2 }, { id: stationIds[1], label: "Station 2", printerRef: "printer-2", version: 1 }, { id: stationIds[2], label: "Station 3", printerRef: "", version: 1 }];
const profileOne = { id: "profile-one", stationId: stationIds[0], version: 3, approval: "unapproved", config: config("printer-1") };
const labelCatalogue = { profiles: [profileOne, { id: "profile-three", stationId: stationIds[2], version: 1, approval: "unapproved", config: config("", true) }], profileStationVersions: { "profile-one": 2, "profile-three": 1 }, stations: labelStations, operationsEnabled: false, syntheticConfig: config("synthetic-preview", true) };
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const raster = (name, profile) => ({ pngBase64: png, width: 1, height: 1, payloadHash: "hash-1", snapshot: { text: { name, affiliation: "" }, profile, rendererVersion: "wts-name-label-v1", fontVersion: "noto-sans-2.008-latin-cyrillic-v1" }, rows: [{ text: name, fontSize: 40, shortened: false }, { text: "", fontSize: 20, shortened: false }] });
const eventCatalogue = { state: "complete", sourceMismatch: false, events: [
  { upstreamEventId: "101", title: "Main day", upstreamAvailable: true, configuration: { id: "cfg-101", upstreamEventId: "101", title: "Main day", member: true, listId: "l1", affiliation: { questionId: "q1", productIds: ["p1"] }, enabled: true, generation: 2 } },
  { upstreamEventId: "102", title: "Workshop", upstreamAvailable: true, configuration: null },
  { upstreamEventId: "103", title: "Gone", upstreamAvailable: false, configuration: null },
] };
const eventOptions = { state: "complete", lists: [{ id: "l1", title: "General" }, { id: "l2", title: "Workshop list" }], questions: [{ id: "q1", title: "Company", productIds: ["p1"] }, { id: "q2", title: "Team", productIds: [] }], products: [{ id: "p1", title: "Ticket" }, { id: "p2", title: "Pass" }] };
const adminStation = (n, enabled = true) => ({ id: stationIds[n - 1], edition: "WTS2026", label: `Station ${n}`, location: n === 1 ? "Hall" : "", printerRef: n === 1 ? "printer-1" : "", enabled, version: n, generation: n, provisionCodeIssued: true, activeBindingCount: n - 1, multiplePhonesWarning: n === 3, ready: false, unreadyReasons: n === 1 ? ["system_disabled", "unknown_reason"] : [] });
const adminList = { system: { edition: "WTS2026", enabled: true, version: 7, generation: 4 }, stations: [adminStation(1), adminStation(2, false), adminStation(3)],
  bindings: { items: [{ id: "binding-a", stationId: stationIds[0], version: 1, revoked: false, lastSeenAt: "2026-09-17T10:00:00Z", active: true }, { id: "binding-b", stationId: stationIds[1], version: 2, revoked: true, lastSeenAt: "", active: false }], page: 1, hasMore: true },
  audit: { items: [{ id: "a1", actorUserId: "u1", actorName: "Ana", actorRole: "admin", operation: "configure_event", stationId: "", bindingId: "", eventId: "101", reason: "configuration", note: "n1", outcome: "applied", createdAt: "2026-09-17T09:00:00Z" }, { id: "a2", actorUserId: "u1", actorName: "Ana", actorRole: "admin", operation: "set_station_enabled", stationId: stationIds[1], bindingId: "", reason: "maintenance", note: "", outcome: "applied", createdAt: "2026-09-17T09:01:00Z" }, { id: "a3", actorUserId: "u2", actorName: "Bo", actorRole: "checkin_operator", operation: "set_system_enabled", stationId: "", bindingId: "", reason: "", note: "", outcome: "applied", createdAt: "2026-09-17T09:02:00Z" }], page: 1, hasMore: false },
  activeWindowSeconds: 300 };
const phoneStatus = (n, extra = {}) => ({ system: { edition: "WTS2026", enabled: true, generation: 1, version: 1 }, bindingState: "bound", binding: { id: "bbbbbbbbbbbbbbb", version: n, stationId: stationIds[n - 1], revoked: false, active: true, lastSeenAt: "2026-09-17" }, station: { ...adminStation(n), generation: 1, version: 1, activeBindingCount: 1, multiplePhonesWarning: n === 2 }, operationsEnabled: false, activeWindowSeconds: 300, ...extra });
const phoneEvents = [{ id: "eeeeeeeeeeeeee1", title: "Synthetic event", availability: "available", generation: 1 }, { id: "eeeeeeeeeeeeee2", title: "Stale event", availability: "stale", generation: 1 }];
const phoneCatalogue = n => ({ state: "complete", events: phoneEvents, selected: phoneEvents[0], fence: { bindingVersion: n, stationGeneration: 1, systemGeneration: 1, selectionVersion: 1 }, context: { protocolVersion: 1, edition: "WTS2026", eventId: phoneEvents[0].id, eventGeneration: 1, bindingId: "bbbbbbbbbbbbbbb", bindingVersion: n, stationId: stationIds[n - 1], stationGeneration: 1, systemGeneration: 1, selectionVersion: 1 }, operationsEnabled: false });
const printer = n => ({ system: phoneStatus(1).system, station: { ...phoneStatus(n).station, enabled: n !== 3 }, canBind: n !== 3, confirmation: { stationId: stationIds[n - 1], stationVersion: 1, bindingVersion: 1, systemGeneration: 1 } });
const readyAgent = (n, extra = {}) => ({ station: readiness(n, { stationVersion: 1, agentId: "agent", credentialState: "active", connection: "connected", compatibility: "compatible", profile: "approved", journal: "healthy", readyForAuthorization: true, ...extra }) });
const monitoringConfig = { version: 1, waitingMs: 30000, incidentMs: 60000, repeatMs: 900000, recipientUserIds: ["u1"] };
const dashboard = (version = 1) => ({ scope: "all", lastTickMs: 0, recipientsConfigured: true, hasMore: false, incidents: [], config: { ...monitoringConfig, version }, adminChoices: [{ id: "u1", email: "one@example.test" }, { id: "u2", email: "two@example.test" }], audit: [] });

const checkpoints = [];
let server, browser, origin;
before(async () => {
  server = await createServer({
    configFile: false, root, plugins: [tailwindcss(), solid({ ssr: false }), {
      name: "checkin-admin-components-fixture",
      resolveId(id) { if (id === "/__checkin-admin-components-fixture.tsx") return ids.fixture; if (virtual.has(id)) return id; },
      load(id) { return virtual.get(id); },
      configureServer(server) {
        server.middlewares.use("/admin-fixture", async (_req, res) => {
          res.setHeader("Content-Type", "text/html");
          res.end(await server.transformIndexHtml("/admin-fixture", '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div><script type="module" src="/__checkin-admin-components-fixture.tsx"></script></body></html>'));
        });
      },
    }],
    resolve: { alias: [
      { find: "~/lib/checkin-agent-client", replacement: ids.agent }, { find: "~/lib/checkin-label-client", replacement: ids.label },
      { find: "~/lib/checkin-event-client", replacement: ids.event }, { find: "~/lib/checkin-client", replacement: ids.checkin },
      { find: "~/lib/route-guards", replacement: ids.guards }, { find: "~/lib/auth-context", replacement: ids.guards },
      { find: "~", replacement: `${root}src` },
    ] },
    server: { host: "127.0.0.1", port: 0 }, logLevel: "error",
  });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close(); await server?.close();
  if (process.env.CHECKIN_ADMIN_COMPONENTS_SNAPSHOT) writeFileSync(process.env.CHECKIN_ADMIN_COMPONENTS_SNAPSHOT, JSON.stringify(checkpoints, null, 1));
});

async function mount(component, initial, run) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.setDefaultTimeout(8000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text()); });
  // Every client this test does not replace fails closed; none can reach a backend.
  await page.route("**/api/**", route => route.abort());
  await page.addInitScript(value => { window.__initialHarness = value; }, initial);
  const settle = () => page.evaluate(() => new Promise(resolve => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 0)));
  const checkpoint = async (label, selector = "main", attributeSelector = "") => {
    await settle();
    checkpoints.push({ component, label, ...await page.evaluate(([selector, attributeSelector]) => {
      const nodes = [...document.querySelectorAll(selector)];
      const active = document.activeElement;
      return {
        html: nodes.map(node => node.outerHTML),
        attributes: attributeSelector ? [...document.querySelectorAll(attributeSelector)].map(node => [...node.attributes].map(a => [a.name, a.value])) : [],
        focus: active?.id || active?.getAttribute("name") || active?.textContent?.trim().slice(0, 60) || active?.tagName,
        controls: nodes.flatMap(node => [...node.querySelectorAll("input,select,textarea,button,fieldset")]).map(e => [e.tagName, e.id || e.getAttribute("name") || e.textContent.trim().slice(0, 60), e.value ?? null, e.checked ?? null, e.disabled ?? null]),
      };
    }, [selector, attributeSelector]) });
  };
  const fallback = (name, step) => page.evaluate(([name, step]) => { window.harness.defaults[name] = step; }, [name, step]);
  const plan = (name, ...steps) => page.evaluate(([name, steps]) => { (window.harness.plan[name] ??= []).push(...steps); }, [name, steps]);
  const calls = name => page.evaluate(name => window.harness.calls.filter(call => call.name === name).map(call => call.args), name);
  try {
    expect((await page.goto(`${origin}/admin-fixture?c=${component}`))?.ok()).toBe(true);
    await run({ page, plan, fallback, calls, checkpoint });
    expect(errors).toEqual([]);
  } catch (failure) {
    throw new Error(`${failure.message}\nBrowser errors: ${JSON.stringify(errors)}\nDOM: ${await page.locator("body").innerText().catch(() => "")}`, { cause: failure });
  } finally { await page.close(); }
}
const ok = value => ({ value });
const fail = (type, message, extra = {}) => ({ error: { type, message, ambiguous: false, ...extra } });

void test("agent issuance and revocation freeze, retry, reset and report outcomes", async () => {
  await mount("agents", { defaults: { agentAdminList: ok(agentList), listLabelProfiles: ok(labelCatalogue) } }, async ({ page, plan, calls, checkpoint }) => {
    const region = page.getByRole("region", { name: "Station agents" });
    const station = region.locator("#agent-station");
    await expect(station).toBeEnabled();
    await checkpoint("loaded");
    await station.selectOption(stationIds[1]);
    await expect(region.getByText("Selected: Station 2 · Configuration version 2.", { exact: false })).toBeVisible();
    await expect(region.getByRole("button", { name: "Review agent revocation" })).toHaveCount(0);
    await region.locator("#agent-agentIdentity").fill("agent-two");
    await region.locator("#agent-printerIdentity").fill("printer-two");
    await region.locator("#agent-journalIdentity").fill("journal-two");
    await expect(region.locator("#agent-profile option")).toHaveCount(1);
    await station.selectOption(stationIds[0]);
    await expect(region.locator("#agent-profile option")).toHaveText(["Choose a saved profile", "v3 · unapproved · profile-one"]);
    await region.locator("#agent-agentIdentity").fill("agent-one");
    await region.locator("#agent-printerIdentity").fill("printer-1");
    await region.locator("#agent-journalIdentity").fill("journal-one");
    await region.locator("#agent-profile").selectOption("profile-one");
    await region.getByRole("button", { name: "Review agent issuance" }).click();
    const form = region.getByRole("form", { name: "Confirm agent action" });
    await expect(form.getByRole("heading", { name: "Issue replacement machine credential" })).toBeVisible();
    await expect(form.locator("#agent-reason")).toBeFocused();
    await checkpoint("issue review");
    await form.locator("#agent-reason").selectOption("device_replacement");
    await form.locator("#agent-note").fill("swap");
    await plan("mutateAgent", fail("agent", "Agent service could not be reached.", { ambiguous: true }));
    await form.getByRole("button", { name: "Confirm agent action" }).click();
    await expect(region.getByRole("alert")).toHaveText("Agent service could not be reached.");
    await expect(form.getByRole("button", { name: "Retry same agent action" })).toBeEnabled();
    await expect(form.locator("#agent-reason")).toBeDisabled();
    await checkpoint("issue frozen");
    await plan("mutateAgent", ok({ actionId: "x1", replayed: false, station: readiness(1, { stationVersion: 2, agentId: "agent-one", credentialState: "active" }), credential: `wts_agent_${"a".repeat(64)}` }));
    await form.getByRole("button", { name: "Retry same agent action" }).click();
    await expect(region.getByRole("status")).toHaveText("Agent credential issued once. Existing agent authority was replaced; printer/media approval is separate.");
    await expect(form).toHaveCount(0);
    const credential = region.locator("#issued-agent-credential");
    await expect(credential).toHaveAttribute("type", "password");
    await region.getByLabel("Reveal one-time credential for private transfer").check();
    await expect(credential).toHaveAttribute("type", "text");
    await expect(credential).toHaveValue(`wts_agent_${"a".repeat(64)}`);
    await checkpoint("issued");
    const issued = await calls("mutateAgent");
    expect(issued).toHaveLength(2);
    expect(issued[0]).toEqual(issued[1]);
    expect(issued[0][0]).toEqual({ operation: "admin_issue", command: { operationId: "00000000-0000-4000-8000-000000000001", stationId: stationIds[0], expectedStationVersion: 1, reason: "device_replacement", note: "swap", agentIdentity: "agent-one", printerIdentity: "printer-1", journalIdentity: "journal-one", profileId: "profile-one", credentialLifetimeHours: 24 } });
    // Success re-reads readiness; a concurrent poll may satisfy that read instead.
    await expect.poll(async () => (await calls("agentAdminList")).length).toBeGreaterThan(1);

    await station.selectOption(stationIds[0]);
    await expect(region.getByRole("region", { name: "One-time machine credential" })).toHaveCount(0);
    await region.getByRole("button", { name: "Review agent revocation" }).click();
    await expect(form.getByRole("heading", { name: "Revoke machine credential" })).toBeVisible();
    await form.locator("#agent-reason").selectOption("security");
    await plan("mutateAgent", fail("agent", "Station state changed. Refresh agent readiness before reviewing a new action."));
    await form.getByRole("button", { name: "Confirm agent action" }).click();
    await expect(region.getByRole("alert")).toHaveText("Station state changed. Refresh agent readiness before reviewing a new action.");
    await expect(form).toHaveCount(0);
    await expect(station).toHaveValue("");
    await checkpoint("revoke rejected");

    await station.selectOption(stationIds[0]);
    await region.getByRole("button", { name: "Review agent revocation" }).click();
    await form.locator("#agent-reason").selectOption("security");
    await plan("mutateAgent", fail("plain", "raw diagnostics"));
    await form.getByRole("button", { name: "Confirm agent action" }).click();
    await expect(region.getByRole("alert")).toHaveText("Agent action could not be confirmed. Retry the same action.");
    await expect(form.getByRole("button", { name: "Retry same agent action" })).toBeEnabled();
    await plan("mutateAgent", ok({ actionId: "x2", replayed: true, station: readiness(1, { stationVersion: 2, agentId: "agent-one", credentialState: "revoked" }) }));
    await form.getByRole("button", { name: "Retry same agent action" }).click();
    await expect(region.getByRole("status")).toHaveText("Agent action was already saved. No action was repeated. A lost credential cannot be recovered; review a new issuance to replace it.");
    await checkpoint("revoke replayed");

    await station.selectOption(stationIds[0]);
    await region.getByRole("button", { name: "Review agent revocation" }).click();
    await form.locator("#agent-reason").selectOption("incident");
    await plan("mutateAgent", ok({ actionId: "x3", replayed: false, station: readiness(1, { stationVersion: 2, agentId: "agent-one", credentialState: "revoked" }) }));
    await form.getByRole("button", { name: "Confirm agent action" }).click();
    await expect(region.getByRole("status")).toHaveText("Agent revoked. Future work and starts are denied; already-started outcomes may still be reported.");
    const revocations = (await calls("mutateAgent")).slice(2).map(([mutation]) => mutation);
    expect(revocations.map(m => [m.operation, m.command.operationId, m.command.agentId, m.command.reason])).toEqual([
      ["admin_revoke", "00000000-0000-4000-8000-000000000002", "agent-one", "security"],
      ["admin_revoke", "00000000-0000-4000-8000-000000000003", "agent-one", "security"],
      ["admin_revoke", "00000000-0000-4000-8000-000000000003", "agent-one", "security"],
      ["admin_revoke", "00000000-0000-4000-8000-000000000004", "agent-one", "incident"],
    ]);
    await checkpoint("revoked");
  });
});

void test("Name Label preview and profile actions keep generation, freeze and reset contracts", async () => {
  await mount("labels", { defaults: { listLabelProfiles: ok(labelCatalogue) } }, async ({ page, plan, calls, checkpoint }) => {
    const region = page.getByRole("region", { name: "Name Label profiles" });
    await expect(region).toHaveAttribute("data-font-ready", "true");
    const previewForm = region.getByRole("form", { name: "Name Label preview" });
    await expect(previewForm.locator("#label-preview-profile option")).toHaveText(["Synthetic preview", "Station 1 · v3 · unapproved", "Station 3 · v1 · unapproved · synthetic"]);
    await checkpoint("loaded");
    await previewForm.locator("#label-name").fill("Ana");
    await plan("previewNameLabel", fail("plain", "Synthetic preview failed."));
    await previewForm.getByRole("button", { name: "Preview Name Label" }).click();
    await expect(region.getByRole("alert")).toHaveText("Synthetic preview failed.");
    await plan("previewNameLabel", fail("value", "not an error"));
    await previewForm.getByRole("button", { name: "Preview Name Label" }).click();
    await expect(region.getByRole("alert")).toHaveText("Name Label preview failed. Retry explicitly.");
    await previewForm.locator("#label-preview-profile").selectOption("profile-one");
    await expect(region.getByRole("alert")).toHaveCount(0);
    await plan("previewNameLabel", ok(raster("Ana", profileOne)));
    await previewForm.getByRole("button", { name: "Preview Name Label" }).click();
    await expect(region.getByRole("img", { name: "Rendered Name Label" })).toHaveAttribute("data-payload-hash", "hash-1");
    await checkpoint("previewed");
    expect(await calls("previewNameLabel")).toEqual([[{ name: "Ana", affiliation: "" }, null], [{ name: "Ana", affiliation: "" }, null], [{ name: "Ana", affiliation: "" }, profileOne]]);
    await page.evaluate(catalogue => { window.harness.defaults.listLabelProfiles = { value: catalogue }; }, { ...labelCatalogue, profiles: [] });
    await region.getByRole("button", { name: "Refresh Name Label profiles" }).click();
    await expect(previewForm.locator("#label-preview-profile option")).toHaveCount(1);
    await previewForm.getByRole("button", { name: "Preview Name Label" }).click();
    await expect(region.getByRole("alert")).toHaveText("Profile is unavailable. Refresh and choose an exact version.");
    expect((await calls("previewNameLabel")).length).toBe(3);
    await checkpoint("profile unavailable");
    await page.evaluate(catalogue => { window.harness.defaults.listLabelProfiles = { value: catalogue }; }, labelCatalogue);
    await region.getByRole("button", { name: "Refresh Name Label profiles" }).click();
    await expect(previewForm.locator("#label-preview-profile option")).toHaveCount(3);

    const stationSelect = region.locator("#label-profile-station");
    await stationSelect.selectOption(stationIds[0]);
    await expect(region.getByText("Station configuration version 2 · Profile v3: unapproved")).toBeVisible();
    const approve = region.getByRole("button", { name: "Review physical profile approval" });
    await expect(approve).toBeEnabled();
    await checkpoint("station one");
    await approve.click();
    const form = region.getByRole("form", { name: "Confirm Name Label profile action" });
    await expect(form.getByRole("heading", { name: "Record physical profile approval" })).toBeVisible();
    await expect(form.locator("#label-profile-reason")).toBeFocused();
    await form.locator("#label-profile-reason").selectOption("configuration");
    await form.locator("#label-profile-note").fill("printed and checked");
    await form.locator("#label-physical-confirmation").check();
    await plan("mutateLabelProfile", fail("label", "Name Label service could not be reached.", { ambiguous: true }));
    await form.getByRole("button", { name: "Confirm profile action" }).click();
    await expect(region.getByRole("alert")).toHaveText("Name Label service could not be reached.");
    await expect(form.getByRole("button", { name: "Retry same profile action" })).toBeEnabled();
    await checkpoint("approve frozen");
    await plan("mutateLabelProfile", ok({ actionId: "l1", replayed: false, profile: { ...profileOne, approval: "approved" } }));
    await form.getByRole("button", { name: "Retry same profile action" }).click();
    await expect(region.getByRole("status").filter({ hasText: "Profile action saved." })).toHaveText("Profile action saved. Supervised admission and printing require current station readiness.");
    await expect(form).toHaveCount(0);
    await checkpoint("approved");

    await stationSelect.selectOption(stationIds[1]);
    await expect(region.getByText("Station configuration version 1 · No saved profile")).toBeVisible();
    await region.getByRole("button", { name: "Review Name Label profile" }).click();
    await expect(form.getByRole("heading", { name: "Save an unapproved profile version" })).toBeVisible();
    await form.locator("#label-profile-reason").selectOption("maintenance");
    await plan("mutateLabelProfile", fail("label", "Station changed."));
    await form.getByRole("button", { name: "Confirm profile action" }).click();
    await expect(region.getByRole("alert")).toHaveText("Station changed.");
    await expect(form).toHaveCount(0);
    await expect(stationSelect).toHaveValue("");
    await stationSelect.selectOption(stationIds[1]);
    await region.getByRole("button", { name: "Review Name Label profile" }).click();
    await form.locator("#label-profile-reason").selectOption("maintenance");
    await plan("mutateLabelProfile", fail("value", "opaque"));
    await form.getByRole("button", { name: "Confirm profile action" }).click();
    await expect(region.getByRole("alert")).toHaveText("Profile action could not be confirmed.");
    await plan("mutateLabelProfile", ok({ actionId: "l2", replayed: true, profile: { id: "profile-two", stationId: stationIds[1], version: 1, approval: "unapproved", config: config("printer-2", true) } }));
    await form.getByRole("button", { name: "Retry same profile action" }).click();
    await expect(region.getByRole("status").filter({ hasText: "already saved" })).toHaveText("This profile action was already saved; no change was repeated.");
    await checkpoint("configured");
    await stationSelect.selectOption(stationIds[2]);
    await expect(region.getByText("Synthetic profiles cannot be approved for production.")).toBeVisible();
    await expect(region.getByRole("button", { name: "Review physical profile approval" })).toBeDisabled();
    await checkpoint("synthetic station");
    const mutations = (await calls("mutateLabelProfile")).map(([mutation]) => mutation);
    expect(mutations[0]).toEqual(mutations[1]);
    expect(mutations[0]).toEqual({ operation: "approve", command: { operationId: "00000000-0000-4000-8000-000000000001", expectedStationVersion: 2, reason: "configuration", note: "printed and checked", profileId: "profile-one", expectedVersion: 3, physicalConfirmation: true } });
    expect(mutations.slice(2).map(m => [m.operation, m.command.operationId, m.command.stationId, m.command.expectedVersion, m.command.config.printerRef])).toEqual([
      ["configure", "00000000-0000-4000-8000-000000000002", stationIds[1], 0, "printer-2"],
      ["configure", "00000000-0000-4000-8000-000000000003", stationIds[1], 0, "printer-2"],
      ["configure", "00000000-0000-4000-8000-000000000003", stationIds[1], 0, "printer-2"],
    ]);
  });
});

void test("event configuration review, freeze, rejection and affiliation scope", async () => {
  await mount("events", { defaults: { checkinAdminEventCatalogue: ok(eventCatalogue), checkinAdminEventOptions: ok(eventOptions) } }, async ({ page, plan, calls, checkpoint }) => {
    const region = page.getByRole("region", { name: "Event configuration" });
    const eventSelect = region.locator("#admin-checkin-event");
    await expect(eventSelect.locator("option")).toHaveText(["Choose an event to configure", "Main day · ID 101", "Workshop · ID 102", "Gone · ID 103 · upstream unavailable"]);
    await checkpoint("loaded");
    await eventSelect.selectOption("101");
    await expect(region.getByText("Event ID: 101 · Expected configuration generation: 2")).toBeVisible();
    const review = region.getByRole("button", { name: "Review event configuration" });
    await expect(review).toBeEnabled();
    await checkpoint("main day draft");
    await review.click();
    const form = region.getByRole("form", { name: "Confirm event configuration" });
    await expect(form.getByText("Event ID 101 · List ID l1 · WTS 2026 member: yes · Enabled: yes · Expected generation 2")).toBeVisible();
    await expect(form.getByText("Affiliation question: q1 · Product scope: p1")).toBeVisible();
    await expect(form.locator("#event-control-reason")).toBeFocused();
    await form.locator("#event-control-reason").selectOption("configuration");
    await form.locator("#event-control-note").fill("map");
    await plan("configureCheckinEvent", fail("event", "Event service could not be reached.", { ambiguous: true }));
    await form.getByRole("button", { name: "Confirm event configuration" }).click();
    await expect(region.getByRole("alert")).toHaveText("Event service could not be reached.");
    await expect(form.getByRole("button", { name: "Retry same event configuration" })).toBeEnabled();
    await expect(eventSelect).toBeDisabled();
    await checkpoint("main day frozen");
    await plan("configureCheckinEvent", ok({ actionId: "e1", replayed: false, configuration: eventCatalogue.events[0].configuration }));
    await form.getByRole("button", { name: "Retry same event configuration" }).click();
    await expect(region.getByRole("status").filter({ hasText: "saved" })).toHaveText("Event configuration saved. Supervised admission and printing require current station readiness.");
    await expect(eventSelect).toHaveValue("");
    await checkpoint("main day saved");

    await eventSelect.selectOption("102");
    await expect(region.getByText("Review unavailable:", { exact: false })).toHaveCount(0);
    await region.getByLabel("This event belongs to WTS 2026").check();
    await region.getByLabel("Enable this event configuration").check();
    await expect(region.getByText("Review unavailable:", { exact: false })).toBeVisible();
    await expect(review).toBeDisabled();
    await region.locator("#checkin-event-list").selectOption("l2");
    await expect(review).toBeEnabled();
    await region.locator("#checkin-event-question").selectOption("q2");
    await region.getByLabel("Pass · ID p2").check();
    await expect(region.getByLabel("Ticket · ID p1")).toBeEnabled();
    await checkpoint("workshop draft");
    await review.click();
    await expect(form.getByText("Affiliation question: q2 · Product scope: p2")).toBeVisible();
    await form.locator("#event-control-reason").selectOption("maintenance");
    await plan("configureCheckinEvent", fail("event", "Configuration generation changed."));
    await form.getByRole("button", { name: "Confirm event configuration" }).click();
    await expect(region.getByRole("alert")).toHaveText("Configuration generation changed.");
    await expect(form).toHaveCount(0);
    await expect(eventSelect).toHaveValue("");
    await checkpoint("workshop rejected");

    await eventSelect.selectOption("103");
    await expect(region.getByText("This event's upstream source is not currently verified.", { exact: false })).toBeVisible();
    await expect(review).toBeDisabled();
    await checkpoint("gone draft");
    await eventSelect.selectOption("101");
    await region.locator("#checkin-event-question").selectOption("q1");
    await expect(region.getByLabel("Pass · ID p2 · Not in this question's scope")).toBeDisabled();
    await region.getByLabel("Ticket · ID p1").check();
    await review.click();
    await form.locator("#event-control-reason").selectOption("incident");
    await plan("configureCheckinEvent", fail("value", "opaque"));
    await form.getByRole("button", { name: "Confirm event configuration" }).click();
    await expect(region.getByRole("alert")).toHaveText("Unable to confirm event configuration.");
    await plan("configureCheckinEvent", ok({ actionId: "e2", replayed: true, configuration: eventCatalogue.events[0].configuration }));
    await form.getByRole("button", { name: "Retry same event configuration" }).click();
    await expect(region.getByRole("status").filter({ hasText: "already saved" })).toHaveText("This event configuration was already saved; no action was repeated.");
    await checkpoint("main day replayed");
    const commands = (await calls("configureCheckinEvent")).map(([command]) => command);
    expect(commands[0]).toEqual(commands[1]);
    expect(commands[0]).toEqual({ upstreamEventId: "101", expectedGeneration: 2, member: true, enabled: true, listId: "l1", affiliation: { questionId: "q1", productIds: ["p1"] }, operationId: "00000000-0000-4000-8000-000000000001", reason: "configuration", note: "map" });
    expect(commands[2]).toEqual({ upstreamEventId: "102", expectedGeneration: 0, member: true, enabled: true, listId: "l2", affiliation: { questionId: "q2", productIds: ["p2"] }, operationId: "00000000-0000-4000-8000-000000000002", reason: "maintenance", note: "" });
    expect(commands.slice(3).map(c => [c.operationId, c.affiliation])).toEqual([["00000000-0000-4000-8000-000000000003", { questionId: "q1", productIds: ["p1"] }], ["00000000-0000-4000-8000-000000000003", { questionId: "q1", productIds: ["p1"] }]]);
    expect(await calls("checkinAdminEventOptions")).toEqual([["101"], ["102"], ["103"], ["101"]]);
  });
});

void test("station administration lists, pages and confirms controls", async () => {
  await mount("admin", { defaults: { checkinAdminList: ok(adminList) } }, async ({ page, plan, calls, checkpoint }) => {
    const sections = 'form[aria-label="Confirm administrative action"], section[aria-label="Issued provisioning QR"], section[aria-label="System controls"], article[aria-label^="Station "], section[aria-label="Client bindings"], section[aria-label="Check-in audit"]';
    const system = page.getByRole("region", { name: "System controls" });
    await expect(system.getByRole("heading", { name: "System: enabled for provisioning" })).toBeVisible();
    await expect(system.getByText("Authorization generation 4 · Configuration version 7")).toBeVisible();
    const bindings = page.getByRole("region", { name: "Client bindings" });
    await expect(bindings.getByText("Valid · Recently active · Last seen 2026-09-17T10:00:00Z")).toBeVisible();
    await expect(bindings.getByText("Revoked · Inactive · Last seen Never")).toBeVisible();
    const audit = page.getByRole("region", { name: "Check-in audit" });
    await expect(audit.getByText("configure_event · Event 101 · applied")).toBeVisible();
    await expect(audit.getByText(`set_station_enabled · ${stationIds[1]} · applied`)).toBeVisible();
    await expect(audit.getByText("set_system_enabled · System · applied")).toBeVisible();
    await expect(page.getByRole("button", { name: "Previous bindings" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Next bindings" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Previous audit" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Next audit" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Restore station" })).toHaveCount(1);
    await checkpoint("loaded", sections);
    await page.getByRole("button", { name: "Next bindings" }).click();
    await expect(page.getByRole("button", { name: "Previous bindings" })).toBeEnabled();
    await checkpoint("bindings page two", sections);
    expect(await calls("checkinAdminList")).toEqual([[1, 1], [2, 1]]);

    await system.getByRole("button", { name: "Stop system" }).click();
    const form = page.getByRole("form", { name: "Confirm administrative action" });
    await expect(form.getByRole("heading", { name: "Confirm: Stop system" })).toBeVisible();
    await expect(form.locator("#control-reason")).toBeFocused();
    await expect(page.getByRole("button", { name: "Next bindings" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Previous bindings" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Revoke binding" }).first()).toBeDisabled();
    await checkpoint("stop review", sections);
    await form.locator("#control-reason").selectOption("incident");
    await form.locator("#control-note").fill("pause");
    await plan("checkinAdminControl", ok({ actionId: "c1", replayed: false }));
    await form.getByRole("button", { name: "Confirm action" }).click();
    await expect(page.getByText("Stop system applied. Supervised admission and printing require current station readiness.")).toBeVisible();
    await expect(form).toHaveCount(0);
    await checkpoint("stopped", sections);

    await page.getByRole("article", { name: "Station 1" }).getByRole("button", { name: "Issue replacement QR" }).click();
    await expect(form.getByRole("heading", { name: "Confirm: Issue replacement QR: Station 1" })).toBeVisible();
    await form.locator("#control-reason").selectOption("security");
    await plan("checkinAdminControl", ok({ actionId: "c2", replayed: false, provisionCode: "f".repeat(64), qrDataUrl: `data:image/png;base64,${png}`, provisionUrl: `/checkin/station#provision=${"f".repeat(64)}` }));
    await form.getByRole("button", { name: "Confirm action" }).click();
    const issued = page.getByRole("region", { name: "Issued provisioning QR" });
    await expect(issued.locator("#issued-code")).toHaveValue("f".repeat(64));
    await expect(issued.getByRole("img", { name: "Reusable Station Provisioning QR" })).toBeVisible();
    await checkpoint("qr issued", sections);

    await page.getByRole("article", { name: "Station 2" }).getByRole("button", { name: "Restore station" }).click();
    await expect(form.getByRole("heading", { name: "Confirm: Restore station: Station 2" })).toBeVisible();
    await expect(issued).toHaveCount(0);
    await form.locator("#control-reason").selectOption("operations_restored");
    await plan("checkinAdminControl", ok({ actionId: "c3", replayed: true }));
    await form.getByRole("button", { name: "Confirm action" }).click();
    await expect(page.getByText("This action was already applied. No action was repeated. If the QR response was lost, issue a new replacement QR.")).toBeVisible();

    await bindings.getByRole("button", { name: "Revoke binding" }).first().click();
    await expect(form.getByRole("heading", { name: "Confirm: Revoke binding: binding-a" })).toBeVisible();
    await form.locator("#control-reason").selectOption("security");
    await plan("checkinAdminControl", fail("plain", "Binding changed."));
    await form.getByRole("button", { name: "Confirm action" }).click();
    await expect(page.getByText("Binding changed.", { exact: true })).toBeVisible();
    await expect(form.getByRole("button", { name: "Confirm action" })).toBeEnabled();
    await checkpoint("revoke failed", sections);
    await plan("checkinAdminControl", fail("value", "opaque"));
    await form.getByRole("button", { name: "Confirm action" }).click();
    await expect(page.getByText("Could not confirm the action. Refresh before continuing.")).toBeVisible();
    await page.getByRole("button", { name: "Cancel action" }).click();
    await expect(form).toHaveCount(0);
    await checkpoint("cancelled", sections);
    const commands = (await calls("checkinAdminControl")).map(([command]) => command);
    expect(commands).toEqual([
      { operation: "set_system_enabled", expectedVersion: 7, enabled: false, operationId: "00000000-0000-4000-8000-000000000001", reason: "incident", note: "pause" },
      { operation: "rotate_provision_code", stationId: stationIds[0], expectedVersion: 1, operationId: "00000000-0000-4000-8000-000000000002", reason: "security", note: "" },
      { operation: "set_station_enabled", stationId: stationIds[1], expectedVersion: 2, enabled: true, operationId: "00000000-0000-4000-8000-000000000003", reason: "operations_restored", note: "" },
      { operation: "revoke_binding", bindingId: "binding-a", expectedVersion: 1, operationId: "00000000-0000-4000-8000-000000000004", reason: "security", note: "" },
      { operation: "revoke_binding", bindingId: "binding-a", expectedVersion: 1, operationId: "00000000-0000-4000-8000-000000000004", reason: "security", note: "" },
    ]);
  });
});

void test("monitoring configuration conflicts, reloads, freezes and retries the exact command", async () => {
  await mount("monitoring", { defaults: { dashboard: ok(dashboard()) } }, async ({ page, plan, fallback, calls, checkpoint }) => {
    const region = page.getByRole("region", { name: "Check-in monitoring" });
    await region.getByRole("button", { name: "Edit notification configuration" }).click();
    const save = region.getByRole("button", { name: "Save notification configuration" });
    await expect(save).toBeEnabled();
    await checkpoint("editing");
    await region.getByLabel("two@example.test").check();
    await plan("configure", fail("monitoring", "Monitoring configuration changed. Refresh before reviewing a new action.", { status: 409 }));
    await save.click();
    await expect(region.getByRole("alert")).toHaveText("Configuration rejected. Discard and reload the latest configuration before a new action, or cancel.");
    await expect(save).toBeDisabled();
    await checkpoint("conflict");
    await fallback("dashboard", ok(dashboard(2)));
    await region.getByRole("button", { name: "Discard edits and reload configuration" }).click();
    await expect(region.getByText("Latest configuration loaded. Review before saving a new action.")).toBeVisible();
    await expect(region.getByLabel("two@example.test")).not.toBeChecked();
    await expect(save).toBeEnabled();
    await checkpoint("reloaded");
    await region.getByLabel("Waiting warning (seconds)").fill("45");
    await plan("configure", fail("monitoring", "Monitoring service unavailable. Retry the same action.", { ambiguous: true, status: 503 }));
    await save.click();
    const retry = region.getByRole("button", { name: "Retry same notification configuration" });
    await expect(retry).toBeEnabled();
    await expect(region.getByText("Submitted configuration is frozen.", { exact: false })).toBeVisible();
    await expect(region.getByLabel("Waiting warning (seconds)")).toBeDisabled();
    await checkpoint("frozen");
    await plan("configure", fail("monitoring", "Monitoring command rejected. Check the thresholds and designated admins.", { status: 400 }));
    await retry.click();
    await expect(region.getByText("Monitoring command rejected. Check the thresholds and designated admins.")).toBeVisible();
    await expect(retry).toBeEnabled();
    await expect(region.getByRole("alert")).toHaveCount(0);
    await plan("configure", fail("value", "opaque"));
    await retry.click();
    await expect(region.getByText("Monitoring unavailable. Refresh or retry the same action.")).toBeVisible();
    await fallback("dashboard", ok(dashboard(3)));
    await plan("configure", ok({ ...monitoringConfig, version: 3, waitingMs: 45000 }));
    await retry.click();
    await expect(region.getByText("Notification configuration saved.")).toBeVisible();
    await expect(region.getByRole("button", { name: "Edit notification configuration" })).toBeEnabled();
    await checkpoint("saved");
    const commands = (await calls("configure")).map(([command]) => command);
    expect(commands[0]).toEqual({ operationId: "00000000-0000-4000-8000-000000000001", expectedVersion: 1, recipientUserIds: ["u1", "u2"], waitingMs: 30000, incidentMs: 60000, repeatMs: 900000 });
    expect(commands.slice(1)).toEqual(Array(4).fill({ operationId: "00000000-0000-4000-8000-000000000002", expectedVersion: 2, recipientUserIds: ["u1"], waitingMs: 45000, incidentMs: 60000, repeatMs: 900000 }));
    await region.getByRole("button", { name: "Edit notification configuration" }).click();
    await plan("configure", fail("monitoring", "Monitoring command rejected. Check the thresholds and designated admins.", { status: 400 }));
    await region.getByRole("button", { name: "Save notification configuration" }).click();
    await expect(region.getByRole("alert")).toHaveText("Configuration rejected. Discard and reload the latest configuration before a new action, or cancel.");
    await region.getByRole("button", { name: "Cancel notification editing" }).click();
    await expect(region.getByRole("button", { name: "Save notification configuration" })).toHaveCount(0);
    await checkpoint("cancelled");
  });
});

void test("operator tools keep readiness, event and printer presentation", async () => {
  const defaults = { checkinStatus: ok(phoneStatus(1)), checkinPrinters: ok({ printers: [1, 2, 3].map(printer) }), checkinEventCatalogue: ok(phoneCatalogue(1)), agentStatus: ok(readyAgent(1)) };
  await mount("tools", { defaults }, async ({ page, plan, fallback, calls, checkpoint }) => {
    const sections = '.wts-tools-header, .wts-tools-context, .wts-tools-status, nav[aria-label="Tools views"], #tools-recent > h2, #tools-phone > h2, #checkin-printer, #checkin-printer-help, section[aria-label="This phone\'s event"], #tools-diagnostics > h2, #tools-diagnostics > p, #tools-diagnostics dl, .wts-tools-footer';
    const containers = "#tools-recent, #tools-phone, #tools-diagnostics, #tools-arrivals, main > div[hidden], main > div:not([id])";
    const status = page.locator(".wts-tools-status");
    const readinessText = status.locator("span").first();
    await expect(readinessText).toHaveText("Printer ready");
    await expect(page.locator(".wts-tools-context")).toHaveText("Station 1Synthetic event");
    await checkpoint("ready", sections, containers);
    await page.getByRole("button", { name: "Phone", exact: true }).click();
    const event = page.getByRole("region", { name: "This phone's event" });
    await expect(event).toBeVisible();
    await expect(event.getByText("Current event: Synthetic event")).toBeVisible();
    await expect(event.locator("#phone-checkin-event option")).toHaveText(["Choose an event", "Synthetic event", "Stale event · Stale configuration — refresh and explicitly select again"]);
    await checkpoint("phone view", sections, containers);
    await event.locator("#phone-checkin-event").selectOption(phoneEvents[0].id);
    await plan("selectCheckinEvent", fail("event", "Selection fence changed."));
    await event.getByRole("button", { name: "Select event for this phone" }).click();
    await expect(event.getByRole("alert")).toHaveText("Selection fence changed. Refresh the catalogue and review the current event before choosing again.");
    await checkpoint("event rejected", sections, containers);
    await event.locator("#phone-checkin-event").selectOption(phoneEvents[0].id);
    await plan("selectCheckinEvent", ok(phoneCatalogue(1)));
    await event.getByRole("button", { name: "Select event for this phone" }).click();
    await expect(event.getByText("Event selection saved for this phone only. Other phones and existing work are unchanged.")).toBeVisible();
    await checkpoint("event selected", sections, containers);
    expect(await calls("selectCheckinEvent")).toEqual([[{ eventId: phoneEvents[0].id, eventGeneration: 1, bindingVersion: 1, stationGeneration: 1, systemGeneration: 1, selectionVersion: 1 }], [{ eventId: phoneEvents[0].id, eventGeneration: 1, bindingVersion: 1, stationGeneration: 1, systemGeneration: 1, selectionVersion: 1 }]]);

    await fallback("checkinStatus", ok(phoneStatus(2)));
    await fallback("checkinEventCatalogue", ok(phoneCatalogue(2)));
    await fallback("agentStatus", ok(readyAgent(2, { readyForAuthorization: false, journal: "quarantined" })));
    await plan("selectCheckinPrinter", ok(phoneStatus(2)));
    await page.locator("#checkin-printer").selectOption(stationIds[1]);
    await expect(page.locator(".wts-tools-context strong")).toHaveText("Station 2");
    await expect(readinessText).toHaveText("Station needs review");
    await expect(page.locator("#checkin-printer")).toHaveValue(stationIds[1]);
    await checkpoint("printer two", sections, containers);
    expect(await calls("selectCheckinPrinter")).toEqual([[printer(2).confirmation, "adminuser000001"]]);

    await page.getByRole("button", { name: "Details" }).click();
    await expect(page.getByRole("region", { name: "Diagnostics" })).toBeVisible();
    await page.getByRole("button", { name: "Refresh readiness" }).click();
    const refresh = async (label, expected) => {
      await expect(page.getByRole("button", { name: "Refresh readiness" })).toBeEnabled();
      await page.getByRole("button", { name: "Refresh readiness" }).click();
      await expect(readinessText).toHaveText(expected);
      await checkpoint(label, sections, containers);
    };
    const agentCases = [
      [{ readyForAuthorization: false, credentialState: "expired" }, "Station session expired"],
      [{ readyForAuthorization: false, profile: "unapproved" }, "Label profile needs approval"],
      [{ readyForAuthorization: false, coordinator: "unavailable" }, "Coordinator offline"],
      [{ readyForAuthorization: false }, "Station needs attention"],
      [{ readyForAuthorization: false, connection: "stale" }, "Printer agent unavailable"],
      [{ readyForAuthorization: true, journal: "quarantined" }, "Printer ready"],
    ];
    for (const [extra, expected] of agentCases) {
      await fallback("agentStatus", ok(readyAgent(2, extra)));
      await refresh(`agent ${expected}`, expected);
    }
    for (const [extra, expected] of [[{ station: { ...phoneStatus(2).station, enabled: false } }, "Station disabled"], [{ system: { ...phoneStatus(2).system, enabled: false } }, "System stopped"], [{ bindingState: "revoked" }, "Phone revoked · ask an admin"], [{ bindingState: "unbound", binding: null, station: null }, "Choose a printer"]]) {
      await fallback("checkinStatus", ok(phoneStatus(2, extra)));
      await refresh(`status ${expected}`, expected);
    }
    await fallback("checkinStatus", fail("plain", "Synthetic unavailable"));
    await page.getByRole("button", { name: "Refresh readiness" }).click();
    await expect(readinessText).toHaveText("Connection lost · verify station");
    await expect(page.locator(".wts-tools-context")).toHaveText("Station unverifiedEvent unverified");
    await checkpoint("connection lost", sections, containers);
    await fallback("checkinStatus", ok(phoneStatus(2)));
    await status.getByRole("button", { name: "Refresh station status" }).click();
    await expect(readinessText).toHaveText("Printer ready");
    await checkpoint("recovered", sections, containers);
  });
});
