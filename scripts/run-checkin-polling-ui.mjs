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
import CheckinStationPage from "~/components/checkin/CheckinStationPage";
import CheckinToolsPage from "~/components/checkin/CheckinToolsPage";
import { BoundAgentReadiness } from "~/components/checkin/AgentReadiness";
import { CheckinMonitoringPanel } from "~/components/checkin/checkin-monitoring";
import { CheckinEventAdmin } from "~/components/checkin/CheckinEventAdmin";
import "~/styles/app.css";
const mode = new URLSearchParams(location.search).get("mode");
render(() => <Head>{mode === "agent" ? <BoundAgentReadiness stationId="wts2026station1" /> : mode === "monitoring" ? <CheckinMonitoringPanel audience="admin" readiness={[]} /> : mode === "station" ? <CheckinStationPage /> : mode === "tools" ? <CheckinToolsPage /> : mode === "events" ? <CheckinEventAdmin /> : <CheckinScannerPage />}</Head>, document.getElementById("app"));
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
let browser;
const failures = [];
try {
  browser = await chromium.launch({ headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  for (const mode of (process.env.CHECKIN_POLLING_MODES || "agent,monitoring,station,tools,scanner,events").split(",")) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    let gate = false, denied = false, changed = false, held = [], reads = 0;
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      const body = route.request().postDataJSON();
      let json;
      if (path === "/api/checkin") { assert.equal(body.operation, "status"); json = { ...status, station: { ...status.station, label: changed ? "Changed synthetic station" : status.station.label } }; }
      else if (path === "/api/checkin-agents") { assert.equal(body.operation, "status"); json = { station: { ...agent, connection: changed ? "stale" : "connected" } }; }
      else if (path === "/api/checkin-events") {
        if (mode !== "events") { assert.equal(body.operation, "catalogue"); json = catalogue; }
        else if (body.operation === "admin_catalogue") json = { state: "complete", sourceMismatch: false, events: [{ upstreamEventId: "123", title: changed ? "Changed synthetic event" : "Synthetic event", upstreamAvailable: true, configuration: null }] };
        else { assert.equal(body.operation, "admin_options"); assert.equal(body.upstreamEventId, "123"); json = { state: "complete", lists: [{ id: "456", title: changed ? "Changed synthetic admission" : "Synthetic admission" }], questions: [], products: [] }; }
      }
      else if (path === "/api/checkin-monitoring") { assert.equal(body.operation, "dashboard"); json = { ...dashboard, incidents: changed ? [{ ...incident, acknowledgedMs: 1 }] : [incident] }; }
      else if (path === "/api/checkin-recovery") { assert.equal(body.operation, "history"); json = { items: [], nextOffset: null }; }
      else if (path === "/api/checkin-arrivals") { assert.equal(body.operation, "history"); json = { items: [], nextCursor: null, day: "2026-09-14" }; }
      else throw new Error(`Unexpected fixture request ${path}: ${body.operation}`);
      reads++;
      if (gate) { held.push({ route, json }); return; }
      return route.fulfill({ status: denied ? 403 : 200, json: denied ? { error: "Synthetic access denied" } : json });
    });
    try {
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?mode=${mode}`);
      let target;
      if (mode === "agent") { await expect(page.getByRole("heading", { name: "Agent readiness · Synthetic station" })).toBeVisible(); target = page.getByRole("button", { name: "Refresh agent readiness", exact: true }); }
      else if (mode === "monitoring") { target = page.getByRole("button", { name: `Acknowledge incident ${incident.id}`, exact: true }); }
      else if (mode === "tools") { await page.getByRole("button", { name: "Phone", exact: true }).click(); target = page.getByLabel("Event for this phone", { exact: true }); }
      else if (mode === "station") { target = page.getByLabel("Event for this phone", { exact: true }); }
      else if (mode === "events") { await page.getByLabel("Hi.Events event", { exact: true }).selectOption("123"); target = page.getByLabel("Admission list (required when enabled)", { exact: true }); await target.selectOption("456"); }
      else { target = page.getByRole("button", { name: "Find attendee", exact: true }); }
      await expect(target).toBeEnabled();
      if (mode === "station" || mode === "tools") await target.selectOption(event.id);
      await target.focus();
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
      const before = reads;
      gate = true;
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect.poll(() => held.length).toBeGreaterThan(0);
      // This is an intentional sampling window, not a readiness sleep.
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 350)));
      gate = false;
      for (const item of held.splice(0)) await item.route.fulfill({ json: item.json });
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 150)));
      const frames = await page.evaluate(() => { window.__pollFrames.running = false; return window.__pollFrames; });
      assert.ok(reads > before); assert.ok(frames.frames > 5);
      assert.deepEqual(frames.bad, [], `${mode}: transient poll changed presentation, focus, control state or identity`);
      // A real returned change must still be visible, then denial must redact it.
      changed = true;
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      if (mode === "agent") await expect(page.getByText("stale", { exact: true })).toBeVisible();
      if (mode === "monitoring") await expect(target).toHaveCount(0);
      if (mode === "events") { await expect(page.getByRole("option", { name: "Changed synthetic event · ID 123", exact: true })).toHaveCount(1); await expect(page.getByRole("option", { name: "Changed synthetic admission · ID 456", exact: true })).toHaveCount(1); }
      if (mode === "station" || mode === "tools" || mode === "scanner") await expect(page.getByText("Changed synthetic station", { exact: true })).toBeVisible();
      denied = true;
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      if (mode === "agent") await expect(page.getByRole("heading", { name: "Agent readiness · Synthetic station" })).toHaveCount(0);
      else if (mode === "monitoring") await expect(page.getByRole("list", { name: "Monitoring incidents" })).toHaveCount(0);
      else if (mode === "scanner") await expect(page.locator(".wts-operator-status")).toContainText("Connection lost");
      else if (mode === "events") { await expect(page.getByLabel("Hi.Events event", { exact: true })).toHaveCount(0); await expect(target).toHaveCount(0); }
      else await expect(page.getByLabel("Event for this phone", { exact: true })).toHaveCount(0);
      // A delayed retry cannot resurrect previously denied data.
      gate = true; held = [];
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      if (mode === "agent") await page.getByRole("button", { name: "Refresh agent readiness", exact: true }).click();
      await expect.poll(() => held.length).toBeGreaterThan(0);
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
      if (mode === "monitoring") await expect(page.getByRole("list", { name: "Monitoring incidents" })).toHaveCount(0);
      if (mode === "agent") await expect(page.getByRole("heading", { name: "Agent readiness · Synthetic station" })).toHaveCount(0);
      if (mode === "scanner") await expect(page.locator(".wts-operator-status")).toContainText("Connection lost");
      if (mode === "station" || mode === "tools") await expect(page.getByLabel("Event for this phone", { exact: true })).toHaveCount(0);
      if (mode === "events") { await expect(page.getByLabel("Hi.Events event", { exact: true })).toHaveCount(0); await expect(target).toHaveCount(0); }
      for (const item of held.splice(0)) await item.route.fulfill({ status: 403, json: { error: "Synthetic access denied" } });
      assert.deepEqual(errors, []);
      console.log(`PASS ${mode}: ${frames.frames} stable frames; changed response and denied retry checked`);
    } catch (error) { failures.push(mode); console.error(`FAIL ${mode}`, error); }
    finally { await page.close(); }
  }
} finally { await browser?.close(); await server.close(); }
assert.deepEqual(failures, [], "check-in polling UI regressions");
