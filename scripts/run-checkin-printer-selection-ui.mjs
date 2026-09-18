// Mounted production components/clients; synthetic loopback API and camera only.
// This proves UI behavior, not backend binding, admission, or printer effects.
import { createServer } from "vite";
import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { chromium, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import QRCode from "qrcode";
const root = process.env.CHECKIN_PRINTER_SELECTION_SOURCE ? process.env.CHECKIN_PRINTER_SELECTION_SOURCE.replace(/\/$/, "") + "/" : fileURLToPath(new URL("../", import.meta.url));
const fixtureId = `${root}tests/__checkin-printer-selection-fixture.tsx`;
const authId = `${root}tests/__checkin-printer-selection-auth.ts`;
const fixture = `
import { render } from "@solidjs/web";
import { Head } from "@solidjs/meta";
import CheckinScannerPage from "~/components/checkin/CheckinScannerPage";
import CheckinToolsPage from "~/components/checkin/CheckinToolsPage";
import "~/styles/app.css";
const mode = new URLSearchParams(location.search).get("mode");
window.unmountFixture = render(() => <Head>{mode === "tools" ? <CheckinToolsPage /> : <CheckinScannerPage />}</Head>, document.getElementById("app"));
`;
const auth = `import { createSignal } from "solid-js";
const [user, setUser] = createSignal({id:"uuuuuuuuuuuuuuu",role:"admin",name:"Synthetic operator"});
window.setFixtureUser = setUser;
export const useRequireCheckinOperator = () => ({authorized:()=>!!user() && ["admin","checkin_operator"].includes(user().role),user});
export const useAuth=()=>({get user(){return user()},logout:async()=>{}});`;
const server = await createServer({ configFile: false, root, plugins: [tailwindcss(), solid({ ssr: false }), {
  name: "checkin-printer-selection-fixture",
  resolveId(id) { if (id === "/__checkin-printer-selection-fixture.tsx") return fixtureId; if (id === authId) return authId; },
  load(id) { if (id === fixtureId) return fixture; if (id === authId) return auth; },
  configureServer(server) { server.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith("/?mode=")) return next();
    res.setHeader("Content-Type", "text/html");
    res.end(await server.transformIndexHtml("/", '<!doctype html><html><body><div id="app"></div><script type="module" src="/__checkin-printer-selection-fixture.tsx"></script></body></html>'));
  }); },
}], resolve: { alias: [ { find: "~/lib/auth-context", replacement: authId }, { find: "~/lib/route-guards", replacement: authId }, { find: "~", replacement: `${root}src` } ] }, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const stationId = "wts2026station1", code2 = "2".repeat(64), code3 = "3".repeat(64);
const agent = { stationId, stationLabel: "Station 1", stationVersion: 1, agentId: "fixture-agent", credentialState: "active", credentialExpiresAt: null, connection: "connected", compatibility: "compatible", profile: "approved", journal: "healthy", stopped: false, coordinator: "connected", readyForAuthorization: true, operationsEnabled: false, reasons: [], lastHeartbeatAt: null, heartbeatIntervalMs: 5000, heartbeatTimeoutMs: 15000, authorizationTtlMs: 5000 };
const initialStatus = { system: { edition: "WTS2026", enabled: true, generation: 1, version: 1 }, bindingState: "bound", binding: { id: "bbbbbbbbbbbbbbb", version: 1, stationId, revoked: false, active: true, lastSeenAt: "2026-09-17" }, station: { id: stationId, edition: "WTS2026", label: "Station 1", enabled: true, generation: 1, version: 1, location: "Fixture desk", printerRef: "fixture-printer", activeBindingCount: 1, unreadyReasons: [], multiplePhonesWarning: false, provisionCodeIssued: true, ready: false }, operationsEnabled: false, activeWindowSeconds: 300 };
const event = { id: "eeeeeeeeeeeeeee", title: "Synthetic event", availability: "available", generation: 1 };
const person = { attendeeId: "21", publicId: "A-REPAIR1", name: "Synthetic Attendee", email: "synthetic@example.test" };
const failures = [];
let browser, passed = 0;
const button = (page, name) => page.getByRole("button", { name, exact: true });
async function frames(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function syntheticCamera(page) {
  await page.addInitScript(() => {
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const actual = await getUserMedia(constraints); actual.getTracks().forEach(track => track.stop());
      const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "white"; ctx.fillRect(0, 0, 640, 480);
      window.syntheticCanvas = canvas;
      const stream = canvas.captureStream(12), timer = setInterval(() => ctx.drawImage(canvas, 0, 0), 80);
      stream.getTracks().forEach(track => { const stop = track.stop.bind(track); track.stop = () => { clearInterval(timer); stop(); }; });
      return stream;
    };
    Object.defineProperty(window, "BarcodeDetector", { value: undefined, configurable: true });
  });
}
async function showQr(page, text) {
  const data = await QRCode.toDataURL(text, { width: 360, margin: 4 });
  await page.evaluate(async data => {
    const image = new Image(); image.src = data; await image.decode();
    window.syntheticCanvas.getContext("2d").drawImage(image, 140, 60, 360, 360);
  }, data);
}
async function scenario(name, mode, run) {
  if (process.env.CHECKIN_PRINTER_SELECTION_CASE && !new RegExp(process.env.CHECKIN_PRINTER_SELECTION_CASE).test(`${mode}: ${name}`)) return;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [], calls = [], held = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) errors.push(message.text()); });
  const state = { status: structuredClone(initialStatus), holdSelect: false, holdArrival: false, loseSelect: false, holdReads: false, failStatus: false, denyCatalogue: false, arrival: undefined };
  const context = () => ({ protocolVersion: 1, edition: "WTS2026", bindingId: state.status.binding?.id, bindingVersion: state.status.binding?.version, stationId: state.status.station?.id, stationGeneration: 1, systemGeneration: 1, eventId: event.id, eventGeneration: 1, selectionVersion: 1 });
  const printer = n => ({ system: state.status.system, station: { ...initialStatus.station, id: `wts2026station${n}`, label: `Printer ${n}`, enabled: n !== 3, printerRef: `fixture-printer-${n}` }, canBind: n !== 3, confirmation: { stationId: `wts2026station${n}`, stationVersion: 1, bindingVersion: state.status.binding?.version ?? null, systemGeneration: 1 } });
  const count = operation => calls.filter(call => call.operation === operation).length;
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) { errors.push(`Unexpected external request ${url.origin}`); return route.abort(); }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const body = route.request().postDataJSON(); calls.push(body);
    let json;
    try {
      if (url.pathname === "/api/checkin") {
        if (body.operation === "status") {
          if (state.failStatus) return route.fulfill({ status: 503, json: { error: "Synthetic unavailable" } });
          json = state.status;
        } else if (body.operation === "printers") {
          if (state.denyCatalogue) return route.fulfill({ status: 403, json: { error: "Synthetic denial" } });
          json = { printers: [1, 2, 3].map(printer) };
        } else if (body.operation === "select_printer") {
          const target = [1, 2].map(printer).find(p => p.station.id === body.confirmation.stationId);
          assert.ok(target); assert.deepEqual(body.confirmation, target.confirmation);
          state.status = { ...state.status, bindingState: "bound", binding: { ...initialStatus.binding, version: (state.status.binding?.version ?? 0) + 1, stationId: target.station.id }, station: target.station };
          json = state.status;
          if (state.holdSelect) { held.push({ route, json, operation: body.operation }); return; }
          if (state.loseSelect) return route.abort();
        } else throw Error(`Unexpected checkin operation ${body.operation}`);
      } else if (url.pathname === "/api/checkin-events") {
        assert.equal(body.operation, "catalogue");
        json = { state: "complete", events: [event], selected: event, fence: { bindingVersion: state.status.binding?.version, stationGeneration: 1, systemGeneration: 1, selectionVersion: 1 }, context: context() };
      } else if (url.pathname === "/api/checkin-agents") { assert.equal(body.operation, "status"); json = { station: { ...agent, stationId: state.status.station?.id } }; }
      else if (url.pathname === "/api/checkin-recovery") { assert.equal(body.operation, "history"); json = { items: [], nextOffset: null }; }
      else if (url.pathname === "/api/checkin-arrivals") {
        if (body.operation === "preflight") { state.arrival = body.command; json = { state: "dependency_unavailable", operationId: body.command.operationId, replayed: false, operationsEnabled: false }; if (state.holdArrival) { held.push({ route, json, operation: body.operation }); return; } }
        else if (body.operation === "status") json = { operationId: body.operationId, result: { state: "dependency_unavailable" }, operationsEnabled: false };
        else if (body.operation === "history") json = { items: [], nextCursor: null, day: "2026-09-17", operationsEnabled: false };
        else throw Error(`Unexpected arrivals operation ${body.operation}`);
      } else if (url.pathname === "/api/checkin-arrival-resume") {
        assert.equal(body.operation, "get"); return route.fulfill({ status: 404, json: { error: "Synthetic held work requires recovery" } });
      } else if (url.pathname === "/api/checkin-lookup") {
        if (body.operation === "recovery_get") return route.fulfill({ status: 404, json: { error: "Synthetic held work requires recovery" } });
        if (body.operation === "search") json = { state: "complete", context: body.input.context, items: [person], nextOffset: null };
        else if (body.operation === "confirm") { held.push({ route, json: { state: "accepted" }, operation: body.operation }); return; }
        else throw Error(`Unexpected lookup operation ${body.operation}`);
      } else throw Error(`Unexpected endpoint ${url.pathname}`);
      if (state.holdReads) { held.push({ route, json, operation: body.operation }); return; }
      await route.fulfill({ json });
    } catch (error) { errors.push(error.message); await route.abort(); }
  });
  const open = async () => {
    await page.goto(`${base}/?mode=${mode}`);
    if (mode === "tools") await button(page, "Phone").click();
  };
  const picker = page.getByRole("combobox", { name: "Printer", exact: true });
  try {
    await run({ page, state, calls, held, count, open, picker });
    await frames(page); assert.deepEqual(errors, []);
    assert.equal(count("bind"), 0); assert.equal(count("preview"), 0);
    console.log(`PASS ${mode}: ${name}`); passed++;
  } catch (error) { failures.push(`${mode}: ${name}`); console.error(`FAIL ${mode}: ${name}`, error); }
  finally {
    state.holdReads = false;
    for (const item of held.splice(0)) await item.route.fulfill({ json: item.json });
    await page.unrouteAll({ behavior: "wait" }); await page.close();
  }
}
try {
  browser = await chromium.launch({ headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  for (const mode of ["scanner", "tools"]) {
    for (const change of ["actor", "unmount"]) await scenario(`queued choice is cancelled on ${change} before the Web Lock releases`, mode, async ({ page, count, open, picker }) => {
      await open(); await expect(picker).toBeEnabled();
      await page.evaluate(() => new Promise(resolve => {
        const gate = new Promise(release => { window.releasePrinterLock = release; });
        void navigator.locks.request("wts-checkin-client-preview", async () => { resolve(); await gate; });
      }));
      await picker.selectOption("wts2026station2"); await expect(picker).toBeDisabled();
      assert.equal(count("select_printer"), 0);
      await page.evaluate(change => {
        if (change === "actor") window.setFixtureUser({ id: "vvvvvvvvvvvvvvv", role: "checkin_operator" });
        else window.unmountFixture();
      }, change);
      await frames(page);
      await page.evaluate(() => window.releasePrinterLock());
      if (change === "actor") { await expect(picker).toBeEnabled(); await expect(picker).toHaveValue("wts2026station1"); }
      else await frames(page);
      assert.equal(count("select_printer"), 0);
    });
    await scenario("unbound operator selects printer1 then printer2 immediately", mode, async ({ page, state, count, open, picker }) => {
      state.status = { ...state.status, bindingState: "unbound", binding: null, station: null };
      await open(); await expect(picker).toBeEnabled(); await expect(picker).toHaveValue("");
      assert.equal(count("select_printer"), 0);
      await expect(page.getByText(/Scan.*station QR|Review station|Confirm station/)).toHaveCount(0);
      await expect(picker.locator('option[value="wts2026station3"]')).toBeDisabled();
      await picker.selectOption("wts2026station1"); await expect(picker).toBeEnabled(); await expect(picker).toHaveValue("wts2026station1");
      await picker.selectOption("wts2026station2"); await expect(picker).toBeEnabled(); await expect(picker).toHaveValue("wts2026station2");
      assert.equal(count("select_printer"), 2);
      await expect(page.getByText("Selected · physical printer readiness is checked separately.", { exact: true })).toBeVisible();
    });
    await scenario("lost selection response rereads actual status without retry", mode, async ({ page, state, count, open, picker }) => {
      await open(); await expect(picker).toBeEnabled();
      const reads = count("status"); state.loseSelect = true;
      await picker.selectOption("wts2026station2");
      await expect(picker).toHaveValue("wts2026station2"); await expect(picker).toBeEnabled();
      assert.ok(count("status") > reads); assert.equal(count("select_printer"), 1);
      await expect(page.getByRole("button", { name: /Confirm.*printer|Review.*printer/i })).toHaveCount(0);
    });
    await scenario("unverified lost response blocks intake until explicit status check", mode, async ({ page, state, count, open, picker }) => {
      await open(); await expect(picker).toBeEnabled();
      state.loseSelect = true; state.failStatus = true;
      await picker.selectOption("wts2026station2");
      await expect(button(page, "Check selected printer")).toBeVisible(); await expect(picker).toBeDisabled();
      if (mode === "scanner") await expect(button(page, "Start scanning")).toHaveCount(0);
      else await expect(button(page, "Arrivals")).toBeDisabled();
      state.failStatus = false;
      await button(page, "Check selected printer").click();
      await expect(picker).toHaveValue("wts2026station2"); await expect(picker).toBeEnabled();
      assert.equal(count("select_printer"), 1);
    });
    await scenario("pending selection blocks capture/event changes even when a poll overtakes it", mode, async ({ page, state, held, count, open, picker }) => {
      await open(); await expect(picker).toBeEnabled(); state.holdSelect = true;
      await picker.selectOption("wts2026station2"); await expect.poll(() => held.length).toBe(1);
      await expect(picker).toBeDisabled();
      if (mode === "scanner") {
        await expect(button(page, "Start scanning")).toBeDisabled();
        await expect(page.locator("#scan-event")).toBeDisabled();
        await expect(button(page, "Find attendee")).toBeDisabled();
      } else await expect(page.getByLabel("Event for this phone", { exact: true })).toBeDisabled();
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(picker).toHaveValue("wts2026station2"); await expect(picker).toBeDisabled();
      const reply = held.shift(); state.holdSelect = false; await reply.route.fulfill({ json: reply.json });
      await expect(picker).toBeEnabled(); assert.equal(count("select_printer"), 1);
    });
    for (const kind of ["camera", "lookup", "unreadable"]) await scenario(`persisted ${kind} hold blocks printer changes`, mode, async ({ page, count, open, picker }) => {
      const key = kind === "camera" ? "wts:camera-held:bbbbbbbbbbbbbbb:1:wts2026station1" : "wts.checkin.lookup.held-operation";
      const value = kind === "unreadable" ? "unreadable" : "11111111-1111-4111-8111-111111111111";
      await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key, value });
      await open(); await expect(picker).toBeDisabled();
      await expect(page.getByText("Finish or recover the current work before changing printers.", { exact: true })).toBeVisible();
      await picker.evaluate(select => { select.value = "wts2026station2"; select.dispatchEvent(new Event("change", { bubbles: true })); });
      await frames(page); assert.equal(count("select_printer"), 0);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), key), value);
      if (mode === "tools") {
        await expect(button(page, "Review held scan")).toBeEnabled();
        await button(page, "Review held scan").click(); await expect(button(page, "Arrivals")).toHaveAttribute("aria-pressed", "true");
      }
    });
    await scenario("storage hold arriving after render is checked before mutation", mode, async ({ page, count, open, picker }) => {
      await open(); await expect(picker).toBeEnabled();
      await page.evaluate(() => localStorage.setItem("wts.checkin.lookup.held-operation", "11111111-1111-4111-8111-111111111111"));
      await picker.selectOption("wts2026station2"); await expect(picker).toBeDisabled();
      assert.equal(count("select_printer"), 0);
    });
    await scenario("stale actor acknowledgement does not reconcile or restore old selection", mode, async ({ page, state, held, count, open, picker }) => {
      await open(); await expect(picker).toBeEnabled(); state.holdSelect = true;
      await picker.selectOption("wts2026station2"); await expect.poll(() => held.length).toBe(1);
      const oldReads = count("status");
      await page.evaluate(() => window.setFixtureUser({ id: "vvvvvvvvvvvvvvv", role: "checkin_operator" }));
      await expect.poll(() => count("status")).toBeGreaterThan(oldReads); await frames(page);
      const reads = count("status");
      // The real client holds the shared Web Lock until the old response ends;
      // the new actor's catalogue must wait, not synthesize another identity.
      await held.shift().route.fulfill({ json: initialStatus }); await frames(page);
      await expect(picker).toBeEnabled(); await expect(picker).toHaveValue("wts2026station2");
      assert.equal(count("status"), reads, "stale completion must not start reconciliation");
      state.holdSelect = false; await picker.selectOption("wts2026station1");
      await expect(picker).toBeEnabled(); await expect(picker).toHaveValue("wts2026station1"); assert.equal(count("select_printer"), 2);
    });
    await scenario("polling preserves dropdown DOM/focus/value and never selects", mode, async ({ page, state, held, count, open, picker }) => {
      await open(); await expect(picker).toBeEnabled();
      if (mode === "scanner") await expect(button(page, "Find attendee")).toBeEnabled();
      else await expect(page.getByLabel("Event for this phone", { exact: true })).toBeEnabled();
      await picker.focus(); const handle = await picker.elementHandle();
      await handle.evaluate(element => {
        const box = () => { const r = element.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
        const snapshot = () => ({ text: document.getElementById("app").innerText, box: box(), y: scrollY, value: element.value });
        const baseline = snapshot(); window.pollSamples = { frames: 0, bad: [], running: true };
        function sample() {
          const s = window.pollSamples; s.frames++;
          if (!element.isConnected || element.disabled || document.activeElement !== element || JSON.stringify(snapshot()) !== JSON.stringify(baseline)) {
            if (s.bad.length < 3) s.bad.push({ connected: element.isConnected, disabled: element.disabled, current: snapshot(), baseline });
          }
          if (s.running) requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
      state.holdReads = true; await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect.poll(() => held.length).toBeGreaterThan(0);
      // Intentional frame-sampling interval across delayed reads, not a readiness wait.
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 250)));
      state.holdReads = false;
      for (const item of held.splice(0)) await item.route.fulfill({ json: item.json });
      await frames(page);
      const samples = await page.evaluate(() => { window.pollSamples.running = false; return window.pollSamples; });
      assert.ok(samples.frames > 5); assert.deepEqual(samples.bad, []); assert.equal(count("select_printer"), 0);
      state.denyCatalogue = true; await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(picker).toBeDisabled(); await expect(page.getByText("Couldn't load printers.", { exact: true })).toBeVisible();
    });
  }
  await scenario("pending camera arrival remains mounted and blocks switching after ambiguous reply", "scanner", async ({ page, open, picker, state, held, count }) => {
    await syntheticCamera(page); await open(); await expect(picker).toBeEnabled();
    await expect(button(page, "Start scanning")).toBeEnabled(); state.holdArrival = true;
    await button(page, "Start scanning").click(); await expect(page.locator("video")).toBeVisible(); await showQr(page, "A-REPAIR1");
    await expect.poll(() => held.length).toBe(1);
    const panel = await page.getByRole("region", { name: "Camera arrival", exact: true }).elementHandle();
    const storage = await page.evaluate(() => Object.entries(localStorage));
    await expect(picker).toBeDisabled();
    await picker.evaluate(select => { select.value = "wts2026station2"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    assert.ok(await panel.evaluate(element => element.isConnected));
    const reply = held.shift(); state.holdArrival = false; await reply.route.fulfill({ json: reply.json });
    await expect(button(page, "Retry same arrival")).toBeEnabled(); await expect(picker).toBeDisabled();
    await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await frames(page);
    assert.ok(await panel.evaluate(element => element.isConnected));
    assert.deepEqual(await page.evaluate(() => Object.entries(localStorage)), storage);
    assert.equal(count("preflight"), 1); assert.equal(count("select_printer"), 0);
  });
  await scenario("pending manual lookup remains mounted with exact retry and blocks switching", "scanner", async ({ page, open, picker, held, count, calls }) => {
    await open(); await expect(picker).toBeEnabled();
    await button(page, "Find attendee").click(); await page.getByLabel("Attendee name or email", { exact: true }).fill("Synthetic");
    await button(page, "Search attendees").click(); await button(page, "Select Synthetic Attendee").click(); await button(page, "Confirm check-in").click();
    await expect.poll(() => held.length).toBe(1);
    const panel = await page.getByRole("region", { name: "Attendee lookup", exact: true }).elementHandle();
    const command = calls.find(call => call.operation === "confirm");
    await expect(picker).toBeDisabled();
    await picker.evaluate(select => { select.value = "wts2026station2"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await held.shift().route.fulfill({ json: { state: "accepted" } });
    await expect(button(page, "Retry same confirmation")).toBeEnabled(); await expect(picker).toBeDisabled();
    await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await frames(page);
    assert.ok(await panel.evaluate(element => element.isConnected));
    assert.equal(await page.evaluate(() => localStorage.getItem("wts.checkin.lookup.held-operation")), command.input.operationId);
    assert.equal(count("confirm"), 1); assert.equal(count("select_printer"), 0);
  });
} finally { await browser?.close(); await server.close(); }
console.log(`${passed} passed; ${failures.length} failed`);
assert.deepEqual(failures, [], "check-in printer selection UI regressions");
