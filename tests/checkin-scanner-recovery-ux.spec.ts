import { test, expect, login } from "./checkin-fixtures";
import { arrivalPrerequisites } from "./checkin-arrival-fixture";
import { installSyntheticCamera, showSyntheticQr } from "./checkin-camera-fixture";

test.use({ channel: "chromium", launchOptions: { args: ["--use-fake-device-for-media-stream"] } });

test("Tools URL variants keep operational headers and exclude marketing scripts", async ({ page }) => {
  for (const path of ["/checkin-tools", "/checkin-tools/", "/CHECKIN-TOOLS", "/CHECKIN/"]) {
    const response = await page.request.get(path);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect(response.headers()["content-security-policy"]).toContain("connect-src 'self'");
    expect(await response.text()).not.toMatch(/googletagmanager\.com|google-analytics\.com|umami\.foundry\.mk|dataset\.websiteId|connect\.facebook\.net|facebook\.com\/tr|fbq\(/);
  }
});

test("station QR recovery, lost event selection and lookup rejection stay actionable", async ({ page, db, state, actorPage }, info) => {
  test.setTimeout(90000);
  await login(page, state.users.admin);
  const setup = await arrivalPrerequisites(page, db);
  const phone = await actorPage(state.users.operator);
  try {
    await installSyntheticCamera(phone); await phone.context().grantPermissions(["camera"]);
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.goto("/checkin");
    await phone.getByRole("button", { name: "Start scanning", exact: true }).click();
    await expect(phone.getByText("Ready for your station QR", { exact: true })).toBeVisible();
    await showSyntheticQr(phone, "A-UXS0001");
    await expect(phone.getByRole("alert")).toContainText("not a station QR");
    await showSyntheticQr(phone, state.baseURL + "/checkin#provision=" + setup.stations[0].provisionCode);
    await expect(phone.getByRole("button", { name: "Confirm station", exact: true })).toBeVisible();
    await phone.getByRole("button", { name: "Scan a different station", exact: true }).click();
    await expect(phone.getByRole("button", { name: "Start scanning", exact: true })).toBeVisible();
    await phone.getByRole("button", { name: "Start scanning", exact: true }).click();
    await expect(phone.getByText("Ready for your station QR", { exact: true })).toBeVisible();
    await showSyntheticQr(phone, state.baseURL + "/checkin#provision=" + setup.stations[0].provisionCode);
    await phone.getByRole("button", { name: "Confirm station", exact: true }).click();
    await phone.getByLabel("Event", { exact: true }).selectOption(setup.events[0].id);
    await phone.getByRole("button", { name: "Use event", exact: true }).click();
    await expect(phone.getByRole("button", { name: "Start scanning", exact: true })).toBeEnabled();
    await phone.getByRole("button", { name: "Tools", exact: true }).click();
    await phone.getByRole("button", { name: "Change event", exact: true }).click();
    await phone.route("**/api/checkin-events", async route => {
      if (route.request().postDataJSON()?.operation !== "select") return route.continue();
      const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort("failed");
    });
    await phone.getByLabel("Event", { exact: true }).selectOption(setup.events[1].id);
    await phone.getByRole("button", { name: "Use event", exact: true }).click();
    await expect(phone.locator(".wts-operator-context")).toContainText("Synthetic workshop");
    await expect(phone.getByRole("button", { name: "Start scanning", exact: true })).toBeEnabled();
    await phone.unroute("**/api/checkin-events");
    await phone.getByRole("button", { name: "Find attendee", exact: true }).click();
    await phone.getByLabel("Attendee name or email", { exact: true }).fill("Scanner UX");
    await phone.getByRole("button", { name: "Search attendees", exact: true }).click();
    await phone.getByRole("button", { name: "Select Јана Scanner UX", exact: true }).click();
    // Explicit UI-only response fixture for a terminal rejection. Backend
    // rejection/identity semantics are covered by the persistence suites.
    await phone.route("**/api/checkin-lookup", async route => {
      if (route.request().postDataJSON()?.operation !== "confirm") return route.continue();
      const input = route.request().postDataJSON().input;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: "rejected", reason: "not_in_list", operationId: input.operationId, replayed: false, operationsEnabled: false }) });
    });
    await phone.getByRole("button", { name: "Confirm check-in", exact: true }).click();
    const result = phone.getByRole("region", { name: "Lookup result", exact: true });
    await expect(result.getByRole("heading", { name: "Ticket not accepted", exact: true })).toBeVisible();
    await expect(result).toContainText("not on this event’s list");
    await expect(result.getByRole("button", { name: "Back to scanner", exact: true })).toBeVisible();
    await phone.screenshot({ path: info.outputPath("lookup-rejection.png"), fullPage: true });
    await result.getByRole("button", { name: "Back to scanner", exact: true }).click();
    await phone.setViewportSize({ width: 844, height: 390 });
    let failed = true;
    await phone.route("**/api/checkin", route => route.request().postDataJSON()?.operation === "status" && failed ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic connection failure" }) }) : route.continue());
    await expect(phone.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    failed = false;
    await phone.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(phone.getByRole("button", { name: "Start scanning", exact: true })).toBeEnabled();
    await phone.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    const layout = await phone.evaluate(() => { const context = document.querySelector(".wts-operator-context")!.getBoundingClientRect(); const status = document.querySelector(".wts-operator-status")!.getBoundingClientRect(); return { separate: context.bottom <= status.top + 1, noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth }; });
    expect(layout).toEqual({ separate: true, noHorizontalOverflow: true });
  } finally { await setup.cleanup(); }
});
