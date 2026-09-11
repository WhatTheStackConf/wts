import { test, expect, login } from "./checkin-fixtures";
import { verifyLifecycleClosureInIsolatedFixture, verifyOperatorCannotReadLifecycle } from "./checkin-edition-lifecycle-browser-helper";

test("mounted lifecycle preserves a committed closure through response loss and stays admin-only", async ({ page, db, state, actorPage }, info) => {
  await login(page, state.users.admin);
  await page.goto("/admin/checkin");
  const operator = await actorPage(state.users.operator);
  await verifyOperatorCannotReadLifecycle(operator);
  const result = await verifyLifecycleClosureInIsolatedFixture(page);
  expect(Date.parse(result.purgeDeadline!) - Date.parse(result.closedAt!)).toBe(30 * 24 * 60 * 60 * 1000);
  expect((await db.collection("checkin_lifecycle").getOne("wts2026life0000")).closed_at).toBe(result.closedAt);
  expect((await db.collection("checkin_lifecycle_audit").getFullList({ filter: "operation = 'close'" })).length).toBe(1);
  expect((await db.collection("checkin_system").getOne("wts2026system00")).enabled).toBe(false);
  expect((await db.collection("checkin_stations").getFullList()).every(station => !station.enabled)).toBe(true);
  await page.getByRole("region", { name: "Edition lifecycle — WTS2026" }).screenshot({ path: info.outputPath("lifecycle-closure-confirmed.png") });
});
