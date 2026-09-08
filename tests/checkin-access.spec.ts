import { test, expect, login, sessionCookieHeader } from "./checkin-fixtures";

test("unauthenticated and ordinary users cannot operate Check-in or administer stations", async ({ page, state, db }) => {
  const before = await db.collection("admin_actions").getList(1, 1);
  for (const operation of ["status", "admin_list"]) {
    const response = await page.request.post("/api/checkin", {
      headers: { Origin: state.baseURL }, data: { operation },
    });
    expect(response.status()).toBe(403);
  }
  await page.goto("/checkin");
  await expect(page).toHaveURL(/\/login/);
  await login(page, state.users.ordinary);
  await page.goto("/checkin");
  await expect(page.getByLabel("Station provisioning code")).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/checkin$/);
  const denied = await page.request.post("/api/checkin", {
    headers: { Origin: state.baseURL, Cookie: await sessionCookieHeader(page) }, data: { operation: "status" },
  });
  expect(denied.status()).toBe(403);
  await page.goto("/admin/checkin");
  await expect(page).not.toHaveURL(/\/admin\/checkin$/);
  expect((await db.collection("admin_actions").getList(1, 1)).totalItems).toBe(before.totalItems);
});

test("operator real login exposes the truthful unbound shell", async ({ page, state }, info) => {
  await login(page, state.users.operator);
  await page.goto("/checkin");
  await expect(page.getByLabel("Station provisioning code")).toBeVisible();
  await expect(page.getByRole("button", { name: "Review station", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /scan attendee/i })).toBeDisabled();
  await expect(page.getByRole("button", { name: /print/i })).toBeDisabled();
  await page.screenshot({ path: info.outputPath("operator-unbound.png"), fullPage: true });
});

test("checkin document excludes telemetry and lost status fails closed with retry", async ({ page, state }) => {
  await login(page, state.users.operator);
  const response = await page.goto("/checkin");
  expect(response?.headers()["content-security-policy"]).toContain("connect-src 'self'");
  expect(await response!.text()).not.toMatch(/umami\.foundry\.mk|connect\.facebook\.net|facebook\.com\/tr/);
  await expect(page.getByText("Binding: unbound", { exact: true })).toBeVisible();
  await page.getByLabel("Station provisioning code").click();
  expect(await page.locator("script").evaluateAll((scripts) => scripts.map((s) => s.getAttribute("src") + s.textContent).join("\n"))).not.toMatch(/umami\.foundry\.mk|connect\.facebook\.net/);
  await page.route("**/api/checkin", async (route) => {
    if (route.request().postDataJSON()?.operation === "status") return route.abort("failed");
    await route.fallback();
  });
  await expect(page.getByText("Cannot verify current login, binding or station state. All operations remain unavailable.", { exact: true })).toBeVisible({ timeout: 12_000 });
  await expect(page.getByText("Binding: unbound", { exact: true })).toHaveCount(0);
  await page.unroute("**/api/checkin");
  await page.getByRole("button", { name: "Refresh station status", exact: true }).click();
  await expect(page.getByText("Binding: unbound", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Scan attendee", exact: true })).toBeDisabled();
});

test("provisioning fails closed when cross-tab locking is unavailable", async ({ page, state }) => {
  await login(page, state.users.operator); await page.goto("/checkin");
  await expect(page.getByLabel("Station provisioning code")).toBeVisible();
  await page.evaluate(() => Object.defineProperty(navigator, "locks", { value: undefined, configurable: true }));
  let previews = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/checkin") && request.postDataJSON()?.operation === "preview") previews++;
  });
  await page.getByLabel("Station provisioning code").fill("f".repeat(64));
  await page.getByRole("button", { name: "Review station", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Safe station provisioning requires a browser with Web Locks over HTTPS. Use a current browser to continue.");
  expect(previews).toBe(0);
});
