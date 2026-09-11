import { chromium, type Page, type Locator } from "@playwright/test";
import { join } from "node:path";
import { test, expect, login, status, phoneProvisioning, toolsView, sessionCookieHeader } from "./checkin-fixtures";
import { delayedPreviewProxy } from "./checkin-delayed-preview-proxy";

async function confirmAdmin(page: Page, button: Locator) {
  await button.click();
  const form = page.getByRole("form", { name: "Confirm administrative action" });
  await expect(form).toBeVisible();
  await expect(page.getByLabel("Reason (required)")).toBeFocused();
  await page.getByLabel("Reason (required)").selectOption("maintenance");
  const response = page.waitForResponse((r) => r.url().endsWith("/api/checkin") && r.request().postDataJSON()?.operation === "admin_control");
  await form.getByRole("button", { name: "Confirm action", exact: true }).click();
  const result = await response;
  expect(result.ok(), await result.text()).toBe(true);
  await expect(form).toHaveCount(0);
  return result.json();
}
async function enable(page: Page, station: Locator) {
  if (await page.getByRole("button", { name: "Restore system", exact: true }).count()) await confirmAdmin(page, page.getByRole("button", { name: "Restore system", exact: true }));
  if (await station.getByRole("button", { name: "Restore station", exact: true }).count()) await confirmAdmin(page, station.getByRole("button", { name: "Restore station", exact: true }));
}
async function issue(page: Page, station: Locator) {
  await confirmAdmin(page, station.getByRole("button", { name: "Issue replacement QR", exact: true }));
  const code = await page.getByLabel("Issued provisioning code").inputValue();
  expect(code).toMatch(/^[a-f0-9]{64}$/);
  await expect(page.getByRole("img", { name: "Reusable Station Provisioning QR" })).toBeVisible();
  return code;
}
async function review(page: Page, code: string) {
  await phoneProvisioning(page);
  await page.getByLabel("Station provisioning code").fill(code);
  await page.getByRole("button", { name: "Review station", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm station binding", exact: true })).toBeVisible();
}
async function bind(page: Page, code: string) {
  await review(page, code);
  await page.getByRole("button", { name: "Confirm station binding", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm station binding", exact: true })).toHaveCount(0);
  await expect.poll(async () => (await status(page)).bindingState).toBe("bound");
}
async function unready(page: Page) {
  const current = await status(page);
  expect(current.operationsEnabled).toBe(false);
  if (current.bindingState === "bound") {
    await toolsView(page, "Arrivals");
    await expect(page.getByRole("button", { name: "Validate arrival", exact: true })).toBeDisabled();
  } else {
    await expect(page.getByRole("button", { name: "Arrivals", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Validate arrival", exact: true })).not.toBeVisible();
  }
}

test("real station provisioning, reusable QR, stops, rebind, rotation and revocation", async ({ page, state, db, actorPage }, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page, state.users.admin);
  await page.goto("/admin/checkin");
  const first = page.getByRole("article", { name: "Station 1", exact: true });
  const second = page.getByRole("article", { name: "Station 2", exact: true });
  await expect(first).toBeVisible();
  await enable(page, first); await enable(page, second);
  await first.getByLabel("Location", { exact: true }).fill("Synthetic North entrance");
  await first.getByLabel("Printer asset reference").fill("TEST-PRINTER-ONE");
  await confirmAdmin(page, first.getByRole("button", { name: "Save station configuration", exact: true }));
  expect((await db.collection("checkin_stations").getOne("wts2026station1")).location).toBe("Synthetic North entrance");
  const code1 = await issue(page, first);
  const code2 = await issue(page, second);
  await page.screenshot({ path: info.outputPath("admin-desktop.png"), fullPage: true });
  const phone = await actorPage(state.users.operator);
  const requestUrls: string[] = [];
  phone.on("request", (request) => requestUrls.push(request.url()));
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(`/checkin-tools#provision=${code1}`);
  await expect(phone.getByLabel("Station provisioning code")).toHaveValue(code1);
  await expect(phone).toHaveURL(`${state.baseURL}/checkin-tools`);
  expect(await phone.evaluate(() => JSON.stringify({ local: Object.entries(localStorage), session: Object.entries(sessionStorage), history: history.state }))).not.toContain(code1);
  expect(requestUrls.some((url) => url.includes(code1))).toBe(false);
  await review(phone, code1);
  expect((await status(phone)).binding).toBeNull();
  await phone.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await status(phone)).binding).toBeNull();
  await bind(phone, code1);
  const original = await status(phone);
  const clientCookie = (await phone.context().cookies()).find((c) => c.name === "wts_checkin_client");
  expect(clientCookie?.httpOnly).toBe(true); expect(clientCookie?.sameSite).toBe("Strict");
  expect(clientCookie?.expires).toBeGreaterThan(Date.now() / 1000);
  expect(await phone.evaluate(() => document.cookie)).not.toContain("wts_checkin_client");
  await phone.reload();
  await expect.poll(async () => (await status(phone)).bindingState).toBe("bound");
  await bind(phone, code1);
  expect((await status(phone)).binding.id).toBe(original.binding.id);
  const other = await actorPage(state.users.handoff);
  await other.goto("/checkin-tools"); await bind(other, code1);
  const third = await actorPage(state.users.admin);
  await third.goto("/checkin-tools"); await bind(third, code1);
  await phone.reload();
  await toolsView(phone, "Diagnostics");
  await expect(phone.getByText(/More than two phones are active/)).toBeVisible();
  await unready(phone);
  expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await phone.screenshot({ path: info.outputPath("operator-mobile-bound.png"), fullPage: true });
  // Stale preview must fail after an administrator changes station generation.
  await review(phone, code2);
  await confirmAdmin(page, second.getByRole("button", { name: "Disable station", exact: true }));
  await phone.getByRole("button", { name: "Confirm station binding", exact: true }).click();
  await expect(phone.getByRole("alert").first()).toBeVisible();
  expect((await status(phone)).binding.stationId).toBe("wts2026station1");
  await confirmAdmin(page, second.getByRole("button", { name: "Restore station", exact: true }));
  await bind(phone, code2);
  expect((await status(phone)).binding.id).toBe(original.binding.id);
  expect((await db.collection("checkin_bindings").getOne(original.binding.id)).station).toBe("wts2026station2");
  await confirmAdmin(page, page.getByRole("button", { name: "Stop system", exact: true }));
  await expect(phone.getByText("System stopped", { exact: true })).toBeVisible({ timeout: 12_000 });
  await review(phone, code1);
  await expect(phone.getByRole("button", { name: "Confirm station binding", exact: true })).toBeDisabled();
  await unready(phone);
  await confirmAdmin(page, page.getByRole("button", { name: "Restore system", exact: true }));
  await phone.reload(); await unready(phone);
  const replacement = await issue(page, second);
  expect(replacement).not.toBe(code2);
  await phoneProvisioning(phone);
  await phone.getByLabel("Station provisioning code").fill(code2);
  await phone.getByRole("button", { name: "Review station", exact: true }).click();
  await expect(phone.getByRole("alert").first()).toBeVisible();
  expect((await status(phone)).bindingState).toBe("bound");
  await page.getByRole("button", { name: "Refresh administration", exact: true }).click();
  const binding = page.getByRole("listitem").filter({ hasText: original.binding.id }).filter({ has: page.getByRole("button", { name: "Revoke binding", exact: true }) });
  await confirmAdmin(page, binding.getByRole("button", { name: "Revoke binding", exact: true }));
  await expect(binding.getByText(/Revoked/)).toBeVisible();
  expect((await db.collection("checkin_bindings").getOne(original.binding.id)).revoked).toBe(true);
  await expect(phone.getByText("Phone revoked · ask an admin", { exact: true })).toBeVisible({ timeout: 12_000 });
  await phone.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(phone).toHaveURL(/\/login(?:[?#]|$)/);
  await login(phone, state.users.handoff); await phone.goto("/checkin-tools");
  await expect(phone.getByText("Phone revoked · ask an admin", { exact: true })).toBeVisible();
  await review(phone, replacement);
  await phone.getByRole("button", { name: "Confirm station binding", exact: true }).click();
  await expect(phone.getByRole("alert").first()).toBeVisible();
  expect((await status(phone)).bindingState).toBe("revoked");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("admin-mobile-revoked.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("persistent browser restart and logout preserve station, clearing site data unbinds", async ({ page, state }, info) => {
  test.setTimeout(90_000);
  await login(page, state.users.admin); await page.goto("/admin/checkin");
  const station = page.getByRole("article", { name: "Station 3", exact: true });
  await expect(station).toBeVisible(); await enable(page, station);
  const code = await issue(page, station);
  const profile = join(state.root, `browser-profile-${info.retry}-${info.repeatEachIndex}`);
  const unexpected: string[] = [];
  async function launch() {
    const context = await chromium.launchPersistentContext(profile, { headless: true, baseURL: state.baseURL, serviceWorkers: "block" });
    await context.route("**/*", async (route) => {
      if ([state.baseURL, state.pbUrl].includes(new URL(route.request().url()).origin)) return route.continue();
      if (["fetch", "xhr"].includes(route.request().resourceType())) unexpected.push(new URL(route.request().url()).origin);
      await route.abort("blockedbyclient");
    });
    return context;
  }
  let context = await launch();
  try {
    let phone = await context.newPage();
    await login(phone, state.users.operator); await phone.goto("/checkin-tools"); await bind(phone, code);
    const binding = (await status(phone)).binding.id;
    await phone.getByRole("button", { name: "Log out", exact: true }).click();
    await expect(phone).toHaveURL(/\/login(?:[?#]|$)/);
    await login(phone, state.users.handoff); await phone.goto("/checkin-tools");
    expect((await status(phone)).binding.id).toBe(binding);
    await context.close(); context = await launch(); phone = await context.newPage();
    await phone.goto("/checkin-tools");
    if (new URL(phone.url()).pathname === "/login") await login(phone, state.users.handoff);
    await phone.goto("/checkin-tools");
    await expect.poll(async () => (await status(phone)).bindingState).toBe("bound");
    expect((await status(phone)).binding.id).toBe(binding);
    await context.clearCookies();
    await phone.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await login(phone, state.users.operator); await phone.goto("/checkin-tools");
    await expect(phone.getByText("Pair this phone to a station", { exact: true })).toBeVisible();
    expect((await status(phone)).binding).toBeNull();
  } finally { await context.close(); }
  expect(unexpected).toEqual([]);
});

test("concurrent first previews in two tabs preserve one browser identity", async ({ browser, state, db, actorPage }) => {
  const admin = await actorPage(state.users.admin);
  await admin.goto("/admin/checkin");
  const station = admin.getByRole("article", { name: "Station 3", exact: true });
  await expect(station).toBeVisible(); await enable(admin, station);
  const code = await issue(admin, station);
  const before = (await db.collection("checkin_bindings").getList(1, 1)).totalItems;
  const proxy = await delayedPreviewProxy(state.baseURL);
  const context = await browser.newContext({ baseURL: proxy.origin, serviceWorkers: "block" });
  const unexpected: string[] = [];
  await context.route("**/*", async (route) => {
    if ([proxy.origin, state.pbUrl].includes(new URL(route.request().url()).origin)) return route.continue();
    if (["fetch", "xhr"].includes(route.request().resourceType())) unexpected.push(new URL(route.request().url()).origin);
    await route.abort("blockedbyclient");
  });
  try {
    const page = await context.newPage();
    await login(page, state.users.operator); await page.goto("/checkin-tools");
    const second = await context.newPage(); await second.goto("/checkin-tools");
    await phoneProvisioning(page);
    await page.getByLabel("Station provisioning code").fill(code);
    await page.getByRole("button", { name: "Review station", exact: true }).click();
    await proxy.firstArrived.promise;
    await phoneProvisioning(second);
    await second.getByLabel("Station provisioning code").fill(code);
    await second.getByRole("button", { name: "Review station", exact: true }).click();
    await expect(second.getByRole("button", { name: "Review station", exact: true })).toBeDisabled();
    // Give an unsafe second request a bounded opportunity to leave before any
    // identity cookie exists. Safe cross-tab serialization keeps it queued.
    await Promise.race([proxy.secondArrived.promise, new Promise((resolve) => setTimeout(resolve, 250))]);
    proxy.first.resolve();
    await page.getByRole("button", { name: "Confirm station binding", exact: true }).click();
    await expect.poll(async () => (await status(page)).bindingState).toBe("bound");
    const original = (await status(page)).binding.id;
    await proxy.secondArrived.promise;
    proxy.second.resolve();
    await second.getByRole("button", { name: "Confirm station binding", exact: true }).click();
    await expect.poll(async () => (await status(second)).bindingState).toBe("bound");
    expect((await status(second)).binding.id).toBe(original);
    expect((await db.collection("checkin_bindings").getList(1, 1)).totalItems).toBe(before + 1);
  } finally {
    proxy.first.resolve(); proxy.second.resolve();
    await context.close(); await proxy.close();
  }
  expect(unexpected).toEqual([]);
});

test("operator cannot administer, and JSON/origin validation rejects without audit writes", async ({ page, state, db }) => {
  await login(page, state.users.operator); await page.goto("/checkin-tools");
  await status(page);
  const Cookie = await sessionCookieHeader(page);
  const before = (await db.collection("checkin_audit_events").getList(1, 1)).totalItems;
  for (const operation of ["admin_list", "admin_control"]) {
    const response = await page.request.post("/api/checkin", { headers: { Origin: state.baseURL, Cookie }, data: operation === "admin_list" ? { operation } : { operation, command: { operation: "set_system_enabled", operationId: crypto.randomUUID(), expectedVersion: 1, reason: "security", enabled: true } } });
    expect(response.status()).toBe(403);
  }
  for (const headers of [{ Origin: "https://other.example.test" }, {}] as Record<string, string>[]) {
    const response = await page.request.post("/api/checkin", { headers: { ...headers, Cookie }, data: { operation: "status" } });
    expect(response.status()).toBe(403);
  }
  const invalid = await page.request.post("/api/checkin", { headers: { Origin: state.baseURL, Cookie }, data: { operation: "preview", code: "not-a-code" } });
  expect(invalid.status()).toBe(400);
  expect(invalid.headers()["cache-control"]).toContain("no-store");
  expect(invalid.headers()["referrer-policy"]).toBe("no-referrer");
  const media = await page.request.post("/api/checkin", { headers: { Origin: state.baseURL, Cookie, "Content-Type": "text/plain" }, data: "{}" });
  expect(media.status()).toBe(415);
  expect((await db.collection("checkin_audit_events").getList(1, 1)).totalItems).toBe(before);
});
