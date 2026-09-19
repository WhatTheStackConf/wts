import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import PocketBase from "pocketbase";
import { createMissionCodeGeneration } from "../src/lib/mission-code-crypto";
import sharp from "sharp";
import jsQR from "jsqr";

interface State { disposable: boolean; baseURL: string; pbUrl: string; superuserEmail: string; password: string; users: Record<string, { id: string; email: string; password: string }> }
const state: State = JSON.parse(readFileSync(process.env.WTS_LIVE_QA_BROWSER_STATE!, "utf8"));
if (!state.disposable || [state.baseURL, state.pbUrl].some(url => new URL(url).hostname !== "127.0.0.1")) throw new Error("Use the disposable gamification runner.");
const pb = new PocketBase(state.pbUrl);
pb.autoCancellation(false);
const windowStart = new Date(Date.now() - 86_400_000).toISOString().slice(0, 16);
const windowEnd = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 16);
let questionCode = "";
let directCode = "";
let questionActivity = "";
let directActivity = "";
let scheduleId = "";
let missionId = "";
let achievementId = "";

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => { await pb.collection("_superusers").authWithPassword(state.superuserEmail, state.password); });

async function actor(browser: Browser, role?: string) {
  const context = await browser.newContext({ baseURL: state.baseURL, viewport: { width: 390, height: 844 }, timezoneId: "Europe/Skopje" });
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return [state.baseURL, state.pbUrl].includes(url.origin) || url.protocol === "data:" ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  page.on("dialog", dialog => dialog.accept());
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  if (role) { await page.goto("/login"); await login(page, role); }
  return { context, page, errors };
}
async function login(page: Page, role: string) {
  await page.getByLabel("Email", { exact: true }).fill(state.users[role].email);
  await page.getByLabel("Password", { exact: true }).fill(state.users[role].password);
  await page.getByRole("button", { name: "Log In", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
}
async function openForm(page: Page, id: string) {
  const detail = page.locator("details").filter({ has: page.locator(`#${id}`) });
  if (await detail.getAttribute("open") === null) await detail.locator(":scope > summary").click();
  return detail.locator("form");
}
async function record(collection: string, key: string) { return pb.collection(collection).getFirstListItem(pb.filter("key={:key}", { key })); }
async function recordCount(collection: string, user: string) { return (await pb.collection(collection).getList(1, 1, { filter: pb.filter("user={:user}", { user }) })).totalItems; }
async function xp(role: string) {
  const rows = await pb.collection("gamification_profiles").getList(1, 1, { filter: pb.filter("user={:user}", { user: state.users[role].id }) });
  return { total: rows.items[0]?.total_xp || 0, rank: rows.items[0]?.leaderboard_xp || 0 };
}
async function fill(page: Page, fields: Record<string, string>) { for (const [id, value] of Object.entries(fields)) await page.locator(`#${id}`).fill(value); }
async function createActivity(page: Page, key: string, total: string, rank: string) {
  let form = await openForm(page, "gam-activity-key");
  await page.locator("#gam-activity-kind").selectOption("booth");
  await expect(page.getByText("Optional partner follow-up consent", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Offer separate partner_follow_up consent" })).not.toBeChecked();
  await fill(page, { "gam-activity-key": key, "gam-activity-from": windowStart, "gam-activity-until": windowEnd });
  await page.locator("#gam-activity-kind").selectOption("qr");
  await page.locator("#gam-activity-category").selectOption("social");
  await page.locator("#gam-activity-mission").selectOption(missionId);
  await page.locator("#gam-activity-achievement").selectOption(achievementId);
  await form.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(async () => (await pb.collection("gamification_activities").getList(1, 1, { filter: pb.filter("key={:key}", { key }) })).totalItems).toBe(1);
  const activity = await record("gamification_activities", key);
  const row = page.locator("li").filter({ has: page.getByText(key, { exact: true }) }).first();
  await row.getByRole("button", { name: "Edit draft", exact: true }).click();
  form = await openForm(page, "gam-activity-key");
  await page.locator("#gam-policy-schedule").selectOption(scheduleId);
  await fill(page, { "gam-policy-key": key, "gam-policy-total": total, "gam-policy-leaderboard": rank });
  await form.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(async () => (await pb.collection("gamification_score_schedule_policies").getList(1, 1, { filter: pb.filter("activity={:id}", { id: activity.id }) })).totalItems).toBe(1);
  return activity.id;
}
async function generateCode(page: Page, activity: string, label: string, startsAt = windowStart) {
  await page.getByRole("button", { name: "Mission codes", exact: true }).click();
  await page.locator("#gam-code-activity").selectOption(activity);
  await fill(page, { "gam-code-label": label, "gam-code-from": startsAt, "gam-code-until": windowEnd });
  const form = page.locator("form").filter({ has: page.locator("#gam-code-activity") });
  await form.locator("button[type=submit]").click();
  await expect(page.getByRole("button", { name: "Download CSV now", exact: true })).toBeVisible();
  const code = await page.locator("code").filter({ hasText: /^WTS26-/ }).first().innerText();
  const image = page.getByRole("img", { name: "Mission QR code", exact: true }).first();
  await expect(image).toBeVisible();
  const source = await image.getAttribute("src");
  expect(source?.startsWith("data:image/png;base64,")).toBe(true);
  const pixels = await sharp(Buffer.from(source!.split(",")[1], "base64")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const decoded = jsQR(new Uint8ClampedArray(pixels.data), pixels.info.width, pixels.info.height);
  expect(decoded?.data === new URL(`/missions/redeem#code=${code}`, state.baseURL).href).toBe(true);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download QR", exact: true }).first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^wts-mission-[a-z0-9]+\.png$/);
  await page.getByRole("button", { name: "Clear secrets from this page", exact: true }).click();
  return code;
}

test("organizer creates direct and question QR missions through normal forms", async ({ browser }) => {
  const admin = await actor(browser, "admin");
  const page = admin.page;
  try {
    await page.goto("/admin/gamification");
    await page.getByRole("button", { name: "Score schedules", exact: true }).click();
    await fill(page, { "gam-schedule-key": "browser-qr-schedule", "gam-schedule-effective": windowStart });
    await page.getByRole("button", { name: "Create schedule draft", exact: true }).click();
    await expect.poll(async () => (await pb.collection("gamification_score_schedules").getList(1, 1, { filter: 'key="browser-qr-schedule"' })).totalItems).toBe(1);
    scheduleId = (await record("gamification_score_schedules", "browser-qr-schedule")).id;
    await page.getByRole("button", { name: "Catalog", exact: true }).click();
    const badgeForm = await openForm(page, "gam-achievement-key");
    await fill(page, { "gam-achievement-key": "browser-qr-badge", "gam-achievement-name": "Browser QR badge", "gam-achievement-description": "Synthetic rehearsal only", "gam-achievement-from": windowStart, "gam-achievement-until": windowEnd });
    await page.locator("#gam-achievement-category").selectOption("social");
    await badgeForm.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect.poll(async () => (await pb.collection("gamification_achievements").getList(1, 1, { filter: 'key="browser-qr-badge"' })).totalItems).toBe(1);
    achievementId = (await record("gamification_achievements", "browser-qr-badge")).id;
    const missionForm = await openForm(page, "gam-mission-key");
    await fill(page, { "gam-mission-key": "browser-qr-mission", "gam-mission-slug": "browser-qr-mission", "gam-mission-title": "Browser QR Mission", "gam-mission-summary": "Synthetic official QR rehearsal", "gam-mission-from": windowStart, "gam-mission-until": windowEnd });
    await page.locator("#gam-mission-category").selectOption("social");
    await page.locator("#gam-mission-achievement").selectOption(achievementId);
    await missionForm.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect.poll(async () => (await pb.collection("gamification_missions").getList(1, 1, { filter: 'key="browser-qr-mission"' })).totalItems).toBe(1);
    missionId = (await record("gamification_missions", "browser-qr-mission")).id;
    questionActivity = await createActivity(page, "browser-qr-questions", "25", "10");
    directActivity = await createActivity(page, "browser-qr-direct", "10", "5");
    await page.getByRole("button", { name: "QR questions", exact: true }).click();
    await page.locator("#mission-question-activity").selectOption(questionActivity);
    await page.getByRole("textbox", { name: /^Question\b/ }).fill("Which language adds types to JavaScript?");
    await page.getByRole("textbox", { name: /^Accepted text answers\b/ }).fill("TypeScript");
    await page.locator("#mission-question-reason").fill("Disposable browser rehearsal");
    await page.getByRole("button", { name: "Save questions", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Questions saved" })).toBeVisible();
    await page.getByRole("button", { name: "Catalog", exact: true }).click();
    await page.locator("#gam-lifecycle-reason").fill("Disposable browser activation");
    for (const [collection, key] of [["gamification_achievements", "browser-qr-badge"], ["gamification_missions", "browser-qr-mission"], ["gamification_activities", "browser-qr-questions"], ["gamification_activities", "browser-qr-direct"]]) {
      await page.locator("li").filter({ has: page.getByText(key, { exact: true }) }).first().getByRole("button", { name: "Activate", exact: true }).click();
      await expect.poll(async () => (await record(collection, key)).status).toBe("active");
    }
    await page.getByRole("button", { name: "Score schedules", exact: true }).click();
    await page.locator("#gam-schedule-activation-reason").fill("Disposable browser scoring activation");
    await page.locator("li").filter({ has: page.getByText("browser-qr-schedule", { exact: true }) }).getByRole("button", { name: "Activate", exact: true }).click();
    await expect.poll(async () => (await record("gamification_score_schedules", "browser-qr-schedule")).status).toBe("active");
    questionCode = await generateCode(page, questionActivity, "Browser questions");
    directCode = await generateCode(page, directActivity, "Browser direct");
    await page.goto("/missions");
    await expect(page.getByRole("heading", { name: "Browser QR Mission", exact: true })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("TypeScript");
    expect(admin.errors).toEqual([]);
  } finally { await admin.context.close(); }
});

test("QR login resumes questions; wrong answers give nothing; lost correct response retries once", async ({ browser }, info) => {
  const attendee = await actor(browser);
  const page = attendee.page;
  try {
    await page.goto(`/missions/redeem#code=${questionCode}`);
    await expect(page).toHaveURL(/\/login$/);
    await login(page, "user");
    await expect(page).toHaveURL(/\/missions\/redeem$/);
    const answer = page.getByRole("textbox", { name: "Which language adds types to JavaScript?", exact: true });
    await expect(answer).toBeVisible();
    await expect(answer).toBeFocused();
    await expect(page.locator("#mission-code")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Redeem code", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Complete the Mission questions", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "View achievements", exact: true })).toHaveCount(0);
    await expect(page.locator("details")).not.toHaveAttribute("open", "");
    await expect(page.getByText(/Answer before/)).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Submit answers", exact: true })).toBeInViewport();
    expect(await xp("user")).toEqual({ total: 0, rank: 0 });
    expect(await recordCount("gamification_code_redemptions", state.users.user.id)).toBe(0);
    await answer.fill("JavaScript");
    await page.getByRole("button", { name: "Submit answers", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Answers not yet correct" })).toBeVisible();
    expect(await xp("user")).toEqual({ total: 0, rank: 0 });
    await page.getByRole("button", { name: "Try questions again", exact: true }).click();
    await expect(answer).toBeVisible();
    let lost = false;
    const commands: unknown[] = [];
    await page.route("**/_server", async route => {
      const request = route.request();
      const args = request.headers()["content-type"]?.includes("application/json") ? request.postDataJSON() : null;
      if (Array.isArray(args) && args[0]?.challengeId && args[0]?.answers) {
        commands.push(args[0]);
        if (!lost) { lost = true; const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort(); return; }
      }
      await route.continue();
    });
    await answer.fill("  TYPESCRIPT  ");
    await page.getByRole("button", { name: "Submit answers", exact: true }).click();
    await expect(page.getByRole("button", { name: "Retry saved answers", exact: true })).toBeEnabled();
    await expect(answer).toBeDisabled();
    await page.getByRole("button", { name: "Retry saved answers", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Mission already recorded", exact: true })).toBeVisible();
    expect(commands).toHaveLength(2);
    expect(commands[1]).toEqual(commands[0]);
    expect(await xp("user")).toEqual({ total: 25, rank: 10 });
    for (const collection of ["gamification_activity_claims", "gamification_code_redemptions", "gamification_xp_events", "gamification_user_achievements"]) expect(await recordCount(collection, state.users.user.id)).toBe(1);
    await expect(page.locator("#mission-code")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("question-reward-mobile.png"), fullPage: true });
    expect(attendee.errors).toEqual([]);
  } finally { await page.unrouteAll({ behavior: "wait" }); await attendee.context.close(); }
});

test("direct points stay immediate and idempotent; shared question QR rewards a different User", async ({ browser }) => {
  const first = await actor(browser, "user");
  const second = await actor(browser, "other");
  try {
    await first.page.goto(`/missions/redeem#code=${directCode}`);
    await expect(first.page.getByRole("heading", { name: "Mission recorded", exact: true })).toBeVisible();
    expect(await xp("user")).toEqual({ total: 35, rank: 15 });
    await first.page.getByRole("button", { name: "Enter a different code", exact: true }).click();
    await first.page.locator("#mission-code").fill(directCode);
    await first.page.getByRole("button", { name: "Redeem code", exact: true }).click();
    await expect(first.page.getByRole("heading", { name: "Mission already recorded", exact: true })).toBeVisible();
    expect(await xp("user")).toEqual({ total: 35, rank: 15 });
    await second.page.goto(`/missions/redeem#code=${questionCode}`);
    await second.page.getByRole("textbox", { name: "Which language adds types to JavaScript?", exact: true }).fill("TypeScript");
    await second.page.getByRole("button", { name: "Submit answers", exact: true }).click();
    await expect(second.page.getByRole("heading", { name: "Mission recorded", exact: true })).toBeVisible();
    expect(await xp("other")).toEqual({ total: 25, rank: 10 });
    await first.page.goto("/user/profile"); await first.page.reload();
    await expect(first.page.getByText("Browser QR badge", { exact: true })).toBeVisible();
    expect(first.errors.concat(second.errors)).toEqual([]);
  } finally { await first.context.close(); await second.context.close(); }
});

test("a second fragment scan is explicitly rejected without replacing a pending question code", async ({ browser }) => {
  const record = await pb.collection("users").create({ email: "scan-guard@example.test", name: "Browser scan guard", password: state.password, passwordConfirm: state.password, verified: true, role: "user" });
  state.users.scan_guard = { id: record.id, email: record.email, password: state.password };
  const attendee = await actor(browser, "scan_guard");
  try {
    await attendee.page.goto(`/missions/redeem#code=${questionCode}`);
    const answer = attendee.page.getByRole("textbox", { name: "Which language adds types to JavaScript?", exact: true });
    await expect(answer).toBeVisible();
    await attendee.page.evaluate(code => { location.hash = `code=${code}`; }, directCode);
    await expect(attendee.page.locator("#mission-code-error")).toContainText("Another QR was not submitted");
    await expect(answer).toBeVisible();
    await answer.fill("TypeScript");
    await attendee.page.getByRole("button", { name: "Submit answers", exact: true }).click();
    await expect(attendee.page.getByRole("heading", { name: "Mission recorded", exact: true })).toBeVisible();
    expect(await xp("scan_guard")).toEqual({ total: 25, rank: 10 });
    await attendee.page.evaluate(code => { location.hash = `code=${code}`; }, directCode);
    await expect.poll(() => xp("scan_guard")).toEqual({ total: 35, rank: 15 });
    expect(attendee.errors).toEqual([]);
  } finally { await attendee.context.close(); }
});

test("preprinted codes register unchanged and recover a lost receipt without duplicating", async ({ browser }) => {
  const admin = await actor(browser, "admin");
  const attendee = await actor(browser, "mc");
  const reservedCode = createMissionCodeGeneration("disposable-print-reservation").rawCode;
  const commands: unknown[] = [];
  let lost = false;
  try {
    await admin.page.goto("/admin/gamification");
    await admin.page.getByRole("button", { name: "Printed codes", exact: true }).click();
    await admin.page.locator("#printed-code-activity").selectOption(directActivity);
    await admin.page.locator("#printed-code-label").fill("Browser preprinted batch");
    await admin.page.locator("#printed-code-values").fill(reservedCode);
    await admin.page.route("**/_server", async route => {
      const request = route.request();
      const args = request.headers()["content-type"]?.includes("application/json") ? request.postDataJSON() : null;
      if (Array.isArray(args) && args[0]?.rawCodes) {
        commands.push(args[0]);
        if (!lost) { lost = true; const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort(); return; }
      }
      await route.continue();
    });
    await admin.page.getByRole("button", { name: "Register printed codes", exact: true }).click();
    await expect(admin.page.getByRole("button", { name: "Retry exact registration", exact: true })).toBeEnabled();
    await admin.page.getByRole("button", { name: "Retry exact registration", exact: true }).click();
    await expect(admin.page.getByRole("status").filter({ hasText: "Registered 1 exact printed codes" })).toBeVisible();
    expect(commands).toHaveLength(2); expect(commands[1]).toEqual(commands[0]);
    expect(await admin.page.locator("#printed-code-values").inputValue()).toBe("");
    expect((await pb.collection("gamification_codes").getList(1, 10, { filter: 'label="Browser preprinted batch"' })).totalItems).toBe(1);
    await attendee.page.goto(`/missions/redeem#code=${reservedCode}`);
    await expect(attendee.page.getByRole("heading", { name: "Mission recorded", exact: true })).toBeVisible();
    expect(await xp("mc")).toEqual({ total: 10, rank: 5 });
    expect(admin.errors.concat(attendee.errors)).toEqual([]);
  } finally { await admin.page.unrouteAll({ behavior: "wait" }); await admin.context.close(); await attendee.context.close(); }
});

test("a stale question tab cannot award points to a different signed-in User", async ({ browser }) => {
  const attendee = await actor(browser, "checkin_operator");
  try {
    await attendee.page.goto(`/missions/redeem#code=${questionCode}`);
    await attendee.page.getByRole("textbox", { name: "Which language adds types to JavaScript?", exact: true }).fill("TypeScript");
    const otherTab = await attendee.context.newPage();
    await otherTab.goto("/login");
    await login(otherTab, "mc");
    const before = await xp("mc");
    await attendee.page.getByRole("button", { name: "Submit answers", exact: true }).click();
    await expect(attendee.page.locator("p.text-error[role=alert]")).toBeVisible();
    expect(await xp("mc")).toEqual(before);
    expect(await xp("checkin_operator")).toEqual({ total: 0, rank: 0 });
    expect(await recordCount("gamification_code_redemptions", state.users.checkin_operator.id)).toBe(0);
    expect(attendee.errors).toEqual([]);
  } finally { await attendee.context.close(); }
});

test("question rules lock after activation and a rate-limited form re-enables without reload", async ({ browser }) => {
  const admin = await actor(browser, "admin");
  const attendee = await actor(browser, "reviewer");
  try {
    await admin.page.goto("/admin/gamification");
    await admin.page.getByRole("button", { name: "QR questions", exact: true }).click();
    await admin.page.locator("#mission-question-activity").selectOption(questionActivity);
    await expect(admin.page.getByRole("textbox", { name: /^Question\b/ })).toBeDisabled();
    await expect(admin.page.getByRole("button", { name: "Save questions", exact: true })).toHaveCount(0);
    await attendee.page.clock.install();
    await attendee.page.goto("/missions/redeem");
    for (let attempt = 0; attempt < 4; attempt++) {
      await attendee.page.locator("#mission-code").fill(`invalid-${attempt}`);
      await attendee.page.getByRole("button", { name: "Redeem code", exact: true }).click();
      await expect(attendee.page.getByRole("heading", { name: "Mission code not verified" })).toBeVisible();
    }
    await attendee.page.locator("#mission-code").fill("invalid-throttled");
    await attendee.page.getByRole("button", { name: "Redeem code", exact: true }).click();
    await expect(attendee.page.getByRole("heading", { name: "Please wait before trying again" })).toBeVisible();
    await expect(attendee.page.locator("#mission-code")).toBeDisabled();
    await attendee.page.clock.fastForward(61_000);
    await expect(attendee.page.locator("#mission-code")).toBeEnabled();
    await expect(attendee.page.getByRole("button", { name: "Redeem code", exact: true })).toBeEnabled();
    // Browser-clock advancement proves UI recovery, not expiration of the real backend clock.
    expect(await xp("reviewer")).toEqual({ total: 0, rank: 0 });
    expect(admin.errors.concat(attendee.errors)).toEqual([]);
  } finally { await admin.context.close(); await attendee.context.close(); }
});

test("organizer previews and prepares all twelve named booth achievement drafts", async ({ browser }, info) => {
  const admin = await actor(browser, "admin");
  const page = admin.page;
  try {
    await page.goto("/admin/gamification");
    await page.getByRole("button", { name: "Score schedules", exact: true }).click();
    await fill(page, { "gam-schedule-key": "browser-booth-drafts", "gam-schedule-effective": "2026-09-18T00:00" });
    await page.getByRole("button", { name: "Create schedule draft", exact: true }).click();
    await expect.poll(async () => (await pb.collection("gamification_score_schedules").getList(1, 1, { filter: 'key="browser-booth-drafts"' })).totalItems).toBe(1);
    const schedule = await record("gamification_score_schedules", "browser-booth-drafts");
    await page.getByRole("button", { name: "2026 booth achievements", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Neon Cred", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Off-World Bound", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3 })).toHaveCount(12);
    await page.locator("#booth-catalogue-schedule").selectOption(schedule.id);
    await page.getByRole("button", { name: "Prepare 12 achievement drafts", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "12 achievement, Mission, Activity and question drafts are ready" })).toBeVisible();
    for (const collection of ["gamification_achievements", "gamification_missions", "gamification_activities"]) {
      const rows = await pb.collection(collection).getFullList({ filter: 'key ~ "wts26.booth."' });
      expect(rows).toHaveLength(12);
      expect(rows.every(row => row.status === "draft")).toBe(true);
    }
    await page.getByRole("button", { name: "Prepare 12 achievement drafts", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "12 achievement, Mission, Activity and question drafts are ready" })).toBeVisible();
    await page.screenshot({ path: info.outputPath("booth-achievement-catalogue-mobile.png"), fullPage: true });
    expect(admin.errors).toEqual([]);
  } finally { await admin.context.close(); }
});

test("three-choice half-credit question completes once and cannot be upgraded by rescanning", async ({ browser }, info) => {
  const admin = await actor(browser, "admin");
  const page = admin.page;
  const attendee = await actor(browser, "mc");
  try {
    await page.goto("/admin/gamification");
    await page.getByRole("button", { name: "Score schedules", exact: true }).click();
    // A successor schedule needs a later effective instant than the first schedule.
    const halfStart = new Date(Date.now() - 3_600_000).toISOString().slice(0, 16);
    await fill(page, { "gam-schedule-key": "browser-half-credit", "gam-schedule-effective": halfStart });
    await page.getByRole("button", { name: "Create schedule draft", exact: true }).click();
    await expect.poll(async () => (await pb.collection("gamification_score_schedules").getList(1, 1, { filter: 'key="browser-half-credit"' })).totalItems).toBe(1);
    scheduleId = (await record("gamification_score_schedules", "browser-half-credit")).id;
    await page.getByRole("button", { name: "Catalog", exact: true }).click();
    const activity = await createActivity(page, "browser-half-credit", "20", "20");
    await page.getByRole("button", { name: "QR questions", exact: true }).click();
    await page.locator("#mission-question-activity").selectOption(activity);
    await page.locator("#mission-question-policy").selectOption("correct_or_half");
    await page.getByRole("textbox", { name: /^Question\b/ }).fill("Which film inspired this year's WTS visual identity?");
    await page.getByRole("combobox", { name: "Answer type", exact: true }).selectOption("single_choice");
    await page.getByRole("textbox", { name: /^Choice labels/ }).fill("Tron\nBlade Runner\nThe Matrix");
    await page.getByRole("textbox", { name: /^Correct option numbers/ }).fill("2");
    await page.locator("#mission-question-reason").fill("Synthetic half-credit rehearsal");
    await page.getByRole("button", { name: "Save questions", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Questions saved" })).toBeVisible();
    await page.getByRole("button", { name: "Catalog", exact: true }).click();
    await page.locator("#gam-lifecycle-reason").fill("Synthetic half-credit activation");
    await page.locator("li").filter({ has: page.getByText("browser-half-credit", { exact: true }) }).first().getByRole("button", { name: "Activate", exact: true }).click();
    await expect.poll(async () => (await record("gamification_activities", "browser-half-credit")).status).toBe("active");
    await page.getByRole("button", { name: "Score schedules", exact: true }).click();
    await page.locator("#gam-schedule-activation-reason").fill("Synthetic half-credit scoring");
    await page.locator("li").filter({ has: page.getByText("browser-half-credit", { exact: true }) }).getByRole("button", { name: "Activate", exact: true }).click();
    await expect.poll(async () => (await record("gamification_score_schedules", "browser-half-credit")).status).toBe("active");
    const code = await generateCode(page, activity, "Synthetic half-credit code", halfStart);
    const before = await xp("mc");
    await attendee.page.goto(`/missions/redeem#code=${code}`);
    const choices = attendee.page.getByRole("radio");
    await expect(choices).toHaveCount(3);
    await expect(attendee.page.locator('input[type="radio"]:checked')).toHaveCount(0);
    await expect(attendee.page.locator("#mission-code")).toHaveCount(0);
    await expect(attendee.page.getByRole("heading", { name: "Complete the Mission questions", exact: true })).toHaveCount(0);
    await expect(attendee.page.getByText(/Correct answers earn full XP/)).not.toBeVisible();
    await expect(attendee.page.getByRole("button", { name: "Submit answers", exact: true })).toBeInViewport();
    await expect(attendee.page.getByRole("radio", { name: "The Matrix", exact: true })).toBeInViewport();
    expect(await attendee.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await attendee.page.screenshot({ path: info.outputPath("question-first-mobile.png") });
    await attendee.page.setViewportSize({ width: 320, height: 812 });
    await expect(attendee.page.getByRole("radio", { name: "The Matrix", exact: true })).toBeInViewport();
    await expect(attendee.page.getByRole("button", { name: "Submit answers", exact: true })).toBeInViewport();
    expect(await attendee.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await attendee.page.screenshot({ path: info.outputPath("question-first-narrow.png") });
    await attendee.page.setViewportSize({ width: 390, height: 844 });
    await attendee.page.getByRole("radio", { name: "Tron", exact: true }).check();
    await attendee.page.getByText("How it works", { exact: true }).click();
    await expect(attendee.page.getByText(/Correct answers earn full XP/)).toBeVisible();
    await expect(attendee.page.getByRole("radio", { name: "Tron", exact: true })).toBeChecked();
    await attendee.page.getByText("How it works", { exact: true }).click();
    await attendee.page.getByRole("button", { name: "Submit answers", exact: true }).click();
    await expect(attendee.page.getByRole("heading", { name: "Mission recorded", exact: true })).toBeVisible();
    expect(await xp("mc")).toEqual({ total: before.total + 10, rank: before.rank + 10 });
    await attendee.page.screenshot({ path: info.outputPath("half-credit-reward-mobile.png"), fullPage: true });
    await attendee.page.goto(`/missions/redeem#code=${code}`);
    await expect(attendee.page.getByRole("heading", { name: "Mission already recorded", exact: true })).toBeVisible();
    await expect(attendee.page.getByRole("radio")).toHaveCount(0);
    expect(await xp("mc")).toEqual({ total: before.total + 10, rank: before.rank + 10 });
    const correct = await actor(browser, "checkin_operator");
    try {
      await correct.page.setViewportSize({ width: 1280, height: 900 });
      await correct.page.goto(`/missions/redeem#code=${code}`);
      await expect(correct.page.getByRole("radio")).toHaveCount(3);
      await correct.page.screenshot({ path: info.outputPath("question-first-desktop.png") });
      await correct.page.getByRole("radio", { name: "Blade Runner", exact: true }).check();
      await correct.page.getByRole("button", { name: "Submit answers", exact: true }).click();
      await expect(correct.page.getByRole("heading", { name: "Mission recorded", exact: true })).toBeVisible();
      expect(await xp("checkin_operator")).toEqual({ total: 20, rank: 20 });
      expect(correct.errors).toEqual([]);
    } finally { await correct.context.close(); }
    expect(admin.errors.concat(attendee.errors)).toEqual([]);
  } finally { await admin.context.close(); await attendee.context.close(); }
});

test("a delayed or lost scan response never exposes the entry form and retries the same challenge", async ({ browser }) => {
  const record = await pb.collection("users").create({ email: "question-first@example.test", name: "Question-first rehearsal", password: state.password, passwordConfirm: state.password, verified: true, role: "user" });
  state.users.question_first = { id: record.id, email: record.email, password: state.password };
  const attendee = await actor(browser, "question_first");
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let lost = false;
  await attendee.page.route("**/_server", async route => {
    const request = route.request();
    const args = request.headers()["content-type"]?.includes("application/json") ? request.postDataJSON() : null;
    if (!lost && Array.isArray(args) && args[0] === questionCode) {
      lost = true;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await barrier;
      await route.abort();
      return;
    }
    await route.continue();
  });
  try {
    await attendee.page.goto(`/missions/redeem#code=${questionCode}`);
    await expect(attendee.page.getByRole("status").filter({ hasText: "Opening mission" })).toBeVisible();
    await expect(attendee.page.locator("#mission-code")).toHaveCount(0);
    await expect.poll(() => recordCount("gamification_question_attempts", record.id)).toBe(1);
    release();
    await expect(attendee.page.getByRole("button", { name: "Retry scan", exact: true })).toBeEnabled();
    await attendee.page.getByRole("button", { name: "Retry scan", exact: true }).click();
    await expect(attendee.page.getByRole("textbox", { name: "Which language adds types to JavaScript?", exact: true })).toBeVisible();
    await expect(attendee.page.locator("#mission-code")).toHaveCount(0);
    expect(await recordCount("gamification_question_attempts", record.id)).toBe(1);
    expect(await recordCount("gamification_code_redemptions", record.id)).toBe(0);
    expect(attendee.errors).toEqual([]);
  } finally { release(); await attendee.page.unrouteAll({ behavior: "wait" }); await attendee.context.close(); }
});
