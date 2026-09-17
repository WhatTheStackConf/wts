// Mounted production components/clients; synthetic loopback API and camera only.
// This proves UI behavior, not backend binding, admission, or printer effects.
import { createServer } from "vite";
import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { chromium, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import QRCode from "qrcode";
const root = process.env.CHECKIN_REPAIRING_SOURCE ? process.env.CHECKIN_REPAIRING_SOURCE.replace(/\/$/, "") + "/" : fileURLToPath(new URL("../", import.meta.url));
const fixtureId = `${root}tests/__checkin-repairing-fixture.tsx`;
const authId = `${root}tests/__checkin-repairing-auth.ts`;
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
  name: "checkin-repairing-fixture",
  resolveId(id) { if (id === "/__checkin-repairing-fixture.tsx") return fixtureId; if (id === authId) return authId; },
  load(id) { if (id === fixtureId) return fixture; if (id === authId) return auth; },
  configureServer(server) { server.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith("/?mode=")) return next();
    res.setHeader("Content-Type", "text/html");
    res.end(await server.transformIndexHtml("/", '<!doctype html><html><body><div id="app"></div><script type="module" src="/__checkin-repairing-fixture.tsx"></script></body></html>'));
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
async function fragment(page, code = code2) {
  await page.evaluate(code => { location.hash = `provision=${code}`; }, code);
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  assert.equal(new URL(page.url()).searchParams.get("keep"), "yes");
}
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
  if (process.env.CHECKIN_REPAIRING_CASE && !new RegExp(process.env.CHECKIN_REPAIRING_CASE).test(`${mode}: ${name}`)) return;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [], calls = [], held = [];
  page.on("pageerror", error => errors.push(error.message));
  // Expected HTTP error responses are exercised below, but runtime/console exceptions fail.
  page.on("console", message => { if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) errors.push(message.text()); });
  const state = { status: structuredClone(initialStatus), deny: false, holdPreview: false, holdBind: false, holdArrival: false, holdLookup: false, arrival: undefined };
  const confirmName = mode === "scanner" ? "Confirm station" : "Confirm station binding";
  const cancelName = mode === "scanner" ? "Cancel station change" : "Cancel";
  const input = page.locator(mode === "scanner" ? "#pair-code" : "#station-code");
  const context = () => ({ protocolVersion: 1, edition: "WTS2026", bindingId: state.status.binding.id, bindingVersion: state.status.binding.version, stationId: state.status.station.id, stationGeneration: 1, systemGeneration: 1, eventId: event.id, eventGeneration: 1, selectionVersion: 1 });
  const preview = code => ({ system: state.status.system, station: { ...state.status.station, id: `wts2026station${code[0]}`, label: `Station ${code[0]}` }, canBind: true, confirmation: { stationId: `wts2026station${code[0]}`, stationVersion: 1, bindingVersion: state.status.binding.version, systemGeneration: 1 } });
  const count = operation => calls.filter(call => call.operation === operation).length;
  await syntheticCamera(page);
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) { errors.push(`Unexpected external request ${url.origin}`); return route.abort(); }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const body = route.request().postDataJSON(); calls.push(body);
    let json;
    try {
      if (url.pathname === "/api/checkin") {
        if (body.operation === "status") {
          if (state.deny) return route.fulfill({ status: 403, json: { error: "Synthetic denial" } });
          json = state.status;
        } else if (body.operation === "preview") {
          assert.ok([code2, code3].includes(body.code));
          json = preview(body.code);
          if (state.holdPreview) { held.push({ route, json }); return; }
        } else if (body.operation === "bind") {
          assert.deepEqual(body.confirmation, preview(body.code).confirmation);
          state.status = { ...state.status, binding: { ...state.status.binding, version: state.status.binding.version + 1, stationId: body.confirmation.stationId }, station: preview(body.code).station };
          json = state.status;
          if (state.holdBind) { held.push({ route, json }); return; }
        } else throw Error(`Unexpected checkin operation ${body.operation}`);
      } else if (url.pathname === "/api/checkin-events") {
        assert.equal(body.operation, "catalogue");
        json = { state: "complete", events: [event], selected: event, fence: { bindingVersion: state.status.binding.version, stationGeneration: 1, systemGeneration: 1, selectionVersion: 1 }, context: context() };
      } else if (url.pathname === "/api/checkin-agents") { assert.equal(body.operation, "status"); json = { station: { ...agent, stationId: state.status.station.id } }; }
      else if (url.pathname === "/api/checkin-recovery") { assert.equal(body.operation, "history"); json = { items: [], nextOffset: null }; }
      else if (url.pathname === "/api/checkin-arrivals") {
        if (body.operation === "preflight") {
          state.arrival = body.command;
          json = { state: "dependency_unavailable", operationId: body.command.operationId, replayed: false, operationsEnabled: false };
          if (state.holdArrival) { held.push({ route, json }); return; }
        } else if (body.operation === "status") json = { operationId: body.operationId, result: { state: "dependency_unavailable" }, operationsEnabled: false };
        else if (body.operation === "history") json = { items: [], nextCursor: null, day: "2026-09-17", operationsEnabled: false };
        else throw Error(`Unexpected arrivals operation ${body.operation}`);
      } else if (url.pathname === "/api/checkin-arrival-resume") {
        assert.equal(body.operation, "get"); json = { operationId: body.operationId, context: state.arrival?.context ?? context(), status: "final", state: "dependency_unavailable", affiliationChoice: "fetch", recovery: "available", actions: ["retry"], operationsEnabled: false };
      } else if (url.pathname === "/api/checkin-lookup") {
        if (body.operation === "recovery_get") return route.fulfill({ status: 404, json: { error: "Synthetic held work requires operator recovery" } });
        if (body.operation === "search") json = { state: "complete", context: body.input.context, items: [person], nextOffset: null };
        else if (body.operation === "confirm") {
          json = { state: "already_handled", operationId: body.input.operationId, replayed: false, operationsEnabled: false };
          if (state.holdLookup) { held.push({ route, json }); return; }
        } else throw Error(`Unexpected lookup operation ${body.operation}`);
      } else throw Error(`Unexpected endpoint ${url.pathname}`);
      await route.fulfill({ json });
    } catch (error) { errors.push(error.message); await route.abort(); }
  });
  const open = async (code = "") => {
    await page.goto(`${base}/?mode=${mode}&keep=yes${code ? `#provision=${code}` : ""}`);
    await expect(page.locator(mode === "scanner" ? ".wts-operator-context" : ".wts-tools-context")).toContainText("Station 1");
    if (!code && mode === "scanner") await expect(button(page, "Find attendee")).toBeEnabled();
  };
  try {
    await run({ page, state, calls, held, count, input, open, confirmName, cancelName });
    await frames(page); assert.deepEqual(errors, []);
    assert.equal(count("preflight"), state.arrival ? 1 : 0, "Provisioning must never submit/replay attendance");
    console.log(`PASS ${mode}: ${name}`); passed++;
  } catch (error) { failures.push(`${mode}: ${name}`); console.error(`FAIL ${mode}: ${name}`, error); }
  finally {
    for (const item of held.splice(0)) await item.route.fulfill({ json: item.json });
    await page.unrouteAll({ behavior: "wait" }); await page.close();
  }
}
try {
  browser = await chromium.launch({ headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  for (const mode of ["scanner", "tools"]) {
    await scenario("bound1 initial link2 explicitly reviews and confirms2", mode, async ({ page, open, count, input, confirmName, state }) => {
      await open(code2);
      await expect(button(page, "Review station")).toBeVisible(); await expect(input).toHaveValue(code2);
      assert.equal(new URL(page.url()).hash, ""); assert.equal(new URL(page.url()).searchParams.get("keep"), "yes");
      assert.equal(count("preview"), 0); assert.equal(count("bind"), 0);
      await button(page, "Review station").click(); await expect(page.getByRole("heading", { name: "Station 2", exact: true })).toBeVisible();
      assert.equal(state.status.station.id, stationId); assert.equal(count("bind"), 0);
      await button(page, confirmName).click();
      await expect(page.locator(mode === "scanner" ? ".wts-operator-context" : ".wts-tools-context")).toContainText("Station 2");
      assert.equal(count("bind"), 1);
    });
    await scenario("same-document link opens review; cancel retains1", mode, async ({ page, open, input, count, cancelName }) => {
      await open(); await fragment(page); await expect(input).toHaveValue(code2);
      await button(page, "Review station").click(); await expect(page.getByRole("heading", { name: "Station 2", exact: true })).toBeVisible();
      await button(page, cancelName).click(); assert.equal(count("bind"), 0);
      await expect(page.getByRole("heading", { name: "Station 2", exact: true })).toHaveCount(0);
      await expect(page.locator(mode === "scanner" ? ".wts-operator-context" : ".wts-tools-context")).toContainText("Station 1");
      if (mode === "scanner") await expect(button(page, "Find attendee")).toBeEnabled();
    });
    await scenario("late preview2 cannot confirm new code3", mode, async ({ page, open, state, held, input, confirmName, calls, count }) => {
      await open(code2); state.holdPreview = true;
      await button(page, "Review station").click(); await expect.poll(() => held.length).toBe(1);
      await fragment(page, code3); await expect(input).toHaveValue(code3);
      state.holdPreview = false; const old = held.shift(); await old.route.fulfill({ json: old.json });
      await expect(button(page, "Review station")).toBeEnabled(); await frames(page);
      await expect(button(page, confirmName)).toHaveCount(0); assert.equal(count("bind"), 0);
      await button(page, "Review station").click(); await expect(page.getByRole("heading", { name: "Station 3", exact: true })).toBeVisible();
      await button(page, confirmName).click(); await expect.poll(() => count("bind")).toBe(1);
      assert.equal(calls.find(call => call.operation === "bind").code, code3);
    });
    await scenario("status denial invalidates preview and blocks confirmation", mode, async ({ page, open, state, confirmName, count }) => {
      await open(code2); await button(page, "Review station").click(); await expect(button(page, confirmName)).toBeEnabled();
      state.deny = true; await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(button(page, confirmName)).toHaveCount(0); await expect(button(page, "Review station")).toBeDisabled();
      assert.equal(count("bind"), 0);
    });
    await scenario("status can overtake binding acknowledgement without retaining consumed draft", mode, async ({ page, open, state, held, confirmName, count, input }) => {
      await open(code2); await button(page, "Review station").click(); await expect(button(page, confirmName)).toBeEnabled();
      state.holdBind = true; await button(page, confirmName).click(); await expect.poll(() => held.length).toBe(1);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(page.locator(mode === "scanner" ? ".wts-operator-context" : ".wts-tools-context")).toContainText("Station 2");
      state.holdBind = false; const reply = held.shift(); await reply.route.fulfill({ json: reply.json });
      if (mode === "scanner") { await expect(page.getByRole("region", { name: "Pair station", exact: true })).toHaveCount(0); await expect(button(page, "Find attendee")).toBeEnabled(); }
      else await expect(input).toHaveValue("");
      await expect(button(page, confirmName)).toHaveCount(0); assert.equal(count("bind"), 1);
    });
    await scenario("new link during pending bind survives old acknowledgement", mode, async ({ page, open, state, held, confirmName, count, input, calls }) => {
      await open(code2); await button(page, "Review station").click(); await expect(button(page, confirmName)).toBeEnabled();
      state.holdBind = true; await button(page, confirmName).click(); await expect.poll(() => held.length).toBe(1);
      await fragment(page, code3); await expect(input).toHaveValue(code3);
      state.holdBind = false; const reply = held.shift(); await reply.route.fulfill({ json: reply.json });
      await expect(button(page, "Review station")).toBeEnabled(); await expect(input).toHaveValue(code3);
      await expect(button(page, confirmName)).toHaveCount(0); assert.equal(count("bind"), 1);
      await button(page, "Review station").click(); await expect(page.getByRole("heading", { name: "Station 3", exact: true })).toBeVisible();
      await button(page, confirmName).click(); await expect.poll(() => count("bind")).toBe(2);
      assert.equal(calls.filter(x => x.operation === "bind")[1].code, code3);
    });
    await scenario("actor change rejects delayed preview", mode, async ({ page, open, state, held, confirmName, count }) => {
      await open(code2); state.holdPreview = true; await button(page, "Review station").click(); await expect.poll(() => held.length).toBe(1);
      await page.evaluate(() => window.setFixtureUser({ id: "vvvvvvvvvvvvvvv", role: "checkin_operator", name: "Other synthetic operator" }));
      await frames(page); const old = held.shift(); await old.route.fulfill({ json: old.json });
      await expect(button(page, confirmName)).toHaveCount(0); assert.equal(count("bind"), 0);
      // A changed human must not inherit the previous human's pairing draft.
      if (mode === "scanner") await expect(page.locator("#pair-code")).toHaveCount(0);
      else await expect(page.locator("#station-code")).toHaveValue("");
      await fragment(page, code3); await expect(button(page, "Review station")).toBeEnabled();
      await expect(button(page, confirmName)).toHaveCount(0);
    });
  }
  for (const kind of ["camera", "lookup"]) await scenario(`persisted ${kind} hold blocks initial link pairing without blocking recovery navigation`, "tools", async ({ page, open, count, state }) => {
    const key = kind === "camera" ? "wts:camera-held:bbbbbbbbbbbbbbb:1:wts2026station1" : "wts.checkin.lookup.held-operation";
    const operationId = "11111111-1111-4111-8111-111111111111";
    await page.addInitScript(({ key, operationId }) => localStorage.setItem(key, operationId), { key, operationId });
    await open(code2); await expect(button(page, "Review station")).toBeDisabled();
    const phone = page.getByRole("region", { name: "Pair this phone", exact: true });
    await expect(phone.getByText("Finish or recover the held work before changing stations.", { exact: true })).toBeVisible();
    await expect(phone.getByRole("button", { name: "Review held scan", exact: true })).toBeEnabled();
    await phone.getByRole("button", { name: "Review held scan", exact: true }).click();
    await expect(button(page, "Arrivals")).toHaveAttribute("aria-pressed", "true");
    assert.equal(await page.evaluate(key => localStorage.getItem(key), key), operationId);
    assert.equal(state.status.station.id, stationId); assert.equal(count("preview"), 0); assert.equal(count("bind"), 0);
  });
  await scenario("station camera previews code and manual review remains usable", "tools", async ({ page, open, count, confirmName, input }) => {
    await open(); await button(page, "Phone").click();
    await button(page, "Start scanning").click(); await expect(page.locator("video")).toBeVisible();
    await showQr(page, base + "/checkin#provision=" + code2);
    await expect(button(page, confirmName)).toBeEnabled();
    await expect(input).toHaveValue(code2); assert.equal(count("preview"), 1); assert.equal(count("bind"), 0);
    await button(page, "Cancel").click();
    await page.getByText("Enter station code instead", { exact: true }).click();
    await input.fill(code2); await button(page, "Review station").click();
    await expect(button(page, confirmName)).toBeEnabled(); assert.equal(count("preview"), 2);
  });
  await scenario("Review brings confirmation into the mobile viewport", "tools", async ({ page, open, confirmName }) => {
    await open(code2); await button(page, "Review station").click();
    await expect(button(page, confirmName)).toBeVisible();
    await page.screenshot({ path: process.env.CHECKIN_REPAIRING_SCREENSHOT || "/tmp/wts-tools-review-viewport.png", fullPage: false });
    await expect(button(page, confirmName)).toBeInViewport();
    await expect(page.getByRole("region", { name: "Confirm station", exact: true })).toBeFocused();
  });
  await scenario("ordinary status poll does not discard the Review response", "tools", async ({ page, open, state, held, count, confirmName }) => {
    await open(code2); state.holdPreview = true;
    await button(page, "Review station").click(); await expect.poll(() => held.length).toBe(1);
    const reads = count("status"); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => count("status")).toBeGreaterThan(reads); await frames(page);
    const old = held.shift(); await old.route.fulfill({ json: old.json });
    await expect(button(page, confirmName)).toBeEnabled(); assert.equal(count("bind"), 0);
  });
  await scenario("pending and ambiguous camera arrival survives link without replay", "scanner", async ({ page, open, state, held, count }) => {
    await open(); state.holdArrival = true;
    await button(page, "Start scanning").click(); await expect(page.locator("video")).toBeVisible(); await showQr(page, "A-REPAIR1");
    await expect.poll(() => held.length).toBe(1);
    const panel = await page.getByRole("region", { name: "Camera arrival", exact: true }).elementHandle();
    const storage = await page.evaluate(() => Object.entries(localStorage));
    await fragment(page); await expect(button(page, "Review station")).toBeDisabled();
    await expect(page.getByText("Finish or recover the current work before changing stations.", { exact: true })).toBeVisible();
    assert.ok(await panel.evaluate(element => element.isConnected));
    const first = held.shift(); await first.route.fulfill({ json: first.json });
    await expect(page.getByRole("heading", { name: "Check unavailable", exact: true })).toBeVisible();
    await expect(button(page, "Retry check")).toBeEnabled(); await expect(button(page, "Review station")).toBeDisabled();
    assert.deepEqual(await page.evaluate(() => Object.entries(localStorage)), storage);
    await button(page, "Cancel station change").click();
    await expect(button(page, "Retry check")).toBeEnabled(); assert.ok(await panel.evaluate(element => element.isConnected));
    assert.equal(count("preflight"), 1); assert.equal(count("bind"), 0);
  });
  await scenario("pending lookup survives link and retains exact retry", "scanner", async ({ page, open, state, held, count, calls }) => {
    await open(); state.holdLookup = true;
    await button(page, "Find attendee").click(); await page.getByLabel("Attendee name or email", { exact: true }).fill("Synthetic");
    await button(page, "Search attendees").click(); await button(page, "Select Synthetic Attendee").click(); await button(page, "Confirm check-in").click();
    await expect.poll(() => held.length).toBe(1);
    const panel = await page.getByRole("region", { name: "Attendee lookup", exact: true }).elementHandle();
    const command = calls.find(call => call.operation === "confirm");
    await fragment(page); await expect(button(page, "Review station")).toBeDisabled();
    assert.ok(await panel.evaluate(element => element.isConnected));
    // Malformed success is an ambiguous outcome, with no noisy network error.
    await held.shift().route.fulfill({ json: { state: "accepted" } });
    await expect(button(page, "Retry same confirmation")).toBeEnabled();
    assert.equal(await page.evaluate(() => localStorage.getItem("wts.checkin.lookup.held-operation")), command.input.operationId);
    await button(page, "Cancel station change").click(); await expect(button(page, "Retry same confirmation")).toBeEnabled();
    assert.equal(count("confirm"), 1); assert.equal(count("bind"), 0);
  });
} finally { await browser?.close(); await server.close(); }
console.log(`${passed} passed; ${failures.length} failed`);
assert.deepEqual(failures, [], "check-in station re-pairing UI regressions");
