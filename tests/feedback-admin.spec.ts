import { readFileSync, mkdirSync } from "node:fs";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import PocketBase from "pocketbase";
const state = JSON.parse(readFileSync(process.env.WTS_FEEDBACK_BROWSER_STATE!, "utf8"));
const pb = new PocketBase(state.pbUrl); pb.authStore.save(state.rootToken); pb.autoCancellation(false);
const screenshots = ".impeccable/review/feedback-admin";
async function login(context: BrowserContext, role = "admin") {
  await context.addCookies([{ name: "pb_auth", value: encodeURIComponent(JSON.stringify({ token: state.accounts[role].token, record: null })), url: state.baseURL, httpOnly: true, sameSite: "Lax" }, { name: "pb_auth_managed", value: "1", url: state.baseURL, httpOnly: true, sameSite: "Lax" }]);
}
async function ready(page: Page) { await expect(page.getByRole("heading", { name: "WTS 2026 main-day feedback", exact: true })).toBeVisible(); }
test.beforeEach(async ({ context }) => {
  await context.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
});
test("real results: threshold, denominators, safe DTO, escaped comments, desktop/mobile", async ({ page, context }) => {
  await login(context);
  const requests: string[] = []; page.on("request", r => requests.push(r.url()));
  const navigationResponse = await page.goto("/admin/feedback"); await ready(page);
  expect(navigationResponse!.headers()["cache-control"]).toContain("private, no-store");
  expect(navigationResponse!.headers()["content-security-policy"]).toContain("connect-src 'self'");
  const html = await navigationResponse!.text();
  expect(html).not.toMatch(/Synthetic keep|More examples|umami|fbevents|facebook.com\/tr/);
  const response = await page.request.post("/api/admin/feedback", { headers: { origin: state.baseURL } });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.results.responseCount).toBe(6); expect(body.results.overall.mean).toBe(4);
  expect(body.results.parts[0]).toMatchObject({ score: { mean: 4, count: 4 }, notApplicable: 0, skipped: 2 });
  expect(body.results.parts[2]).toMatchObject({ score: { mean: null, count: 0 }, notApplicable: 4, skipped: 2 });
  expect(body.results.sessions[0].score).toBeNull(); expect(body.results.sessions[1].score).toMatchObject({ count: 5, mean: 5 });
  expect(JSON.stringify(body)).not.toMatch(/EXCLUDED|sessionId|source_key|token_hash|created|updated|invitation|"id"|email/);
  await expect(page.getByText('<img src=x onerror="window.feedbackXss=true">', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).feedbackXss)).toBeUndefined();
  await expect(page.getByText("Not enough ratings yet", { exact: true })).toHaveCount(1);
  await expect(page.getByText("5.00 / 5", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "Refresh results" }).click(); await ready(page);
  expect(requests.some(url => /umami|facebook|fbevents/.test(url))).toBe(false);
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toMatch(/More examples|keep|answers|token|pb_auth/);
  const session = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Designing resilient systems" }) });
  await session.getByText("Organizer comments (6)", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(session.getByText("More examples, please.", { exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "open sidebar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close sidebar", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "open sidebar", exact: true })).toBeFocused();
  mkdirSync(screenshots, { recursive: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${screenshots}/desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Refresh results" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${screenshots}/mobile.png`, fullPage: true });
});
test("normal admin navigation enters a fresh tracker-free document", async ({ page, context }) => {
  await login(context); await page.goto("/admin");
  await expect(page.getByRole("link", { name: "Feedback results" })).toBeVisible();
  await page.evaluate(() => { (window as any).previousDocumentMarker = true; });
  const navigation = page.waitForEvent("response", r => r.request().isNavigationRequest() && r.url().endsWith("/admin/feedback"));
  await page.getByRole("link", { name: "Feedback results" }).click();
  const document = await navigation; await ready(page);
  expect(await page.evaluate(() => (window as any).previousDocumentMarker)).toBeUndefined();
  expect(await document.text()).not.toMatch(/umami|fbevents|facebook.com\/tr/);
});
test("loading, failure, retry and empty states use real database results", async ({ page, context }) => {
  await login(context);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/admin/feedback", async route => { await gate; await route.continue(); }, { times: 1 });
  await page.goto("/admin/feedback"); await expect(page.getByText("Loading feedback results…", { exact: true })).toBeVisible();
  release(); await ready(page);
  const corrupt = await pb.collection("feedback_responses").create({ survey: state.surveys.live, version: "v1", answers: { overall: "invalid" } });
  try {
    await page.getByRole("button", { name: "Refresh results" }).click();
    await expect(page.getByRole("alert")).toContainText("Could not load complete feedback results");
    await expect(page.getByRole("heading", { name: "Conference comments" })).toHaveCount(0);
  } finally { await pb.collection("feedback_responses").delete(corrupt.id); }
  await page.getByRole("button", { name: "Try again" }).click(); await ready(page);
  const liveRows = await pb.collection("feedback_responses").getFullList({ filter: pb.filter("survey = {:survey}", { survey: state.surveys.live }) });
  for (const row of liveRows) await pb.collection("feedback_responses").update(row.id, { survey: state.surveys.empty });
  try {
    await page.getByRole("button", { name: "Refresh results" }).click();
    await expect(page.getByText("No responses yet. Submitted answers will appear here when you refresh.")).toBeVisible();
    await expect(page.getByText("Not enough ratings yet", { exact: true })).toHaveCount(2);
  } finally {
    for (const row of liveRows) await pb.collection("feedback_responses").update(row.id, { survey: state.surveys.live });
  }
});
for (const role of ["anonymous", "reviewer", "user", "speaker", "mc", "checkin_operator"]) test(`denies ${role} in the actual server and browser`, async ({ page, context }) => {
  if (role !== "anonymous") await login(context, role);
  const response = await page.request.post("/api/admin/feedback", { headers: { origin: state.baseURL } });
  expect(response.status()).toBe(403); expect(await response.json()).toEqual({ state: "denied" });
  expect(response.headers()["cache-control"]).toContain("no-store");
  await page.goto("/admin/feedback");
  await expect(page).not.toHaveURL(/\/admin\/feedback/);
  await expect(page.getByText("More examples, please.")).toHaveCount(0);
});
