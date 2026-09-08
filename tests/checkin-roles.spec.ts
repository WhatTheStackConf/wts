import { test, expect, login, status, sessionCookieHeader } from "./checkin-fixtures";

test("existing Users controls promote and demote a live operator session", async ({ page, state, db, actorPage }) => {
  const ordinary = await actorPage(state.users.ordinary);
  await login(page, state.users.admin);
  await page.goto("/admin/users");
  const row = page.getByRole("row").filter({ hasText: state.users.ordinary.email });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "USER", exact: true }).click();
  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    expect(dialog.message()).toContain("Check-in Operator");
    await dialog.accept();
  });
  await row.getByText("Check-in Operator", { exact: true }).click();
  await expect(row.getByRole("button", { name: "Check-in Operator", exact: true })).toBeVisible();
  expect((await db.collection("users").getOne(state.users.ordinary.id)).role).toBe("checkin_operator");
  // The existing cookie is revalidated, rather than forging a role in storage.
  await ordinary.goto("/checkin");
  await expect(ordinary.getByLabel("Station provisioning code")).toBeVisible();
  expect((await status(ordinary)).bindingState).toBe("unbound");
  await row.getByRole("button", { name: "Check-in Operator", exact: true }).click();
  page.once("dialog", async (dialog) => { expect(dialog.type()).toBe("confirm"); await dialog.accept(); });
  await row.getByText("USER", { exact: true }).click();
  await expect(row.getByRole("button", { name: "USER", exact: true })).toBeVisible();
  expect((await db.collection("users").getOne(state.users.ordinary.id)).role).toBe("user");
  // Do not refresh first: stale open UI must not retain mutation authority.
  const denied = await ordinary.request.post("/api/checkin", {
    headers: { Origin: state.baseURL, Cookie: await sessionCookieHeader(ordinary) }, data: { operation: "status" },
  });
  expect(denied.status()).toBe(403);
  await ordinary.reload();
  await expect(ordinary).not.toHaveURL(/\/checkin$/);
});
