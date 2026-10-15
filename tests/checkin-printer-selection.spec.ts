import { test, expect, login, status, toolsView } from "./checkin-fixtures";
import { arrivalCommand, arrivalPrerequisites } from "./checkin-arrival-fixture";
import type { CheckinEventCatalogue } from "~/lib/checkin-event-contract";

test("operators select printers without a QR, retain the event and reconcile a lost switch response", async ({ page, db, state, actorPage }, info) => {
  test.setTimeout(90000);
  await login(page, state.users.admin);
  const setup = await arrivalPrerequisites(page, db, ["wts2026station1", "wts2026station2"]);
  const stopped = await db.collection("checkin_stations").getOne("wts2026station3", { fields: "id,enabled,version" });
  if (stopped.enabled) await arrivalCommand(page, "/api/checkin", { operation: "admin_control", command: { operation: "set_station_enabled", stationId: stopped.id, enabled: false, expectedVersion: stopped.version, operationId: crypto.randomUUID(), reason: "configuration" } });
  const initialWorkflows = (await db.collection("checkin_arrival_workflows").getList(1, 1)).totalItems;
  const initialPrints = (await db.collection("checkin_print_attempts").getList(1, 1)).totalItems;
  const phone = await actorPage(state.users.operator);
  const operations: string[] = [];
  phone.on("request", request => {
    if (new URL(request.url()).pathname === "/api/checkin" && request.method() === "POST") operations.push(request.postDataJSON().operation);
  });
  try {
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.goto("/checkin");
    const picker = phone.getByLabel("Printer", { exact: true });
    await expect(picker).toBeVisible();
    await expect(picker.locator('option[value="wts2026station3"]')).toBeDisabled();
    // Catalogue establishes the HttpOnly identity before any routing row exists.
    // A status poll in that interval calls it invalid, not revoked: choosing a
    // first printer must still work if the operator pauses on this screen.
    await expect.poll(async () => (await status(phone)).bindingState).toBe("invalid");
    const observation = phone.waitForResponse(response => new URL(response.url()).pathname === "/api/checkin" && response.request().postDataJSON()?.operation === "status");
    await phone.evaluate(() => window.dispatchEvent(new Event("focus")));
    await observation;
    await expect(picker).toBeEnabled();
    await expect(phone.getByRole("button", { name: "Review station", exact: true })).toHaveCount(0);
    await picker.selectOption("wts2026station1");
    await expect.poll(async () => (await status(phone)).station?.id).toBe("wts2026station1");
    await phone.getByLabel("Event", { exact: true }).selectOption(setup.events[0].id);
    await phone.getByRole("button", { name: "Use event", exact: true }).click();
    await expect(phone.getByRole("button", { name: "Start scanning", exact: true })).toBeEnabled();
    const before = await arrivalCommand<CheckinEventCatalogue>(phone, "/api/checkin-events", { operation: "catalogue" });
    let committedLostReply = false;
    await phone.route("**/api/checkin", async route => {
      const body = route.request().postDataJSON();
      if (body.operation !== "select_printer" || body.confirmation.stationId !== "wts2026station2" || committedLostReply) return route.continue();
      const result = await route.fetch();
      expect(result.status()).toBe(200);
      expect((await result.json()).station.id).toBe("wts2026station2");
      committedLostReply = true;
      await route.abort("failed");
    });
    await picker.selectOption("wts2026station2");
    await expect.poll(() => committedLostReply).toBe(true);
    await expect(picker).toHaveValue("wts2026station2");
    await expect(picker).toBeEnabled();
    await expect(phone.getByRole("button", { name: "Start scanning", exact: true })).toBeEnabled();
    const after = await arrivalCommand<CheckinEventCatalogue>(phone, "/api/checkin-events", { operation: "catalogue" });
    expect(after.selected?.id).toBe(before.selected?.id);
    expect(after.context?.stationId).toBe("wts2026station2");
    expect(after.context?.bindingVersion).toBe(before.context!.bindingVersion + 1);
    expect(after.context?.selectionVersion).toBe(before.context!.selectionVersion + 1);
    await phone.reload();
    await expect(picker).toHaveValue("wts2026station2");
    await expect(phone.getByRole("button", { name: "Start scanning", exact: true })).toBeEnabled();
    await info.attach("mobile-printer-dropdown", { body: await phone.screenshot(), contentType: "image/png" });
    await phone.goto("/checkin-tools");
    await toolsView(phone, "Phone");
    await phone.getByLabel("Printer", { exact: true }).selectOption("wts2026station1");
    await expect.poll(async () => (await status(phone)).station?.id).toBe("wts2026station1");
    await expect(phone.getByLabel("Printer", { exact: true })).toHaveValue("wts2026station1");
    expect(operations.filter(op => op === "select_printer")).toHaveLength(3);
    expect(operations).not.toContain("preview");
    expect(operations).not.toContain("bind");
    expect((await db.collection("checkin_arrival_workflows").getList(1, 1)).totalItems).toBe(initialWorkflows);
    expect((await db.collection("checkin_print_attempts").getList(1, 1)).totalItems).toBe(initialPrints);
    const ordinary = await actorPage(state.users.ordinary);
    const denied = await ordinary.evaluate(async () => (await fetch("/api/checkin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "printers" }) })).status);
    expect(denied).toBe(403);
  } finally { await setup.cleanup(); }
});
