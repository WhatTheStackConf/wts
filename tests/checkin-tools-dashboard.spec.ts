import { test, expect, login, status } from "./checkin-fixtures";
import { arrivalCommand, arrivalPrerequisites } from "./checkin-arrival-fixture";
import type { CheckinEventCatalogue } from "~/lib/checkin-event-contract";
import type { CheckinArrivalResult } from "~/lib/checkin-arrival-contract";

test("Tools is a compact unbound dashboard with explicit setup", async ({ page, state }, info) => {
  await login(page, state.users.operator); await page.goto("/checkin-tools");
  await expect(page.getByRole("heading", { name: "Tools", exact: true })).toBeVisible();
  await expect(page.getByText("No station paired", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Arrivals", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Phone", exact: true })).toBeEnabled();
  await expect(page.getByLabel("Station provisioning code", { exact: true })).not.toBeVisible();
  await expect(page.getByText("Not ready for event use", { exact: false })).toHaveCount(0);
  for (const size of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole("link", { name: "Back to scanner", exact: true })).toBeInViewport();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath("tools-unbound.png"), fullPage: true });
  await page.getByRole("button", { name: "Phone", exact: true }).click();
  await page.getByText("Enter station code instead", { exact: true }).click();
  await expect(page.getByLabel("Station provisioning code", { exact: true })).toBeVisible();
});

test("Tools keeps recovery concise, fenced, and mounted through view changes", async ({ page, state, db, actorPage }, info) => {
  test.setTimeout(90000);
  await login(page, state.users.admin); const setup = await arrivalPrerequisites(page, db);
  const phone = await actorPage(state.users.operator); const errors: string[] = [];
  phone.on("pageerror", error => errors.push(error.message));
  const printCount = (await db.collection("checkin_print_attempts").getList(1, 1)).totalItems;
  try {
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.goto(`/checkin-tools#provision=${setup.stations[0].provisionCode}`);
    await phone.getByRole("button", { name: "Review station", exact: true }).click();
    await phone.getByRole("button", { name: "Confirm station binding", exact: true }).click();
    await expect.poll(async () => (await status(phone)).bindingState).toBe("bound");
    await phone.getByLabel("Event for this phone", { exact: true }).selectOption(setup.events[0].id);
    await phone.getByRole("button", { name: "Select event for this phone", exact: true }).click();
    await expect(phone.locator(".wts-tools-context")).toContainText("Synthetic conference");
    const catalogue = await arrivalCommand<CheckinEventCatalogue>(phone, "/api/checkin-events", { operation: "catalogue" });
    const result = await arrivalCommand<CheckinArrivalResult>(phone, "/api/checkin-arrivals", { operation: "preflight", command: { operationId: crypto.randomUUID(), context: catalogue.context, qrIdentity: "A-TOOLS01", affiliationChoice: "fetch" } });
    expect(result.state).toBe("reserved");
    await phone.getByRole("button", { name: "Recent work", exact: true }).click();
    const recovery = phone.getByRole("region", { name: "Station label recovery", exact: true });
    await recovery.getByRole("button", { name: "Refresh recovery history", exact: true }).click();
    const attendee = recovery.locator(".recovery-list-row").filter({ hasText: "Јана Tools dashboard" });
    await expect(attendee).toBeVisible();
    await expect(phone.getByText("Authorization generation", { exact: true })).not.toBeVisible();
    await expect(phone.getByLabel("Station provisioning code", { exact: true })).not.toBeVisible();
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await phone.screenshot({ path: info.outputPath("tools-recent-work.png"), fullPage: true });
    await attendee.click();
    await recovery.getByText("Edit label text", { exact: true }).click();
    await recovery.getByLabel("Label-only name", { exact: true }).fill("Draft survives view changes");
    await phone.getByRole("button", { name: "Diagnostics", exact: true }).click();
    await phone.getByRole("button", { name: "Recent work", exact: true }).click();
    await expect(recovery.getByLabel("Label-only name", { exact: true })).toHaveValue("Draft survives view changes");
    let dropped = false; const commands: unknown[] = [];
    await phone.route("**/api/checkin-recovery", async route => {
      const body = route.request().postDataJSON();
      if (body.operation !== "command") return route.fallback();
      commands.push(body.command);
      if (!dropped) { const response = await route.fetch(); expect(response.status()).toBe(200); dropped = true; return route.abort("failed"); }
      return route.fallback();
    });
    await recovery.getByRole("button", { name: "Park this work", exact: true }).click();
    const retry = recovery.getByRole("button", { name: "Retry exact saved recovery command", exact: true });
    await expect(retry).toBeEnabled();
    await expect(phone.getByRole("button", { name: "Phone", exact: true })).toBeDisabled();
    await expect(phone.getByRole("link", { name: "Back to scanner", exact: true })).toHaveAttribute("aria-disabled", "true");
    const savedCommand = await recovery.getByLabel("Saved recovery command ID").textContent();
    await phone.route("**/api/checkin", async route => route.request().postDataJSON()?.operation === "status" ? route.fulfill({ status: 503, json: { error: "Synthetic status outage during recovery" } }) : route.fallback());
    await phone.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(phone.getByText("Connection lost · verify station", { exact: true })).toBeVisible();
    await expect(recovery.getByLabel("Label-only name", { exact: true })).toHaveCount(0);
    await expect(recovery.getByLabel("Saved recovery command ID")).toHaveText(savedCommand!);
    await expect(retry).toBeDisabled();
    await phone.unroute("**/api/checkin");
    await phone.getByRole("button", { name: "Refresh station status", exact: true }).click();
    await recovery.getByRole("button", { name: "Reverify recovery access", exact: true }).click();
    await expect(retry).toBeEnabled();
    await retry.click(); await expect(retry).toHaveCount(0); expect(commands).toHaveLength(2); expect(commands[1]).toEqual(commands[0]);
    await expect(phone.getByRole("button", { name: "Phone", exact: true })).toBeEnabled();
    await phone.unroute("**/api/checkin-recovery");
    await phone.route("**/api/checkin", async route => route.request().postDataJSON()?.operation === "status" ? route.fulfill({ status: 503, json: { error: "Synthetic status outage" } }) : route.fallback());
    await phone.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(phone.getByText("Connection lost · verify station", { exact: true })).toBeVisible();
    await expect(phone.getByText("Јана Tools dashboard", { exact: true })).toHaveCount(0);
    await expect(recovery.getByLabel("Label-only name", { exact: true })).toHaveCount(0);
    await phone.unroute("**/api/checkin");
    await phone.getByRole("button", { name: "Refresh station status", exact: true }).click();
    await expect(phone.getByText("Connection lost · verify station", { exact: true })).toHaveCount(0);
    await phone.getByRole("button", { name: "Arrivals", exact: true }).click();
    const arrivalCommands: unknown[] = [];
    let lostArrival = false;
    await phone.route("**/api/checkin-arrivals", async route => {
      const body = route.request().postDataJSON();
      if (body.operation !== "preflight") return route.fallback();
      arrivalCommands.push(body.command);
      if (!lostArrival) { const response = await route.fetch(); expect(response.status()).toBe(200); lostArrival = true; return route.abort("failed"); }
      return route.fallback();
    });
    await phone.getByLabel("Attendee QR identity", { exact: true }).fill("A-TEST003");
    await phone.getByRole("button", { name: "Validate arrival", exact: true }).click();
    const retryArrival = phone.getByRole("button", { name: "Retry same preflight", exact: true });
    await expect(retryArrival).toBeEnabled();
    await expect(phone.getByRole("button", { name: "Phone", exact: true })).toBeDisabled();
    await expect(phone.getByRole("link", { name: "Back to scanner", exact: true })).toHaveAttribute("aria-disabled", "true");
    await retryArrival.click(); await expect(retryArrival).toHaveCount(0);
    expect(arrivalCommands).toHaveLength(2); expect(arrivalCommands[1]).toEqual(arrivalCommands[0]);
    await expect(phone.getByRole("button", { name: "Phone", exact: true })).toBeEnabled();
    await phone.getByRole("button", { name: "New arrival", exact: true }).click();
    await phone.unroute("**/api/checkin-arrivals");
    await phone.route("**/api/checkin-arrivals", route => route.request().postDataJSON()?.operation === "preflight" ? route.fulfill({ status: 400, json: { error: "Synthetic definite rejection" } }) : route.fallback());
    await phone.getByLabel("Attendee QR identity", { exact: true }).fill("A-TEST003");
    await phone.getByRole("button", { name: "Validate arrival", exact: true }).click();
    await expect(retryArrival).toBeEnabled();
    await expect(phone.getByRole("button", { name: "Phone", exact: true })).toBeDisabled();
    await phone.getByRole("button", { name: "New arrival", exact: true }).click();
    await expect(phone.getByRole("button", { name: "Phone", exact: true })).toBeEnabled();
    expect((await db.collection("checkin_print_attempts").getList(1, 1)).totalItems).toBe(printCount);
    expect(errors).toEqual([]);
  } finally { await setup.cleanup(); }
});
