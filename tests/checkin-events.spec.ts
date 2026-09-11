import type { Page } from "@playwright/test";
import { test, expect, login, status, phoneProvisioning, toolsView } from "./checkin-fixtures";
import type { CheckinAdminDTO } from "~/lib/checkin-contract";
import type { CheckinConfigureEventResult, CheckinEventCatalogue } from "~/lib/checkin-event-contract";

async function command<T>(page: Page, endpoint: string, body: object): Promise<T> {
  const result = await page.evaluate(async ({ endpoint, body }) => {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }, { endpoint, body });
  expect(result.status, JSON.stringify(result.data)).toBe(200);
  return result.data;
}
async function configure(page: Page, eventId: string, options: { enabled?: boolean; list?: boolean; affiliation?: boolean } = {}) {
  const region = page.getByRole("region", { name: "Event configuration", exact: true });
  await region.getByLabel("Hi.Events event", { exact: true }).selectOption(eventId);
  await expect(region.getByText("Loading admission lists, affiliation questions and products…", { exact: true })).toHaveCount(0);
  await region.getByLabel("This event belongs to WTS 2026", { exact: true }).check();
  await region.getByLabel("Admission list (required when enabled)", { exact: true }).selectOption(options.list === false ? "" : "701");
  if (options.affiliation) {
    await region.getByLabel("Affiliation question (optional)", { exact: true }).selectOption("801");
    await region.getByLabel("Synthetic ticket · ID 601", { exact: true }).check();
  }
  await region.getByLabel("Enable this event configuration", { exact: true }).setChecked(options.enabled !== false);
  await region.getByRole("button", { name: "Review event configuration", exact: true }).click();
  const form = region.getByRole("form", { name: "Confirm event configuration", exact: true });
  await expect(form.getByLabel("Reason (required)", { exact: true })).toBeFocused();
  await form.getByLabel("Reason (required)", { exact: true }).selectOption("configuration");
  const response = page.waitForResponse((response) => response.url().endsWith("/api/checkin-events") && response.request().postDataJSON()?.operation === "configure");
  await form.getByRole("button", { name: "Confirm event configuration", exact: true }).click();
  const result = await response;
  expect(result.status(), await result.text()).toBe(200);
  await expect(form).toHaveCount(0);
  return result.json() as Promise<CheckinConfigureEventResult>;
}
async function bind(page: Page, code: string) {
  await page.goto("/checkin-tools");
  await phoneProvisioning(page);
  await page.getByLabel("Station provisioning code").fill(code);
  await page.getByRole("button", { name: "Review station", exact: true }).click();
  await page.getByRole("button", { name: "Confirm station binding", exact: true }).click();
  await expect.poll(async () => (await status(page)).bindingState).toBe("bound");
}
async function select(page: Page, id: string, title: string) {
  await toolsView(page, "Phone");
  await page.getByLabel("Event for this phone", { exact: true }).selectOption(id);
  await page.getByRole("button", { name: "Select event for this phone", exact: true }).click();
  await expect(page.getByText(`Current event: ${title}`, { exact: true })).toBeVisible();
  await expect(page.getByText("Event selection saved for this phone only. Other phones and existing work are unchanged.", { exact: true })).toBeVisible();
  expect((await command<CheckinEventCatalogue>(page, "/api/checkin-events", { operation: "catalogue" })).context).toMatchObject({ eventId: id });
}

test("synthetic upstream: real admin mapping and independent phone event selection", async ({ page, state, db, actorPage }, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page, state.users.admin);
  await page.goto("/admin/checkin");
  const region = page.getByRole("region", { name: "Event configuration", exact: true });
  await expect(region.getByLabel("Hi.Events event", { exact: true }).getByRole("option")).toHaveCount(5);
  const first = await configure(page, "501", { affiliation: true });
  const second = await configure(page, "502");
  const unconfigured = await configure(page, "503", { enabled: false, list: false });
  const disabled = await configure(page, "504", { enabled: false });
  expect(first.configuration.affiliation).toEqual({ questionId: "801", productIds: ["601"] });
  expect((await db.collection("checkin_events").getOne(first.configuration.id)).upstream_event_id).toBe("501");
  await page.getByRole("button", { name: "Refresh administration", exact: true }).click();
  // Other independently exercised workflows may already have configured events.
  // Verify these exact actions rather than assuming the shared audit page is empty.
  for (const configured of [first, second, unconfigured, disabled]) {
    const audits = await db.collection("checkin_audit_events").getFullList({ filter: db.filter("admin_action_id = {:id}", { id: configured.actionId }) });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ operation: "configure_event", event_id: configured.configuration.id });
    await expect(page.getByRole("region", { name: "Check-in audit", exact: true }).getByText(`configure_event · Event ${configured.configuration.id} · applied`, { exact: true }).first()).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await region.getByLabel("Hi.Events event", { exact: true }).selectOption("501");
  await expect(region.getByLabel("Affiliation question (optional)", { exact: true })).toHaveValue("801");
  await expect(region.getByLabel("Enable this event configuration", { exact: true })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await region.screenshot({ path: info.outputPath("events-admin-mobile.png") });
  const overview = await command<CheckinAdminDTO>(page, "/api/checkin", { operation: "admin_list" });
  const base = { reason: "configuration", operationId: crypto.randomUUID() };
  if (!overview.system.enabled) await command(page, "/api/checkin", { operation: "admin_control", command: { ...base, operation: "set_system_enabled", expectedVersion: overview.system.version, enabled: true } });
  let station = overview.stations[0];
  if (!station.enabled) {
    const changed = await command<{ station: typeof station }>(page, "/api/checkin", { operation: "admin_control", command: { ...base, operationId: crypto.randomUUID(), operation: "set_station_enabled", stationId: station.id, expectedVersion: station.version, enabled: true } });
    station = changed.station;
  }
  const issued = await command<{ provisionCode: string }>(page, "/api/checkin", { operation: "admin_control", command: { ...base, operationId: crypto.randomUUID(), operation: "rotate_provision_code", stationId: station.id, expectedVersion: station.version } });
  const phone = await actorPage(state.users.operator);
  const other = await actorPage(state.users.handoff);
  for (const target of [phone, other]) { target.on("pageerror", (error) => errors.push(error.message)); await target.setViewportSize({ width: 390, height: 844 }); await bind(target, issued.provisionCode); }
  const options = phone.getByLabel("Event for this phone", { exact: true });
  await expect(options.getByRole("option").filter({ hasText: "Synthetic unconfigured" })).toBeDisabled();
  await expect(options.getByRole("option").filter({ hasText: "Synthetic disabled" })).toBeDisabled();
  const before = await command<CheckinEventCatalogue>(phone, "/api/checkin-events", { operation: "catalogue" });
  expect(before.events.map((entry) => entry.id)).toEqual([first.configuration.id, second.configuration.id, unconfigured.configuration.id, disabled.configuration.id]);
  await select(phone, first.configuration.id, "Synthetic conference");
  await expect(other.getByText("No event selected", { exact: true })).toBeVisible();
  await select(other, second.configuration.id, "Synthetic workshop");
  await phone.reload();
  await toolsView(phone, "Phone");
  await expect(phone.getByText("Current event: Synthetic conference", { exact: true })).toBeVisible();
  expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await phone.getByRole("region", { name: "This phone's event", exact: true }).screenshot({ path: info.outputPath("events-operator-mobile.png") });
  expect((await status(phone)).operationsEnabled).toBe(false);
  const wire = await command<CheckinEventCatalogue>(phone, "/api/checkin-events", { operation: "catalogue" });
  expect(JSON.stringify(wire)).not.toMatch(/short_id|listCapabilities|synthetic-list-capability|affiliation|sourceKey|upstreamEventId/);
  await configure(page, "501", { enabled: false });
  await phone.getByRole("button", { name: "Refresh event catalogue", exact: true }).click();
  await expect(phone.getByText("Stale configuration — refresh and explicitly select again", { exact: true })).toBeVisible();
  expect((await command<CheckinEventCatalogue>(phone, "/api/checkin-events", { operation: "catalogue" })).context).toBeNull();
  expect((await command<CheckinEventCatalogue>(other, "/api/checkin-events", { operation: "catalogue" })).selected?.id).toBe(second.configuration.id);
  // Actual server-side adapter failure, not a mocked browser catalogue response.
  const upstreamControl = async (mode: string) => {
    const response = await fetch(`${state.upstreamURL}/__test/control`, { method: "POST", headers: { Authorization: `Bearer ${state.upstreamToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ synthetic: true, forbiddenEffects: 0 });
  };
  try {
    await upstreamControl("expired_list");
    await other.getByRole("button", { name: "Refresh event catalogue", exact: true }).click();
    await expect(other.getByText("Upstream unavailable — configuration cannot be verified", { exact: true })).toBeVisible();
    const expired = await command<CheckinEventCatalogue>(other, "/api/checkin-events", { operation: "catalogue" });
    expect(expired.context).toBeNull();
    const rejected = await other.evaluate(async (selection) => {
      const response = await fetch("/api/checkin-events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "select", selection }) });
      return response.status;
    }, { ...expired.fence, eventId: second.configuration.id, eventGeneration: 1 });
    expect(rejected).toBe(409);
    await upstreamControl("partial");
    await page.getByRole("button", { name: "Refresh event catalogue", exact: true }).click();
    await expect(region.getByText("Event discovery is partial. Missing events are not evidence of an empty account. Retry the event catalogue.", { exact: true })).toBeVisible();
    await other.getByRole("button", { name: "Refresh event catalogue", exact: true }).click();
    await expect(other.getByText("Event catalogue is partial. Missing events are not an empty catalogue. Unverified entries cannot be selected.", { exact: true })).toBeVisible();
    await expect(other.getByRole("button", { name: "Select event for this phone", exact: true })).toBeDisabled();
    expect((await command<CheckinEventCatalogue>(other, "/api/checkin-events", { operation: "catalogue" })).context).toBeNull();
    await upstreamControl("unavailable");
    await page.getByRole("button", { name: "Refresh event catalogue", exact: true }).click();
    await expect(region.getByText("Event discovery is unavailable. Missing events are not evidence of an empty account. Retry the event catalogue.", { exact: true })).toBeVisible();
  } finally { await upstreamControl("complete"); }
  expect(errors).toEqual([]);
});

test("synthetic lost response: admin retries the frozen configuration without a second audit", async ({ page, state, db }) => {
  await login(page, state.users.admin); await page.goto("/admin/checkin");
  const region = page.getByRole("region", { name: "Event configuration", exact: true });
  await region.getByLabel("Hi.Events event", { exact: true }).selectOption("501");
  await expect(region.getByText("Loading admission lists, affiliation questions and products…", { exact: true })).toHaveCount(0);
  await region.getByLabel("This event belongs to WTS 2026", { exact: true }).check();
  await region.getByLabel("Admission list (required when enabled)", { exact: true }).selectOption("701");
  await region.getByLabel("Enable this event configuration", { exact: true }).check();
  await region.getByRole("button", { name: "Review event configuration", exact: true }).click();
  const form = region.getByRole("form", { name: "Confirm event configuration", exact: true });
  await form.getByLabel("Reason (required)", { exact: true }).selectOption("configuration");
  let submitted: unknown;
  let dropped = false;
  await page.route("**/api/checkin-events", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.operation !== "configure" || dropped) return route.continue();
    submitted = body;
    const response = await route.fetch(); // Real server commits, only the browser response is lost.
    expect(response.status()).toBe(200);
    dropped = true;
    await route.abort("failed");
  });
  await form.getByRole("button", { name: "Confirm event configuration", exact: true }).click();
  await expect(form.getByRole("button", { name: "Retry same event configuration", exact: true })).toBeVisible();
  await expect(form.getByLabel("Note (optional)", { exact: true })).toBeDisabled();
  await expect(region.getByLabel("Admission list (required when enabled)", { exact: true })).toBeDisabled();
  const response = page.waitForResponse((response) => response.url().endsWith("/api/checkin-events") && response.request().postDataJSON()?.operation === "configure");
  await form.getByRole("button", { name: "Retry same event configuration", exact: true }).click();
  const replay = await response;
  expect(replay.status()).toBe(200);
  expect(replay.request().postDataJSON()).toEqual(submitted);
  const result = await replay.json() as CheckinConfigureEventResult;
  expect(result.replayed).toBe(true);
  expect(await db.collection("checkin_audit_events").getFullList({ filter: db.filter("admin_action_id = {:id}", { id: result.actionId }) })).toHaveLength(1);
  await expect(form).toHaveCount(0);
});
