// Component-browser evidence only: this harness does NOT prove PocketBase or upstream effects.
import { createServer } from "vite";
import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { chromium, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({ configFile: false, root, plugins: [tailwindcss(), solid({ ssr: false }), {
 name: "lookup-component-fixture",
 configureServer(server) {
  server.middlewares.use(async (req, res, next) => {
   if (req.url?.split("?")[0] !== "/") return next();
   res.setHeader("Content-Type", "text/html");
   res.end(await server.transformIndexHtml("/", '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div><script type="module" src="/tests/checkin-lookup-ui-fixture.tsx"></script></body></html>'));
  });
 },
}], resolve: { alias: { "~": `${root}src` } }, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
await server.listen();
let browser;
let count = 0;
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const person = { attendeeId: "21", publicId: "A-TEST001", name: "Shared Name", email: "first.person.with.long.address@example.test" };
const other = { attendeeId: "22", publicId: "A-TEST002", name: "Shared Name", email: "second.person@example.test" };
try {
 browser = await chromium.launch({ headless: true });
 async function scenario(name, run) {
  const page = await browser.newPage({ viewport: { width: 320, height: 800 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  try { await run(page); assert.deepEqual(errors, []); console.log(`PASS ${name}`); count++; }
  finally { await page.close(); }
 }
 async function open(page) { await page.goto(base); await page.getByRole("button", { name: "Open attendee lookup" }).click(); await page.getByLabel("Attendee name or email").fill("Shared"); }
 async function select(page) { await page.getByRole("button", { name: "Search attendees" }).click(); await page.getByRole("button", { name: "Select Shared Name", exact: true }).nth(1).click(); }
 async function matches(route) {
  const { input } = route.request().postDataJSON();
  await route.fulfill({ json: { state: "complete", context: input.context, items: [person, other], nextOffset: null } });
 }
 await scenario("explicit selection/confirmation, narrow screen and privacy cleanup", async page => {
  const mutations = []; const urls = []; page.on("request", request => urls.push(request.url()));
  await page.route("**/api/checkin-lookup", async route => {
   const body = route.request().postDataJSON();
   if (body.operation === "search") return matches(route);
   mutations.push(body); await route.fulfill({ json: { state: "already_handled", operationId: body.input.operationId, replayed: false, operationsEnabled: false } });
  });
  await open(page); await page.getByRole("button", { name: "Search attendees" }).click();
  await expect(page.getByRole("button", { name: "Select Shared Name", exact: true })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Confirm check-in", exact: true })).toHaveCount(0); assert.equal(mutations.length, 0);
  await page.getByRole("button", { name: "Select Shared Name", exact: true }).nth(1).click();
  const confirmation = page.getByRole("region", { name: "Lookup confirmation" });
  await expect(confirmation).toContainText(other.email); await expect(confirmation).toContainText("Selected event"); await expect(confirmation).toContainText("wts2026station1"); assert.equal(mutations.length, 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole("button", { name: "Confirm check-in", exact: true }).click(); await expect(page.getByLabel("Decision")).toHaveText("already_handled");
  assert.equal(mutations.length, 1); assert.equal(mutations[0].input.attendeeId, "22"); assert.equal(mutations[0].input.qrIdentity, "A-TEST002");
  await expect(page.locator("body")).not.toContainText(other.email);
  await page.getByRole("button", { name: "Open attendee lookup" }).click(); await expect(page.getByLabel("Attendee name or email")).toHaveValue("");
  assert.equal(urls.some(url => /Shared|person|%40/.test(url)), false);
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
 });
 await scenario("stale query response cannot repopulate changed query", async page => {
  let held; await page.route("**/api/checkin-lookup", route => { held = route; });
  await open(page); await page.getByRole("button", { name: "Search attendees" }).click(); await expect.poll(() => !!held).toBe(true);
  await page.getByLabel("Attendee name or email").fill("Different"); await matches(held);
  await expect(page.getByRole("button", { name: "Search attendees" })).toBeEnabled(); await expect(page.locator("body")).not.toContainText(person.email);
 });
 for (const action of ["Rebind test station", "Change test event"]) {
  await scenario(`${action} clears visible and delayed details`, async page => {
   let held; await page.route("**/api/checkin-lookup", async route => { if (route.request().postDataJSON().operation === "search") return matches(route); held = route; });
   await open(page); await select(page); await page.getByRole("button", { name: "Confirm check-in", exact: true }).click(); await expect.poll(() => !!held).toBe(true);
   await page.getByRole("button", { name: action, exact: true }).click(); await expect(page.locator("body")).not.toContainText(other.email);
   const command = held.request().postDataJSON().input;
   await held.fulfill({ json: { state: "already_handled", operationId: command.operationId, replayed: false, operationsEnabled: false } });
   await expect(page.getByLabel("Decision")).toHaveText(""); await expect(page.locator("body")).not.toContainText(other.email);
   await expect(page.getByLabel("Lookup busy")).toHaveText("true");
   await expect(page.getByRole("button", { name: "Exit lookup and clear details" })).toBeDisabled();
   if (action === "Rebind test station") await expect(page.getByRole("button", { name: "Retry same confirmation" })).toBeDisabled();
   await page.getByRole("button", { name: "Restore test context" }).click();
   await expect(page.getByRole("button", { name: "Retry same confirmation" })).toBeEnabled();
   assert.equal(await page.evaluate(() => localStorage.getItem("wts.checkin.lookup.held-operation")), command.operationId);
  });
 }
 await scenario("malformed 200 and lost response retain byte-identical explicit confirmation", async page => {
  const mutations = [];
  await page.route("**/api/checkin-lookup", async route => {
   const body = route.request().postDataJSON(); if (body.operation === "search") return matches(route);
   mutations.push(route.request().postData());
   if (mutations.length === 1) return route.fulfill({ json: { state: "accepted" } });
   if (mutations.length === 2) return route.abort("failed");
   return route.fulfill({ json: { state: "already_handled", operationId: body.input.operationId, operationsEnabled: false, replayed: true } });
  });
  await open(page); await select(page); await page.getByRole("button", { name: "Confirm check-in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("unknown");
  await page.getByRole("button", { name: "Retry same confirmation" }).click(); await expect(page.getByRole("alert")).toContainText("unknown");
  await page.getByRole("button", { name: "Retry same confirmation" }).click(); await expect(page.getByLabel("Decision")).toHaveText("already_handled");
  assert.equal(mutations.length, 3); assert.equal(new Set(mutations).size, 1);
 });
 for (const state of ["partial", "unavailable"]) await scenario(`${state} search is failure, not missing attendee`, async page => {
  await page.route("**/api/checkin-lookup", route => route.fulfill({ json: { state, context: route.request().postDataJSON().input.context, items: [], nextOffset: null } }));
  await open(page); await page.getByRole("button", { name: "Search attendees" }).click(); await expect(page.getByRole("alert")).toContainText("incomplete or unavailable"); await expect(page.locator("body")).not.toContainText("No matching attendees");
 });
 for (const recoveryOperation of ["recovery_get", "recover"]) for (const cycle of ["verification", "binding roundtrip"]) await scenario(`stale ${recoveryOperation} cannot release a hold after ${cycle}`, async page => {
  let original, delayed;
  await page.route("**/api/checkin-lookup", async route => {
   const body = route.request().postDataJSON();
   if (body.operation === "search") return matches(route);
   if (body.operation === "confirm") { original = body.input; return route.abort("failed"); }
   if (body.operation === recoveryOperation) { delayed = route; return; }
   return route.fulfill({ json: { operationId: original.operationId, context: original.context, attendeeId: original.attendeeId, state: "pending", recovery: "available", actions: ["replay"] } });
  });
  await open(page); await select(page); await page.getByRole("button", { name: "Confirm check-in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("unknown");
  await page.reload();
  await page.getByRole("button", { name: "Recover held lookup", exact: true }).click();
  if (recoveryOperation === "recover") await page.getByRole("button", { name: "Replay held lookup", exact: true }).click();
  await expect.poll(() => !!delayed).toBe(true);
  if (cycle === "verification") {
   await page.getByRole("button", { name: "Toggle test verification", exact: true }).click();
   await page.getByRole("button", { name: "Toggle test verification", exact: true }).click();
  } else {
   await page.getByRole("button", { name: "Rebind test station", exact: true }).click();
   await page.getByRole("button", { name: "Restore test context", exact: true }).click();
  }
  const result = { state: "already_handled", operationId: original.operationId, replayed: true, operationsEnabled: false };
  await delayed.fulfill({ json: recoveryOperation === "recover" ? result : { operationId: original.operationId, context: original.context, attendeeId: original.attendeeId, state: result.state, recovery: "read_only", actions: ["replay"], result } });
  await expect(page.getByRole("button", { name: recoveryOperation === "recover" ? "Retry same recovery" : "Recover held lookup", exact: true })).toBeEnabled();
  await expect(page.getByLabel("Decision")).toHaveText("");
  assert.equal(await page.evaluate(() => localStorage.getItem("wts.checkin.lookup.held-operation")), original.operationId);
  await expect(page.getByLabel("Lookup busy")).toHaveText("true");
 });
 await scenario("exit before send clears private selection without a hold", async page => {
  await page.route("**/api/checkin-lookup", matches);
  await open(page); await select(page);
  await page.getByRole("button", { name: "Exit lookup and clear details" }).click();
  await expect(page.locator("body")).not.toContainText(other.email);
  await expect(page.getByLabel("Lookup busy")).toHaveText("false");
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
 });
 for (const action of ["Drop test context", "Toggle test readiness"]) await scenario(`${action} preserves exact intent and allows verified frozen retry`, async page => {
  const bodies = []; let first;
  await page.route("**/api/checkin-lookup", async route => {
   const body = route.request().postDataJSON(); if (body.operation === "search") return matches(route);
   bodies.push(route.request().postData());
   if (bodies.length === 1) { first = route; return; }
   return route.fulfill({ json: { state: "already_handled", operationId: body.input.operationId, operationsEnabled: false, replayed: true } });
  });
  await open(page); await select(page); await page.getByRole("button", { name: "Confirm check-in", exact: true }).click();
  await expect.poll(() => !!first).toBe(true);
  await expect(page.getByRole("button", { name: "Exit lookup and clear details" })).toBeDisabled();
  await page.getByRole("button", { name: action, exact: true }).click();
  await expect(page.locator("body")).not.toContainText(other.email);
  await first.abort("failed");
  await expect(page.getByRole("button", { name: "Retry same confirmation" })).toBeEnabled();
  await page.getByRole("button", { name: "Retry same confirmation" }).click();
  await expect(page.getByLabel("Decision")).toHaveText("already_handled");
  assert.equal(bodies.length, 2); assert.equal(new Set(bodies).size, 1);
 });
 await scenario("temporary null then original retains UUID without fresh intake", async page => {
  const bodies = [];
  await page.route("**/api/checkin-lookup", async route => {
   const body = route.request().postDataJSON(); if (body.operation === "search") return matches(route);
   bodies.push(route.request().postData());
   if (bodies.length === 1) return route.abort("failed");
   return route.fulfill({ json: { state: "already_handled", operationId: body.input.operationId, operationsEnabled: false, replayed: true } });
  });
  await open(page); await select(page); await page.getByRole("button", { name: "Confirm check-in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("unknown");
  await page.getByRole("button", { name: "Drop test context" }).click();
  await page.getByRole("button", { name: "Restore test context" }).click();
  await expect(page.getByLabel("Attendee name or email")).toHaveCount(0);
  await page.getByRole("button", { name: "Retry same confirmation" }).click();
  await expect(page.getByLabel("Decision")).toHaveText("already_handled");
  assert.equal(new Set(bodies).size, 1);
 });
 for (const status of [401, 403, 409]) await scenario(`${status} confirmation immediately redacts unchanged props and preserves UUID`, async page => {
  const bodies = [];
  await page.route("**/api/checkin-lookup", async route => {
   const body = route.request().postDataJSON(); if (body.operation === "search") return matches(route);
   bodies.push(route.request().postData());
   if (bodies.length === 1) return route.fulfill({ status, json: { error: "denied" } });
   return route.fulfill({ json: { state: "already_handled", operationId: body.input.operationId, operationsEnabled: false, replayed: true } });
  });
  await open(page); await select(page); await page.getByRole("button", { name: "Confirm check-in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(status === 409 ? "context changed" : "access denied");
  await expect(page.locator("body")).not.toContainText(other.email);
  await expect(page.locator("body")).not.toContainText("Shared Name");
  await expect(page.getByLabel("Lookup busy")).toHaveText("true");
  await expect(page.getByRole("button", { name: "Exit lookup and clear details" })).toBeDisabled();
  if (status !== 409) {
   await expect(page.getByRole("button", { name: "Retry same confirmation" })).toBeDisabled();
   await page.getByRole("button", { name: "Toggle test verification" }).click();
   await page.getByRole("button", { name: "Toggle test verification" }).click();
  }
  await page.getByRole("button", { name: "Retry same confirmation" }).click();
  await expect(page.getByLabel("Decision")).toHaveText("already_handled");
  assert.equal(bodies.length, 2); assert.equal(new Set(bodies).size, 1);
 });
 for (const state of ["needs_affiliation_choice", "dependency_unavailable"]) await scenario(`${state} linked continuation survives failed response and context loss`, async page => {
  const bodies = [];
  await page.route("**/api/checkin-lookup", async route => {
   const body = route.request().postDataJSON(); if (body.operation === "search") return matches(route);
   bodies.push(route.request().postData());
   if (bodies.length === 1) return route.fulfill({ json: { state, operationId: body.input.operationId, operationsEnabled: false, replayed: false } });
   if (bodies.length === 2) return route.abort("failed");
   return route.fulfill({ json: { state: "already_handled", operationId: body.input.operationId, operationsEnabled: false, replayed: true } });
  });
  await open(page); await select(page); await page.getByRole("button", { name: "Confirm check-in", exact: true }).click();
  const choice = state === "needs_affiliation_choice" ? "Continue with blank affiliation" : "Retry preflight reads";
  await expect(page.getByRole("button", { name: choice })).toBeEnabled();
  await expect(page.getByLabel("Decision")).toHaveText("");
  await expect(page.getByLabel("Lookup busy")).toHaveText("true");
  await page.getByRole("button", { name: "Drop test context" }).click();
  await page.getByRole("button", { name: "Restore test context" }).click();
  await page.getByRole("button", { name: choice }).click();
  await expect(page.getByRole("alert")).toContainText("unknown");
  await page.getByRole("button", { name: "Retry same confirmation" }).click();
  await expect(page.getByLabel("Decision")).toHaveText("already_handled");
  const original = JSON.parse(bodies[0]).input, linked = JSON.parse(bodies[1]).input;
  assert.notEqual(original.operationId, linked.operationId);
  assert.deepEqual(linked, { ...original, operationId: linked.operationId, priorOperationId: original.operationId, affiliationChoice: state === "needs_affiliation_choice" ? "blank" : "fetch" });
  assert.equal(bodies[1], bodies[2]);
 });
 await scenario("unmount and reload preserve opaque hold and busy without PII", async page => {
  let operationId;
  await page.route("**/api/checkin-lookup", async route => {
   const body = route.request().postDataJSON(); if (body.operation === "search") return matches(route);
   operationId = body.input.operationId; return route.abort("failed");
  });
  await open(page); await select(page); await page.getByRole("button", { name: "Confirm check-in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("unknown");
  assert.deepEqual(await page.evaluate(() => Object.entries(localStorage)), [["wts.checkin.lookup.held-operation", operationId]]);
  await page.getByRole("button", { name: "Toggle lookup mount" }).click();
  await expect(page.getByLabel("Lookup busy")).toHaveText("true");
  await page.getByRole("button", { name: "Toggle lookup mount" }).click();
  await expect(page.getByRole("button", { name: "Recover held lookup" })).toBeEnabled();
  await page.getByRole("button", { name: "Recover held lookup" }).click();
  await expect(page.getByRole("alert")).toContainText("Lookup unavailable");
  assert.equal(await page.evaluate(() => localStorage.getItem("wts.checkin.lookup.held-operation")), operationId);
  await page.reload();
  await expect(page.getByLabel("Lookup busy")).toHaveText("true");
  await expect(page.locator("body")).toContainText(operationId);
  await expect(page.locator("body")).not.toContainText(other.email);
  await expect(page.getByRole("button", { name: "Open attendee lookup" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Exit lookup and clear details" })).toBeDisabled();
 });
 for (const status of [401, 403, 409]) await scenario(`${status} search clears the previous query and selected private details`, async page => {
  let searches = 0;
  await page.route("**/api/checkin-lookup", async route => {
   searches++;
   if (searches === 1) return matches(route);
   return route.fulfill({ status, json: { error: "denied" } });
  });
  await open(page); assert.equal(searches, 0); await select(page);
  await page.getByRole("button", { name: "Search attendees" }).click();
  await expect(page.getByRole("alert")).toContainText(status === 409 ? "context changed" : "access denied");
  await expect(page.locator("body")).not.toContainText(other.email);
  await expect(page.locator("body")).not.toContainText("Shared Name");
  assert.equal(await page.locator("input").evaluateAll(inputs => inputs.some(input => input.value.includes("Shared"))), false);
  assert.equal(searches, 2);
 });
 await scenario("legacy props fail closed during null context then retry the original UUID", async page => {
  const bodies = [];
  await page.route("**/api/checkin-lookup", async route => {
   const body = route.request().postDataJSON(); if (body.operation === "search") return matches(route);
   bodies.push(route.request().postData());
   if (bodies.length === 1) return route.abort("failed");
   return route.fulfill({ json: { state: "already_handled", operationId: body.input.operationId, operationsEnabled: false, replayed: true } });
  });
  await page.goto(`${base}/?legacy`);
  await page.getByRole("button", { name: "Open attendee lookup" }).click();
  await page.getByLabel("Attendee name or email").fill("Shared");
  await select(page); await page.getByRole("button", { name: "Confirm check-in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("unknown");
  await page.getByRole("button", { name: "Drop test context" }).click();
  await expect(page.getByRole("button", { name: "Retry same confirmation" })).toBeDisabled();
  await expect(page.getByLabel("Lookup busy")).toHaveText("true");
  await page.getByRole("button", { name: "Restore test context" }).click();
  await page.getByRole("button", { name: "Retry same confirmation" }).click();
  await expect(page.getByLabel("Decision")).toHaveText("already_handled");
  assert.equal(bodies.length, 2); assert.equal(new Set(bodies).size, 1);
 });
 console.log(`${count} component-browser scenarios passed (mock transport; no PocketBase/admission/printing proof).`);
} finally { await browser?.close(); await server.close(); }
