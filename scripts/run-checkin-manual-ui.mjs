// Mounted production components/clients; synthetic loopback API and camera only.
// This proves UI behavior, not backend binding, admission, or printer effects.
import { createServer } from "vite";
import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { chromium, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import QRCode from "qrcode";
const root = process.env.CHECKIN_MANUAL_SOURCE ? process.env.CHECKIN_MANUAL_SOURCE.replace(/\/$/, "") + "/" : fileURLToPath(new URL("../", import.meta.url));
const fixtureId = `${root}tests/__checkin-manual-fixture.tsx`;
const authId = `${root}tests/__checkin-manual-auth.ts`;
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
  name: "checkin-manual-fixture",
  resolveId(id) { if (id === "/__checkin-manual-fixture.tsx") return fixtureId; if (id === authId) return authId; },
  load(id) { if (id === fixtureId) return fixture; if (id === authId) return auth; },
  configureServer(server) { server.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith("/?mode=")) return next();
    res.setHeader("Content-Type", "text/html");
    res.end(await server.transformIndexHtml("/", '<!doctype html><html><body><div id="app"></div><script type="module" src="/__checkin-manual-fixture.tsx"></script></body></html>'));
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
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const roster = Array.from({ length: 43 }, (_, i) => ({ attendeeId: String(i + 1), publicId: `A-PRSN${String(i + 1).padStart(3, "0")}`, name: `Person ${String(i + 1).padStart(2, "0")}`, email: `person${i + 1}@example.test`, checkedIn: i === 1, status: i === 2 ? "CANCELLED" : i === 3 ? "AWAITING_PAYMENT" : "ACTIVE" }));
async function scenario(name, run) {
 if (process.env.CHECKIN_MANUAL_CASE && !new RegExp(process.env.CHECKIN_MANUAL_CASE).test(name)) return;
 const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
 const errors = [], calls = [], held = [];
 page.on("pageerror", e => errors.push(e.message));
 page.on("console", m => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource:")) errors.push(m.text()); });
 const state = { status: structuredClone(initialStatus), holdSearch: false, holdConfirm: false, malformed: false, deny: false, printState: "queued", command: null, empty: false };
 const context = () => ({ protocolVersion: 1, edition: "WTS2026", bindingId: state.status.binding.id, bindingVersion: state.status.binding.version, stationId: state.status.station.id, stationGeneration: 1, systemGeneration: 1, eventId: event.id, eventGeneration: 1, selectionVersion: 1 });
 const printer = n => ({ system: state.status.system, station: { ...initialStatus.station, id: `wts2026station${n}`, label: `Printer ${n}`, printerRef: `fixture-printer-${n}` }, canBind: true, confirmation: { stationId: `wts2026station${n}`, stationVersion: 1, bindingVersion: state.status.binding.version, systemGeneration: 1 } });
 const decision = () => ({ state: "accepted", printIntentId: "ppppppppppppppp", workflow: { id: "wwwwwwwwwwwwwww", stationId: state.command.context.stationId, eventId: event.id, eventTitle: event.title, state: "accepted", printState: state.printState, name: roster.find(p => p.attendeeId === state.command.attendeeId).name, affiliation: "Synthetic company", profileId: "fixture-profile", createdAt: "2026-09-17" } });
 const count = operation => calls.filter(c => c.operation === operation).length;
 await page.route("**/*", async route => {
  const url = new URL(route.request().url());
  if (url.origin !== base) { errors.push(`External request ${url.origin}`); return route.abort(); }
  if (!url.pathname.startsWith("/api/")) return route.continue();
  const body = route.request().postDataJSON(); calls.push(body);
  try {
   let json;
   if (url.pathname === "/api/checkin") {
    if (body.operation === "status") json = state.status;
    else if (body.operation === "printers") json = { printers: [1, 2].map(printer) };
    else if (body.operation === "select_printer") {
     const target = [1, 2].map(printer).find(p => p.station.id === body.confirmation.stationId);
     assert.ok(target); state.status.binding.version++; state.status.binding.stationId = target.station.id; state.status.station = target.station; json = state.status;
    } else throw Error(`Unexpected operation ${body.operation}`);
   } else if (url.pathname === "/api/checkin-events") {
    assert.equal(body.operation, "catalogue"); json = { state: "complete", events: [event], selected: event, fence: { bindingVersion: state.status.binding.version, stationGeneration: 1, systemGeneration: 1, selectionVersion: 1 }, context: context() };
   } else if (url.pathname === "/api/checkin-agents") json = { station: { ...agent, stationId: state.status.station.id } };
   else if (url.pathname === "/api/checkin-lookup") {
    if (state.deny) return route.fulfill({ status: 403, json: { error: "Synthetic denial" } });
    if (body.operation === "search") {
     const q = body.input.query.toLowerCase(); const matches = state.empty ? [] : roster.filter(p => `${p.name} ${p.email}`.toLowerCase().includes(q));
     const offset = body.input.offset ?? 0;
     json = { state: "complete", context: body.input.context, items: matches.slice(offset, offset + 20), nextOffset: offset + 20 < matches.length ? offset + 20 : null, totalCount: matches.length };
     if (state.holdSearch) { held.push({ route, json }); return; }
    } else if (body.operation === "confirm") {
     state.command = body.input;
     json = state.malformed ? { state: "accepted" } : { ...decision(), operationId: body.input.operationId, replayed: false, operationsEnabled: false };
     if (state.holdConfirm) { held.push({ route, json }); return; }
    } else throw Error(`Unexpected lookup ${body.operation}`);
   } else if (url.pathname === "/api/checkin-arrivals") {
    assert.equal(body.operation, "status"); json = { operationId: body.operationId, result: decision(), operationsEnabled: false };
   } else throw Error(`Unexpected endpoint ${url.pathname}`);
   await route.fulfill({ json });
  } catch (e) { errors.push(e.message); await route.abort(); }
 });
 const picker = page.getByRole("combobox", { name: "Printer", exact: true });
 const open = async () => { await page.goto(`${base}/?mode=scanner`); await expect(button(page, "Manual")).toBeEnabled(); await button(page, "Manual").click(); };
 try {
  await run({ page, open, picker, state, calls, held, count }); await frames(page); assert.deepEqual(errors, []);
  assert.equal(count("preflight"), 0, "manual mode never starts a camera command");
  console.log(`PASS ${name}`); passed++;
 } catch (e) { failures.push(name); console.error(`FAIL ${name}`, e); console.error((await page.locator("body").innerText()).slice(0, 5000)); }
 finally { for (const item of held.splice(0)) await item.route.fulfill({ json: item.json }); await page.unrouteAll({ behavior: "wait" }); await page.close(); }
}
try {
 browser = await chromium.launch({ headless: true });
 await scenario("auto-load full roster, page all entries, search name/email, refresh and clear", async ({ page, open, state, held, count, calls, picker }) => {
  state.holdSearch = true; await open();
  await expect.poll(() => held.length).toBe(1); assert.equal(calls.find(c => c.operation === "search").input.query, "");
  await expect(page.getByText("Request in progress…", { exact: true })).toBeVisible();
  await expect(picker).toBeEnabled(); await expect(button(page, "Scan")).toBeEnabled();
  state.holdSearch = false; const first = held.shift(); await first.route.fulfill({ json: first.json });
  await expect(page.getByText("Showing 1–20 of 43 attendees", { exact: true })).toBeVisible();
  await expect(button(page, "Check in & print Person 01")).toBeInViewport({ ratio: 1 });
  if (process.env.CHECKIN_MANUAL_SCREENSHOT) {
   await page.evaluate(() => document.fonts.ready.then(() => undefined));
   await page.screenshot({ path: process.env.CHECKIN_MANUAL_SCREENSHOT });
  }
  const seen = new Set();
  for (let p = 0; p < 3; p++) {
   for (const text of await page.locator('.wts-operator-lookup li > p:first-child').allTextContents()) seen.add(text);
   if (p < 2) { await button(page, "Next results").click(); await expect(page.getByText(p === 0 ? "Showing 21–40 of 43 attendees" : "Showing 41–43 of 43 attendees", { exact: true })).toBeVisible(); }
  }
  assert.equal(seen.size, roster.length); await expect(button(page, "Next results")).toHaveCount(0);
  await button(page, "Previous results").click(); await expect(page.getByText("Showing 21–40 of 43 attendees", { exact: true })).toBeVisible();
  for (const query of ["Person 05", "person8@example.test", "P"]) {
   await page.getByLabel("Attendee name or email", { exact: true }).fill(query); const before = count("search");
   await button(page, "Search attendees").click(); await expect.poll(() => count("search")).toBe(before + 1); await expect(button(page, "Search attendees")).toBeEnabled();
   assert.equal(calls.filter(c => c.operation === "search").at(-1).input.query, query);
   await expect(button(page, "Previous results")).toHaveCount(0);
  }
  await button(page, "Show all attendees").click(); await expect(page.getByText("Showing 1–20 of 43 attendees", { exact: true })).toBeVisible();
  const before = count("search"); await button(page, "Refresh list").click(); await expect.poll(() => count("search")).toBe(before + 1);
  await expect(button(page, "Reprint Person 02")).toBeEnabled();
  await expect(button(page, "Check in & print Person 03")).toBeDisabled(); await expect(button(page, "Check in & print Person 04")).toBeDisabled();
  assert.equal(count("confirm"), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
 });
 await scenario("empty configured roster is explicit and refreshable", async ({ page, open, state }) => {
  state.empty = true; await open(); await expect(page.getByText("No matching attendees in the active admission list.", { exact: true })).toBeVisible();
  await expect(button(page, "Refresh list")).toBeEnabled(); await expect(button(page, "Next results")).toHaveCount(0);
 });
 await scenario("direct one-request action, immutable unknown retry, guards and actual print completion", async ({ page, open, picker, state, held, calls, count }) => {
  await open(); await expect(button(page, "Check in & print Person 01")).toBeEnabled();
  await picker.selectOption("wts2026station2"); await expect(button(page, "Check in & print Person 01")).toBeEnabled();
  state.holdConfirm = true; state.malformed = true;
  await button(page, "Check in & print Person 01").evaluate(element => { element.click(); element.click(); });
  await expect.poll(() => held.length).toBe(1); assert.equal(count("confirm"), 1);
  const original = calls.find(c => c.operation === "confirm"); assert.equal(original.input.context.stationId, "wts2026station2"); assert.equal(original.input.attendeeId, "1");
  await expect(button(page, "Scan")).toBeDisabled(); await expect(button(page, "Manual")).toBeDisabled(); await expect(picker).toBeDisabled(); await expect(page.locator("#scan-event")).toBeDisabled();
  await button(page, "Scan").evaluate(element => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await expect(button(page, "Manual")).toHaveAttribute("aria-pressed", "true");
  const reply = held.shift(); state.holdConfirm = false; await reply.route.fulfill({ json: reply.json });
  await expect(button(page, "Retry same confirmation")).toBeEnabled(); await expect(button(page, "Scan")).toBeDisabled();
  const stored = await page.evaluate(() => Object.entries(localStorage));
  assert.equal(stored.find(([k]) => k === "wts.checkin.lookup.held-operation")[1], original.input.operationId);
  assert.ok(!JSON.stringify(stored).includes("Person 01")); assert.ok(!JSON.stringify(stored).includes("person1@example.test"));
  state.malformed = false; await button(page, "Retry same confirmation").click();
  await expect.poll(() => count("confirm")).toBe(2); assert.deepEqual(calls.filter(c => c.operation === "confirm")[1], original);
  await expect(page.getByRole("heading", { name: "Label queued…", exact: true })).toBeVisible();
  await expect(button(page, "Back to attendee list")).toHaveCount(0); await expect(button(page, "Scan")).toBeDisabled();
  state.printState = "completed"; await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("heading", { name: "Done", exact: true })).toBeVisible();
  await button(page, "Back to attendee list").click(); await expect(button(page, "Check in & print Person 01")).toBeEnabled(); await expect(picker).toBeEnabled();
  assert.equal(count("confirm"), 2);
 });
 await scenario("mode preference per operator, mounted panels and stale roster authority", async ({ page, open, state, held, count }) => {
  await open(); await expect(button(page, "Check in & print Person 01")).toBeEnabled();
  const camera = await page.getByRole("region", { name: "Camera arrival", exact: true, includeHidden: true }).elementHandle();
  const lookup = await page.getByRole("region", { name: "Attendee lookup", exact: true }).elementHandle();
  await button(page, "Scan").click(); assert.ok(await lookup.evaluate(e => e.isConnected));
  await button(page, "Manual").click(); assert.ok(await camera.evaluate(e => e.isConnected));
  await page.reload(); await expect(button(page, "Manual")).toHaveAttribute("aria-pressed", "true"); await expect(button(page, "Check in & print Person 01")).toBeEnabled();
  state.holdSearch = true; await button(page, "Refresh list").click(); await expect.poll(() => held.length).toBe(1);
  await page.evaluate(() => window.setFixtureUser({ id: "vvvvvvvvvvvvvvv", role: "checkin_operator" }));
  await expect(button(page, "Scan")).toHaveAttribute("aria-pressed", "true");
  state.holdSearch = false; const old = held.shift(); await old.route.fulfill({ json: old.json }); await frames(page);
  await expect(page.getByText("Person 01", { exact: true })).toHaveCount(0); assert.equal(count("confirm"), 0);
  await button(page, "Manual").click(); await expect(button(page, "Check in & print Person 01")).toBeEnabled();
  state.deny = true; await button(page, "Refresh list").click(); await expect(page.getByText("Lookup access denied. Verify your login and station binding.", { exact: true })).toBeVisible();
  await expect(button(page, "Check in & print Person 01")).toHaveCount(0);
 });
} finally { await browser?.close(); await server.close(); }
console.log(`${passed} passed; ${failures.length} failed`);
assert.deepEqual(failures, [], "manual roster component regressions");
