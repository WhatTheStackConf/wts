// Real mounted check-in components and clients; disposable loopback transport.
// Capture every animation frame, including the delayed request and settlement.
import { createServer } from "vite";
import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { chromium, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../", import.meta.url));
const fixtureId = `${root}tests/__checkin-polling-fixture.tsx`;
const authId = `${root}tests/__checkin-polling-auth.ts`;
const fixture = `
import { render } from "@solidjs/web";
import { Head } from "@solidjs/meta";
import CheckinScannerPage from "~/components/checkin/CheckinScannerPage";
import CheckinToolsPage from "~/components/checkin/CheckinToolsPage";
import { BoundAgentReadiness } from "~/components/checkin/AgentReadiness";
import { CheckinMonitoringPanel } from "~/components/checkin/checkin-monitoring";
import { CheckinEventAdmin } from "~/components/checkin/CheckinEventAdmin";
import "~/styles/app.css";
const mode = new URLSearchParams(location.search).get("mode");
render(() => <Head>{mode === "agent" ? <BoundAgentReadiness stationId="wts2026station1" /> : mode === "monitoring" ? <CheckinMonitoringPanel audience="admin" readiness={[]} /> : mode === "tools" ? <CheckinToolsPage /> : mode === "events" ? <CheckinEventAdmin /> : <CheckinScannerPage />}</Head>, document.getElementById("app"));
`;
const auth = `const user = {id:"uuuuuuuuuuuuuuu",role:"admin",name:"Synthetic operator"}; export const useRequireCheckinOperator = () => ({authorized:()=>true,user:()=>user}); export const useAuth=()=>({user,logout:async()=>{}});`;
const server = await createServer({ configFile: false, root, plugins: [tailwindcss(), solid({ ssr: false }), {
  name: "checkin-polling-fixture",
  resolveId(id) { if (id === "/__checkin-polling-fixture.tsx") return fixtureId; if (id === authId) return authId; },
  load(id) { if (id === fixtureId) return fixture; if (id === authId) return auth; },
  configureServer(server) { server.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith("/?mode=")) return next();
    res.setHeader("Content-Type", "text/html");
    res.end(await server.transformIndexHtml("/", '<!doctype html><html><body><div id="app"></div><script type="module" src="/__checkin-polling-fixture.tsx"></script></body></html>'));
  }); },
}], resolve: { alias: [ { find: "~/lib/auth-context", replacement: authId }, { find: "~/lib/route-guards", replacement: authId }, { find: "~", replacement: `${root}src` } ] }, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
await server.listen();
const stationId = "wts2026station1";
const agent = { stationId, stationLabel: "Synthetic station", stationVersion: 1, agentId: "fixture-agent", credentialState: "active", credentialExpiresAt: null, connection: "connected", compatibility: "compatible", profile: "approved", journal: "healthy", stopped: false, coordinator: "connected", readyForAuthorization: true, operationsEnabled: false, reasons: [], lastHeartbeatAt: null, heartbeatIntervalMs: 5000, heartbeatTimeoutMs: 15000, authorizationTtlMs: 5000 };
const status = { system: { enabled: true, generation: 1 }, bindingState: "bound", binding: { id: "bbbbbbbbbbbbbbb", version: 1, stationId, revoked: false }, station: { id: stationId, label: "Synthetic station", enabled: true, generation: 1, version: 1, location: "Fixture desk", printerRef: "fixture-printer", activeBindingCount: 1, unreadyReasons: [], multiplePhonesWarning: false } };
const event = { id: "eeeeeeeeeeeeeee", title: "Synthetic event", availability: "available", generation: 1 };
const fence = { bindingVersion: 1, stationGeneration: 1, systemGeneration: 1, selectionVersion: 1 };
const catalogue = { state: "complete", events: [event], selected: event, fence, context: { ...fence, bindingId: status.binding.id, stationId, eventId: event.id, eventGeneration: 1 } };
const incident = { id: "iiiiiiiiiiiiiii", stationId, workflowId: null, category: "station_unavailable", sinceMs: 1, openedMs: 1, recoveredMs: 0, acknowledgedMs: 0, nextDeliveryMs: 0, delivery: "none", deliveryKind: null, nextAction: "none" };
const dashboard = { scope: "all", lastTickMs: Date.now(), recipientsConfigured: true, hasMore: true, incidents: [incident], config: { version: 1, waitingMs: 1000, incidentMs: 2000, repeatMs: 900000, recipientUserIds: [] }, adminChoices: [], audit: [] };
const failures = [];
function checkinStatus(body, fixture) {
  const current = { ...status, station: { ...status.station, label: fixture.changed ? "Changed synthetic station" : status.station.label } };
  if (body.operation === "status") return current;
  assert.equal(body.operation, "printers");
  return { printers: [{ station: current.station, system: current.system, canBind: true, confirmation: { stationId, stationVersion: 1, bindingVersion: 1, systemGeneration: 1 } }] };
}
function checkinEvents(body, fixture, mode) {
  if (mode !== "events") { assert.equal(body.operation, "catalogue"); return catalogue; }
  if (body.operation === "admin_catalogue") return { state: "complete", sourceMismatch: false, events: [{ upstreamEventId: "123", title: fixture.changed ? "Changed synthetic event" : "Synthetic event", upstreamAvailable: true, configuration: null }] };
  assert.equal(body.operation, "admin_options"); assert.equal(body.upstreamEventId, "123");
  return { state: "complete", lists: [{ id: "456", title: fixture.changed ? "Changed synthetic admission" : "Synthetic admission" }], questions: [], products: [] };
}
const pollingEndpoints = {
  "/api/checkin": checkinStatus,
  "/api/checkin-agents": (body, fixture) => { assert.equal(body.operation, "status"); return { station: { ...agent, connection: fixture.changed ? "stale" : "connected" } }; },
  "/api/checkin-events": checkinEvents,
  "/api/checkin-monitoring": (body, fixture) => { assert.equal(body.operation, "dashboard"); return { ...dashboard, incidents: fixture.changed ? [{ ...incident, acknowledgedMs: 1 }] : [incident] }; },
  "/api/checkin-recovery": body => { assert.equal(body.operation, "history"); return { items: [], nextOffset: null }; },
  "/api/checkin-arrivals": body => { assert.equal(body.operation, "history"); return { items: [], nextCursor: null, day: "2026-09-14" }; },
};
function pollingResponse(path, body, fixture, mode) {
  if (!Object.hasOwn(pollingEndpoints, path)) throw new Error(`Unexpected fixture request ${path}: ${body.operation}`);
  return pollingEndpoints[path](body, fixture, mode);
}
const agentHeading = page => page.getByRole("heading", { name: "Agent readiness · Synthetic station" });
const refreshAgent = page => page.getByRole("button", { name: "Refresh agent readiness", exact: true });
const phoneEvent = page => page.getByLabel("Event for this phone", { exact: true });
const hiEventsEvent = page => page.getByLabel("Hi.Events event", { exact: true });
const monitoringIncidents = page => page.getByRole("list", { name: "Monitoring incidents" });
const findAttendee = async page => page.getByRole("button", { name: "Find attendee", exact: true });
const unchanged = async () => {};
const changedStation = page => expect(page.getByText("Changed synthetic station", { exact: true })).toBeVisible();
const connectionLost = page => expect(page.locator(".wts-operator-status")).toContainText("Connection lost");
const phoneEventGone = page => expect(phoneEvent(page)).toHaveCount(0);
const agentGone = page => expect(agentHeading(page)).toHaveCount(0);
const incidentsGone = page => expect(monitoringIncidents(page)).toHaveCount(0);
async function eventsGone(page, target) { await expect(hiEventsEvent(page)).toHaveCount(0); await expect(target).toHaveCount(0); }
async function eventOptionsChanged(page) {
  await expect(page.getByRole("option", { name: "Changed synthetic event · ID 123", exact: true })).toHaveCount(1);
  await expect(page.getByRole("option", { name: "Changed synthetic admission · ID 456", exact: true })).toHaveCount(1);
}
async function admissionTarget(page) {
  await hiEventsEvent(page).selectOption("123");
  const target = page.getByLabel("Admission list (required when enabled)", { exact: true });
  await target.selectOption("456");
  return target;
}
async function agentTarget(page) { await expect(agentHeading(page)).toBeVisible(); return refreshAgent(page); }
async function toolsTarget(page) { await page.getByRole("button", { name: "Phone", exact: true }).click(); return phoneEvent(page); }
const pollingModes = {
  agent: { target: agentTarget, changed: page => expect(page.getByText("stale", { exact: true })).toBeVisible(), denied: agentGone, retry: page => refreshAgent(page).click(), retried: agentGone },
  monitoring: { target: async page => page.getByRole("button", { name: `Acknowledge incident ${incident.id}`, exact: true }), changed: (page, target) => expect(target).toHaveCount(0), denied: incidentsGone, retried: incidentsGone },
  tools: { target: toolsTarget, selectsEvent: true, changed: changedStation, denied: phoneEventGone, retried: phoneEventGone },
  events: { target: admissionTarget, changed: eventOptionsChanged, denied: eventsGone, retried: eventsGone },
  scanner: { target: findAttendee, changed: changedStation, denied: connectionLost, retried: connectionLost },
};
const otherMode = { target: findAttendee, changed: unchanged, denied: phoneEventGone, retried: unchanged };
async function sampleFrames(page, target) {
  const handle = await target.elementHandle();
  await handle.evaluate(element => {
    const box = () => { const r = element.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
    const baseline = { text: document.getElementById("app").innerText, box: box(), height: document.documentElement.scrollHeight, y: scrollY, value: element.value };
    window.__pollFrames = { baseline, bad: [], frames: 0, running: true };
    function sample() {
      const s = window.__pollFrames; s.frames++;
      const current = { text: document.getElementById("app").innerText, box: box(), height: document.documentElement.scrollHeight, y: scrollY, value: element.value };
      if (!element.isConnected || element.disabled || document.activeElement !== element || JSON.stringify(current) !== JSON.stringify(baseline)) {
        if (s.bad.length < 4) s.bad.push({ connected: element.isConnected, disabled: element.disabled, focused: document.activeElement === element, baseline, current });
      }
      if (s.running) requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
}
const focusWindow = page => page.evaluate(() => window.dispatchEvent(new Event("focus")));
async function stableHeldPoll(page, fixture, mode) {
  const before = fixture.reads;
  fixture.gate = true;
  await focusWindow(page);
  await expect.poll(() => fixture.held.length).toBeGreaterThan(0);
  // This is an intentional sampling window, not a readiness sleep.
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 350)));
  fixture.gate = false;
  for (const item of fixture.held.splice(0)) await item.route.fulfill({ json: item.json });
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 150)));
  const frames = await page.evaluate(() => { window.__pollFrames.running = false; return window.__pollFrames; });
  assert.ok(fixture.reads > before); assert.ok(frames.frames > 5);
  assert.deepEqual(frames.bad, [], `${mode}: transient poll changed presentation, focus, control state or identity`);
  return frames;
}
async function deniedRetry(page, fixture, behavior, target) {
  // A delayed retry cannot resurrect previously denied data.
  fixture.gate = true; fixture.held = [];
  await focusWindow(page);
  await behavior.retry?.(page);
  await expect.poll(() => fixture.held.length).toBeGreaterThan(0);
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
  await behavior.retried(page, target);
  for (const item of fixture.held.splice(0)) await item.route.fulfill({ status: 403, json: { error: "Synthetic access denied" } });
}
async function checkMode(browser, mode) {
  const behavior = Object.hasOwn(pollingModes, mode) ? pollingModes[mode] : otherMode;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  const fixture = { gate: false, denied: false, changed: false, held: [], reads: 0 };
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON();
    const json = pollingResponse(path, body, fixture, mode);
    fixture.reads++;
    if (fixture.gate) { fixture.held.push({ route, json }); return; }
    return route.fulfill({ status: fixture.denied ? 403 : 200, json: fixture.denied ? { error: "Synthetic access denied" } : json });
  });
  try {
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?mode=${mode}`);
    const target = await behavior.target(page);
    await expect(target).toBeEnabled();
    if (behavior.selectsEvent) await target.selectOption(event.id);
    await target.focus();
    await sampleFrames(page, target);
    const frames = await stableHeldPoll(page, fixture, mode);
    // A real returned change must still be visible, then denial must redact it.
    fixture.changed = true;
    await focusWindow(page);
    await behavior.changed(page, target);
    fixture.denied = true;
    await focusWindow(page);
    await behavior.denied(page, target);
    await deniedRetry(page, fixture, behavior, target);
    assert.deepEqual(errors, []);
    console.log(`PASS ${mode}: ${frames.frames} stable frames; changed response and denied retry checked`);
  } catch (error) { failures.push(mode); console.error(`FAIL ${mode}`, error); }
  finally { await page.close(); }
}
async function main() {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
    for (const mode of (process.env.CHECKIN_POLLING_MODES || "agent,monitoring,tools,scanner,events").split(",")) await checkMode(browser, mode);
  } finally { await browser?.close(); await server.close(); }
  assert.deepEqual(failures, [], "check-in polling UI regressions");
}
await main();
