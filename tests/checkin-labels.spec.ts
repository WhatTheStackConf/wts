import { test, expect, login } from "./checkin-fixtures";

test("synthetic missing browser font: actionable preview failure without a raster request", async ({ page, state }) => {
  await login(page, state.users.admin);
  await page.route("**/fonts/checkin-label/*.ttf", (route) => route.abort("failed"));
  let renders = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/checkin-labels") && request.postDataJSON()?.operation?.startsWith("preview")) renders++;
  });
  await page.goto("/admin/checkin");
  const region = page.getByRole("region", { name: "Name Label profiles", exact: true });
  await expect(region.getByText("Pinned display fonts failed to load. Restore the bundled Name Label fonts and reload this page; preview is unavailable.", { exact: true })).toBeVisible();
  await expect(region.getByRole("button", { name: "Preview Name Label", exact: true })).toBeDisabled();
  expect(renders).toBe(0);
});

// This scenario exercises font-backed production rasterization, not a printer.
test("synthetic Name Label: loaded font raster, independent rows and no side effects", async ({ page, state, db }, info) => {
  await login(page, state.users.admin);
  await page.goto("/admin/checkin");
  const region = page.getByRole("region", { name: "Name Label profiles", exact: true });
  await expect(region).toBeVisible();
  await expect(region).toHaveAttribute("data-font-ready", "true");
  expect(await page.evaluate(() => [400, 700].every((weight) => document.fonts.check(`${weight} 16px "WTS Name Label"`, "Ѓорѓи Ќќ Žé gjpq")))).toBe(true);
  await expect(region.getByRole("paragraph").filter({ hasText: /^Synthetic preview only — not calibrated$/ })).toBeVisible();
  const beforeActions = (await db.collection("admin_actions").getList(1, 1)).totalItems;
  const beforeAudit = (await db.collection("checkin_audit_events").getList(1, 1)).totalItems;
  await region.getByLabel("Attendee name", { exact: true }).fill("Ѓорѓи Ќосев — Željko gjpqy");
  await region.getByLabel("Affiliation", { exact: true }).fill("Заедница / Société");
  const renderResponse = page.waitForResponse((r) => r.url().endsWith("/api/checkin-labels") && r.request().postDataJSON()?.operation === "preview_synthetic");
  await region.getByRole("button", { name: "Preview Name Label", exact: true }).click();
  const response = await renderResponse;
  expect(response.status(), await response.text()).toBe(200);
  const raster = await response.json();
  expect(raster.rows).toHaveLength(2);
  expect(raster.rows[0].shortened).toBe(false);
  expect(raster.rows[1].shortened).toBe(false);
  const canvas = region.getByRole("img", { name: "Rendered Name Label", exact: true });
  await expect(canvas).toHaveAttribute("data-payload-hash", raster.payloadHash);
  // Compare actual decoded PNG pixels to the browser canvas, not DOM text.
  expect(await canvas.evaluate(async (element, pngBase64) => {
    const canvas = element as HTMLCanvasElement;
    const expected = document.createElement("canvas"); expected.width = canvas.width; expected.height = canvas.height;
    const image = new Image(); image.src = `data:image/png;base64,${pngBase64}`; await image.decode();
    const context = expected.getContext("2d")!; context.drawImage(image, 0, 0);
    const wanted = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const actual = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    return { matches: actual.every((channel, index) => channel === wanted[index]), hasInk: actual.some((channel, index) => index % 4 !== 3 && channel < 128) };
  }, raster.pngBase64)).toEqual({ matches: true, hasInk: true });
  await canvas.screenshot({ path: info.outputPath("label-mixed-script-raster.png") });
  const firstHash = raster.payloadHash;
  await region.getByRole("button", { name: "Preview Name Label", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-payload-hash", firstHash);
  await region.getByLabel("Attendee name", { exact: true }).fill("Љубомир-Александар ".repeat(12).trim());
  await region.getByLabel("Affiliation", { exact: true }).fill("");
  await expect(canvas).toHaveCount(0); // Edits never retain a stale image.
  await region.getByRole("button", { name: "Preview Name Label", exact: true }).click();
  await expect(region.getByText("Name shortened with ellipsis", { exact: true })).toBeVisible();
  await expect(region.getByText("Affiliation row is blank", { exact: true })).toBeVisible();
  await expect(canvas).toBeVisible();
  await canvas.screenshot({ path: info.outputPath("label-long-blank-raster.png") });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await region.screenshot({ path: info.outputPath(`label-preview-${width}.png`) });
  }
  expect((await db.collection("admin_actions").getList(1, 1)).totalItems).toBe(beforeActions);
  expect((await db.collection("checkin_audit_events").getList(1, 1)).totalItems).toBe(beforeAudit);
  await expect(page.getByText("Software provisioning and arrival preflight only. No admission or print work can start.", { exact: false })).toBeVisible();
});
