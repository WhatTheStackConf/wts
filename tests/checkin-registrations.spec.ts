import { test, expect, login } from "./checkin-fixtures";

for (const role of ["admin", "operator"] as const) {
  test(`${role}: mobile no-station roster search, refresh, failure and auth-loss redaction`, async ({ page, state, db }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, state.users[role]);
    const documentResponse = await page.goto("/registrations");
    expect(documentResponse?.headers()["cache-control"]).toBe("private, no-store");
    await expect(page.getByRole("cell", { name: "roster0@example.invalid", exact: true })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("3 shown / 3 registrations");
    expect((await page.context().cookies()).some(cookie => /station|binding/i.test(cookie.name))).toBe(false);
    const search = page.getByRole("searchbox");
    await search.fill("roster5@example.invalid");
    await expect(page.getByRole("status")).toContainText("1 shown / 3 registrations");
    await expect(page.getByRole("cell", { name: "roster0@example.invalid", exact: true })).toHaveCount(0);
    await page.getByRole("combobox", { name: "Programme", exact: true }).selectOption("16");
    await expect(search).toHaveValue("");
    await expect(page.getByRole("cell", { name: "roster2@example.invalid", exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Programme", exact: true }).selectOption("17");
    await expect(page.getByRole("cell", { name: "roster3@example.invalid", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.route("**/api/registrations", route => route.fulfill({ status: 503, json: { error: "unavailable" } }), { times: 1 });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Registrations unavailable");
    await expect(page.getByRole("cell")).toHaveCount(0);
    await expect(page.getByText("No registrations for this programme.")).toHaveCount(0);
    const refreshed = page.waitForResponse(response => response.url().endsWith("/api/registrations") && response.status() === 200);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    const response = await refreshed;
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    const body = await response.json();
    expect(body.registrations).toHaveLength(5);
    expect(JSON.stringify(body)).not.toContain("never-expose");
    await expect(page.getByRole("cell", { name: "roster3@example.invalid", exact: true })).toBeVisible();
    await search.fill("roster3@example.invalid");
    await db.collection("users").update(state.users[role].id, { role: "user" });
    expect((await db.collection("users").getOne(state.users[role].id)).role).toBe("user");
    const denied = page.waitForResponse(response => response.url().endsWith("/api/registrations") && response.status() === 403);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await denied;
    await expect(page.getByRole("alert")).toContainText("Access denied");
    await expect(search).toHaveValue("");
    await expect(page.getByRole("cell")).toHaveCount(0);
    await db.collection("users").update(state.users[role].id, { role: role === "admin" ? "admin" : "checkin_operator" });
    expect((await db.collection("users").getOne(state.users[role].id)).role).toBe(role === "admin" ? "admin" : "checkin_operator");
  });
}

test("anonymous, ordinary and reviewer cannot access registration page or API", async ({ page, state, db }) => {
  await page.goto("/registrations");
  await expect(page).toHaveURL(/\/login/);
  expect(await page.evaluate(async () => (await fetch("/api/registrations", { method: "POST" })).status)).toBe(403);
  for (const role of ["user", "reviewer"]) {
    await db.collection("users").update(state.users.ordinary.id, { role });
    expect((await db.collection("users").getOne(state.users.ordinary.id)).role).toBe(role);
    await page.context().clearCookies();
    await login(page, state.users.ordinary);
    await page.goto("/registrations");
    await expect(page).toHaveURL(state.baseURL + "/");
    await expect(page.locator('a[href="/registrations"]')).toHaveCount(0);
    expect(await page.evaluate(async () => (await fetch("/api/registrations", { method: "POST" })).status)).toBe(403);
    await expect(page.getByText("roster0@example.invalid")).toHaveCount(0);
  }
});
