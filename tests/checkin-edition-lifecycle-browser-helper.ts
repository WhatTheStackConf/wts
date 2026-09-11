import { expect, type Page } from "@playwright/test";
import { lifecycleStatusSchema } from "../src/lib/checkin-lifecycle-validation";

/** Integration helper, not a mocked UI test. Parent must mount
 * <CheckinLifecycleAdmin /> inside AdminCheckinPage and call this in a fresh,
 * isolated browser fixture authenticated as admin. This permanently closes
 * ONLY that disposable fixture edition; never use a production baseURL. */
export async function verifyLifecycleClosureInIsolatedFixture(page: Page) {
  const panel = page.getByRole("region", { name: "Edition lifecycle — WTS2026" });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Close WTS2026 permanently", exact: true }).click();
  const input = panel.getByLabel("Type WTS2026 exactly to confirm");
  await expect(input).toBeFocused();
  const submit = panel.getByRole("button", { name: "Confirm permanent closure", exact: true });
  await expect(submit).toBeDisabled();
  await input.fill("WTS2026");
  const commands: string[] = [];
  let corruptNextClose = true;
  let failNextRead = false;
  const endpoint = "**/api/checkin-lifecycle";
  await page.route(endpoint, async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation === "status" && failNextRead) { failNextRead = false; return route.abort("failed"); }
    if (body.operation !== "close") return route.continue();
    commands.push(route.request().postData()!);
    const realResponse = await route.fetch();
    expect(realResponse.status()).toBe(200);
    const realStatus = lifecycleStatusSchema.parse(await realResponse.json());
    expect(realStatus.closedAt).not.toBeNull();
    if (corruptNextClose) {
      corruptNextClose = false;
      // The actual mutation committed. Corrupt only its response to prove the
      // browser never treats HTTP 200 alone as closure confirmation.
      return route.fulfill({ response: realResponse, json: { ...realStatus, edition: "WRONG" } });
    }
    return route.fulfill({ response: realResponse });
  });
  try {
    await submit.click();
    const retry = panel.getByRole("button", { name: "Retry same closure command" });
    await expect(retry).toBeEnabled();
    await expect(panel.getByText(/WTS2026 closure confirmed/)).toHaveCount(0);
    failNextRead = true;
    await panel.getByRole("button", { name: "Refresh lifecycle", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("state is unavailable");
    await expect(retry).toBeEnabled();
    await retry.click();
    await expect(panel.getByText(/WTS2026 closure confirmed/)).toBeVisible();
    expect(commands).toHaveLength(2); expect(commands[0]).toBe(commands[1]);
    await expect(panel.getByRole("button", { name: "Close WTS2026 permanently", exact: true })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Review restore approval", exact: true })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Refresh lifecycle", exact: true })).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const result = await page.evaluate(async () => {
      const response = await fetch("/api/checkin-lifecycle", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "status" }) });
      return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
    });
    expect(result.status).toBe(200); expect(result.cache).toBe("private, no-store");
    const status = lifecycleStatusSchema.parse(result.body);
    expect(status.closedAt).not.toBeNull(); expect(status.purgeDeadline).not.toBeNull();
    return status;
  } finally { await page.unroute(endpoint); }
}

/** Call with a logged-in ordinary operator in the same disposable fixture. */
export async function verifyOperatorCannotReadLifecycle(page: Page) {
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/checkin-lifecycle", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "status" }) });
    return { status: response.status, body: await response.text() };
  });
  expect(result.status).toBe(403); expect(result.body).not.toContain("devices");
}
