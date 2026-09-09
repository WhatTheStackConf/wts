import type { Page } from "@playwright/test";
import { test, expect, login, sessionCookieHeader, type CheckinFixtureState } from "./checkin-fixtures";
import { arrivalCommand, arrivalPrerequisites, bindArrivalPhone } from "./checkin-arrival-fixture";
import type { CheckinArrivalInput, CheckinArrivalResult, CheckinArrivalHistory } from "~/lib/checkin-arrival-contract";

const endpoint = "/api/checkin-arrivals";
const preflight = (page: Page) => page.getByRole("region", { name: "Arrival preflight", exact: true });
const result = (page: Page) => page.getByRole("region", { name: "Arrival result", exact: true });
const queue = (page: Page) => page.getByRole("region", { name: "Station arrival work", exact: true });
async function upstream(state: CheckinFixtureState, mode: string) {
  const response = await fetch(`${state.upstreamURL}/__test/control`, { method: "POST", headers: { Authorization: `Bearer ${state.upstreamToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ synthetic: true, forbiddenEffects: 0 });
}
async function newArrival(page: Page) {
  const button = preflight(page).getByRole("button", { name: "New arrival", exact: true });
  if (await button.count()) await button.click();
}
async function submit(page: Page, identity: string) {
  await newArrival(page);
  await preflight(page).getByLabel("Attendee QR identity", { exact: true }).fill(identity);
  const received = page.waitForResponse((response) => response.url().endsWith(endpoint) && response.request().postDataJSON()?.operation === "preflight");
  await preflight(page).getByRole("button", { name: "Validate arrival", exact: true }).click();
  const response = await received;
  expect(response.status(), await response.text()).toBe(200);
  return response.json() as Promise<CheckinArrivalResult>;
}
async function changeEvent(page: Page, eventId: string) {
  await page.getByLabel("Event for this phone", { exact: true }).selectOption(eventId);
  await page.getByRole("button", { name: "Select event for this phone", exact: true }).click();
  await expect(page.getByText("Event context verified for this phone. Admission and printing remain disabled.", { exact: true })).toBeVisible();
}

// Only the upstream/physical evidence is synthetic. Auth, forms, application,
// immutable storage, command replay and browser navigation are the real stack.
test("arrival preflight reserves exact list members, isolates stations and preserves work across event changes and reload", async ({ page, state, db, actorPage }, info) => {
  test.setTimeout(180_000);
  await login(page, state.users.admin);
  const setup = await arrivalPrerequisites(page, db, ["wts2026station1", "wts2026station2"]);
  const phone = await actorPage(state.users.operator);
  const foreign = await actorPage(state.users.handoff);
  const errors: string[] = [];
  phone.on("pageerror", (error) => errors.push(error.message));
  try {
    await bindArrivalPhone(phone, setup.stations[0].provisionCode, setup.events[0].id);
    await phone.setViewportSize({ width: 320, height: 740 });
    await preflight(phone).getByLabel("Attendee QR identity", { exact: true }).focus();
    await expect(preflight(phone).getByLabel("Attendee QR identity", { exact: true })).toBeFocused();
    const first = await submit(phone, "A-TEST001");
    expect(first.state).toBe("reserved");
    if (first.state !== "reserved") throw new Error("Expected reserved synthetic arrival");
    expect(first.workflow).toMatchObject({ stationId: setup.stations[0].stationId, eventId: setup.events[0].id, state: "not_submitted", name: "Ана O’Neill", affiliation: "Synthetic organisation" });
    await expect(result(phone).getByText("Not submitted to Hi.Events", { exact: true })).toBeVisible();
    await expect(result(phone).getByText("Ана O’Neill", { exact: true })).toBeVisible();
    expect(await phone.evaluate(async () => {
      const loaded = await document.fonts.load('700 16px "WTS Name Label"', "Ана O’Neill");
      const name = Array.from(document.querySelectorAll("p")).find((element) => element.textContent === "Ана O’Neill");
      return loaded.length > 0 && !!name && getComputedStyle(name).fontFamily.includes("WTS Name Label");
    })).toBe(true);
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await preflight(phone).screenshot({ path: info.outputPath("arrival-reserved-320.png") });
    const again = await submit(phone, "A-TEST001");
    expect(again).toMatchObject({ state: "existing", workflow: { id: first.workflow.id } });
    await bindArrivalPhone(foreign, setup.stations[1].provisionCode, setup.events[0].id);
    const handled = await submit(foreign, "A-TEST001");
    expect(handled.state).toBe("already_handled");
    expect(JSON.stringify(handled)).not.toMatch(/Ана|O’Neill|Synthetic organisation|profileId|workflow|history/);
    await expect(result(foreign)).not.toContainText("Ана");
    expect(await submit(foreign, "A-NOTHERE")).toMatchObject({ state: "rejected", reason: "not_in_list" });
    const missing = await submit(phone, "A-TEST002");
    expect(missing).toMatchObject({ state: "reserved", workflow: { affiliation: "" } });
    for (const [identity, reason] of [["A-TEST003", "cancelled"], ["A-TEST004", "awaiting_payment"], ["A-NOTHERE", "not_in_list"], ["A-TEST007", "already_checked_in"]]) {
      expect(await submit(phone, identity)).toMatchObject({ state: "rejected", reason });
    }
    await changeEvent(phone, setup.events[1].id);
    const secondEvent = await submit(phone, "A-TEST001");
    expect(secondEvent).toMatchObject({ state: "reserved", workflow: { eventId: setup.events[1].id } });
    await phone.reload();
    await expect(queue(phone)).toBeVisible();
    await queue(phone).getByRole("button", { name: "Refresh arrival work", exact: true }).click();
    await expect(queue(phone)).toContainText("Synthetic conference");
    await expect(queue(phone)).toContainText("Synthetic workshop");
    const history = await arrivalCommand<CheckinArrivalHistory>(phone, endpoint, { operation: "history", query: {} });
    expect(history.items.some((item) => (item.result.state === "reserved" || item.result.state === "existing") && item.result.workflow.id === first.workflow.id)).toBe(true);
    const all = await arrivalCommand<CheckinArrivalHistory>(page, endpoint, { operation: "history", query: { scope: "all" } });
    expect(all.items.some((item) => item.stationId === setup.stations[1].stationId)).toBe(true);
    for (const wire of [first, history, all]) expect(JSON.stringify(wire)).not.toMatch(/A-TEST|private-arrival@|synthetic-list-capability|synthetic-checkin-capability|upstreamAttendeeId|sourceKey|qrIdentity/);
    await expect(phone.getByRole("button", { name: "Scan attendee", exact: true })).toBeDisabled();
    await expect(phone.getByRole("button", { name: "Print Name Label", exact: true })).toBeDisabled();
    expect(await db.collection("checkin_agent_attempts").getList(1, 1)).toMatchObject({ totalItems: 0 });
    expect(errors).toEqual([]);
  } finally { await setup.cleanup(); }
});

test("arrival answer outages require explicit retry or blank and delayed continuations cannot retarget another event", async ({ page, state, db, actorPage }, info) => {
  test.setTimeout(180_000);
  await login(page, state.users.admin);
  const setup = await arrivalPrerequisites(page, db);
  const phone = await actorPage(state.users.operator);
  try {
    await bindArrivalPhone(phone, setup.stations[0].provisionCode, setup.events[0].id);
    await upstream(state, "affiliation_failure");
    const failed = await submit(phone, "A-TEST005");
    expect(failed.state).toBe("needs_affiliation_choice");
    await expect(preflight(phone).getByRole("button", { name: "Retry affiliation read", exact: true })).toBeVisible();
    await expect(preflight(phone).getByRole("button", { name: "Continue with blank affiliation", exact: true })).toBeVisible();
    await phone.setViewportSize({ width: 390, height: 844 });
    await preflight(phone).screenshot({ path: info.outputPath("arrival-affiliation-choice-390.png") });
    await changeEvent(phone, setup.events[1].id);
    const delayed = phone.waitForResponse((response) => response.url().endsWith(endpoint) && response.request().postDataJSON()?.operation === "preflight");
    await preflight(phone).getByRole("button", { name: "Continue with blank affiliation", exact: true }).click();
    expect((await delayed).status()).toBe(409);
    const blankCandidate = await submit(phone, "A-TEST005");
    expect(blankCandidate.state).toBe("needs_affiliation_choice");
    const blank = phone.waitForResponse((response) => response.url().endsWith(endpoint) && response.request().postDataJSON()?.operation === "preflight");
    await preflight(phone).getByRole("button", { name: "Continue with blank affiliation", exact: true }).click();
    expect(await (await blank).json()).toMatchObject({ state: "reserved", workflow: { eventId: setup.events[1].id, affiliation: "" } });
    await changeEvent(phone, setup.events[0].id);
    expect((await submit(phone, "A-TEST005")).state).toBe("needs_affiliation_choice");
    await upstream(state, "complete");
    const retried = phone.waitForResponse((response) => response.url().endsWith(endpoint) && response.request().postDataJSON()?.operation === "preflight");
    await preflight(phone).getByRole("button", { name: "Retry affiliation read", exact: true }).click();
    expect(await (await retried).json()).toMatchObject({ state: "reserved", workflow: { eventId: setup.events[0].id, affiliation: "Synthetic organisation" } });
    await expect(result(phone).getByText("Not submitted to Hi.Events", { exact: true })).toBeVisible();
    await queue(phone).getByRole("button", { name: "Refresh arrival work", exact: true }).click();
    await expect(queue(phone).getByText("Resolved preflight exception", { exact: true }).first()).toBeVisible();
    const history = await arrivalCommand<CheckinArrivalHistory>(phone, endpoint, { operation: "history", query: {} });
    expect(history.items.filter((item) => item.resolvedByOperationId).every((item) => item.completedAt !== null)).toBe(true);
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await upstream(state, "complete"); await setup.cleanup(); }
});

test("arrival malformed committed response keeps an exact-payload retry despite failed refresh and rejects forbidden wire access", async ({ page, state, db, actorPage }) => {
  test.setTimeout(180_000);
  await login(page, state.users.admin);
  const setup = await arrivalPrerequisites(page, db);
  const phone = await actorPage(state.users.operator);
  try {
    await bindArrivalPhone(phone, setup.stations[0].provisionCode, setup.events[0].id);
    const submitted: CheckinArrivalInput[] = [];
    let saved: CheckinArrivalResult | undefined;
    await phone.route(`**${endpoint}`, async (route) => {
      const body = route.request().postDataJSON();
      if (body.operation === "history" && saved) return route.abort("failed");
      if (body.operation !== "preflight") return route.continue();
      submitted.push(body.command);
      if (submitted.length !== 1) return route.continue();
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      saved = await response.json();
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await preflight(phone).getByLabel("Attendee QR identity", { exact: true }).fill("A-TEST006");
    await preflight(phone).getByRole("button", { name: "Validate arrival", exact: true }).click();
    const retry = preflight(phone).getByRole("button", { name: "Retry same preflight", exact: true });
    await expect(retry).toBeEnabled();
    await expect(preflight(phone).getByLabel("Attendee QR identity", { exact: true })).toHaveAttribute("readonly", "");
    await queue(phone).getByRole("button", { name: "Refresh arrival work", exact: true }).click();
    await retry.click();
    await expect(result(phone).getByText("Not submitted to Hi.Events", { exact: true })).toBeVisible();
    expect(submitted).toHaveLength(2);
    expect(submitted[1]).toEqual(submitted[0]);
    expect(saved?.state).toBe("reserved");
    const commands = await db.collection("checkin_arrival_commands").getFullList({ filter: db.filter("operation_id = {:id}", { id: submitted[0].operationId }) });
    expect(commands).toHaveLength(1);
    expect(JSON.stringify(commands)).not.toContain("A-TEST006");
    await phone.unroute(`**${endpoint}`);
    const denied = await phone.request.post(endpoint, { headers: { Cookie: await sessionCookieHeader(phone), Origin: "https://foreign.invalid" }, data: { operation: "history", query: {} } });
    expect(denied.status()).toBe(403);
    const roleDenied = await phone.evaluate(async () => (await fetch("/api/checkin-arrivals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "history", query: { scope: "all" } }) })).status);
    expect(roleDenied).toBe(403);
    expect(denied.headers()["cache-control"]).toBe("private, no-store");
    const status = await fetch(`${state.upstreamURL}/__test/status`, { headers: { Authorization: `Bearer ${state.upstreamToken}` } });
    expect(await status.json()).toMatchObject({ synthetic: true, forbiddenEffects: 0 });
  } finally { await setup.cleanup(); }
});

test("arrival rebinding hides prior and delayed foreign-station results without retargeting the saved command", async ({ page, state, db, actorPage }) => {
  test.setTimeout(180_000);
  await login(page, state.users.admin);
  const setup = await arrivalPrerequisites(page, db, ["wts2026station1", "wts2026station2"]);
  const phone = await actorPage(state.users.operator);
  async function rebind(index: number) {
    await phone.getByLabel("Station provisioning code", { exact: true }).fill(setup.stations[index].provisionCode);
    await phone.getByRole("button", { name: "Review station", exact: true }).click();
    await phone.getByRole("button", { name: "Confirm station binding", exact: true }).click();
    await expect(preflight(phone).getByText(`Current station: ${setup.stations[index].label}`, { exact: false })).toBeVisible();
  }
  let release: (() => void) | undefined;
  try {
    await bindArrivalPhone(phone, setup.stations[0].provisionCode, setup.events[0].id);
    expect(["reserved", "existing"]).toContain((await submit(phone, "A-TEST001")).state);
    await expect(result(phone).getByText("Ана O’Neill", { exact: true })).toBeVisible();
    await rebind(1);
    await expect(result(phone).getByText(/^Already handled at another station\./)).toBeVisible();
    await expect(result(phone)).not.toContainText("Ана O’Neill");
    await expect(result(phone)).not.toContainText("Synthetic organisation");
    await rebind(0);
    await changeEvent(phone, setup.events[0].id);
    await newArrival(phone);
    const held = new Promise<void>((resolve) => { release = resolve; });
    let fetched: (() => void) | undefined;
    const fetchedResponse = new Promise<void>((resolve) => { fetched = resolve; });
    await phone.route(`**${endpoint}`, async (route) => {
      if (route.request().postDataJSON()?.operation !== "preflight") return route.continue();
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      fetched?.();
      await held;
      await route.fulfill({ response });
    });
    await preflight(phone).getByLabel("Attendee QR identity", { exact: true }).fill("A-TEST001");
    await preflight(phone).getByRole("button", { name: "Validate arrival", exact: true }).click();
    await fetchedResponse;
    await rebind(1);
    release!();
    await expect(result(phone).getByText("Validating arrival…", { exact: true })).toHaveCount(0);
    await expect(result(phone).getByText(/^Already handled at another station\./)).toBeVisible();
    await expect(result(phone)).not.toContainText("Ана O’Neill");
    await expect(result(phone)).not.toContainText("Synthetic organisation");
    await expect(preflight(phone).getByLabel("Attendee QR identity", { exact: true })).toHaveAttribute("readonly", "");
  } finally { release?.(); await phone.unroute(`**${endpoint}`); await setup.cleanup(); }
});
