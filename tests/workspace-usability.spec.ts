import { readFileSync } from "node:fs";
import { test, expect, type Browser, type Page, type TestInfo } from "@playwright/test";
import PocketBase from "pocketbase";
import { FALLBACK_CFP_DEADLINE } from "../src/lib/cfp-deadline";

interface WorkspaceState {
  disposable: boolean;
  baseURL: string;
  pbUrl: string;
  superuserEmail: string;
  password: string;
  users: Record<string, { id: string; email: string; password: string }>;
}
const state = JSON.parse(readFileSync(process.env.WTS_LIVE_QA_BROWSER_STATE!, "utf8")) as WorkspaceState;
if (!state.disposable || new URL(state.pbUrl).hostname !== "127.0.0.1") {
  throw new Error("Run the disposable live-Q&A browser runner with --workspace.");
}
const widths = [320, 375, 414, 768];

async function login(browser: Browser, role: string) {
  const context = await browser.newContext({ baseURL: state.baseURL, viewport: { width: 1280, height: 900 } });
  const allowed = new Set([state.baseURL, state.pbUrl]);
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return allowed.has(url.origin) || url.protocol === "data:" ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(state.users[role].email);
  await page.getByLabel("Password", { exact: true }).fill(state.users[role].password);
  await page.getByRole("button", { name: "Log In", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  return { context, page, errors };
}

async function openContainingDetails(page: Page, selector: string) {
  // Use actual disclosure interactions; do not force hidden inputs visible.
  const details = page.locator("details").filter({ has: page.locator(selector) });
  for (let index = 0; index < await details.count(); index++) {
    const item = details.nth(index);
    if (await item.getAttribute("open") === null) await item.locator(":scope > summary").click();
  }
}

async function responsive(page: Page, info: TestInfo, label: string) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => document.fonts.ready);
    const overflow = await page.locator("#main-content").evaluate(root => {
      const problems: string[] = [];
      if (document.documentElement.scrollWidth > window.innerWidth) problems.push("Document scrolls horizontally");
      for (const element of root.querySelectorAll<HTMLElement>("input:not([type=hidden]), textarea, select, .btn, h1, h2, summary")) {
        if (!element.checkVisibility()) continue;
        const rect = element.getBoundingClientRect();
        // An intentionally scrollable data table is allowed; off-canvas primary
        // controls are not. Root overflow clipping must not conceal a failure.
        if (element.closest(".overflow-x-auto")) continue;
        if (rect.left < -1 || rect.right > window.innerWidth + 1) {
          problems.push(`Offscreen: ${element.id || element.textContent?.trim().slice(0, 70) || element.tagName}`);
        }
        if (!element.matches(".btn")) continue;
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const lines: number[] = [];
        while (walker.nextNode()) {
          const text = walker.currentNode;
          if (!text.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(text);
          for (const box of range.getClientRects()) {
            if (box.width && box.height && !lines.some(top => Math.abs(top - box.top) < 4)) lines.push(box.top);
          }
        }
        if (lines.length > 1) problems.push(`Wrapped button: ${element.textContent?.trim()}`);
      }
      return problems;
    });
    expect.soft(overflow, `${label} at ${width}px`).toEqual([]);
    await page.screenshot({ path: info.outputPath(`${label}-${width}.png`), fullPage: true });
  }
}

for (const role of ["user", "reviewer", "admin", "mc", "checkin_operator"]) {
  test(`${role}: profile controls save and public visibility remains explicit`, async ({ browser }, info) => {
    const actor = await login(browser, role);
    try {
      const { page } = actor;
      await page.goto("/user/profile");
      await expect(page.locator("#profile-name")).toBeEditable();
      await expect(page.locator("#profile-email")).toBeDisabled();
      await expect(page.getByRole("heading", { level: 1 })).toContainText(/profile/i);
      const name = `QA ${role} updated`;
      await page.locator("#profile-name").fill(name);
      await page.locator("form").filter({ has: page.locator("#profile-name") }).getByRole("button", { name: /save/i }).click();
      const pb = new PocketBase(state.pbUrl);
      await pb.collection("_superusers").authWithPassword(state.superuserEmail, state.password);
      await expect.poll(async () => (await pb.collection("users").getOne(state.users[role].id)).name).toBe(name);
      await page.reload();
      await expect(page.locator("#profile-name")).toHaveValue(name);
      await expect(page.locator("#gamification-heading")).toBeVisible();
      await expect(page.locator("#ops-board-visible")).toBeAttached();
      await openContainingDetails(page, "#ops-board-visible");
      await page.locator("#ops-board-visible").uncheck();
      await page.locator("#ops-board-public-badges").uncheck();
      await page.locator("#ops-board-display-name").fill(`QA public ${role}`);
      await page.locator("form").filter({ has: page.locator("#ops-board-visible") }).getByRole("button", { name: /save/i }).click();
      await expect.poll(async () => {
        const profile = await pb.collection("gamification_profiles").getFirstListItem(pb.filter("user = {:id}", { id: state.users[role].id }));
        return { visible: profile.ops_board_visible, badges: profile.public_badges_visible, name: profile.ops_board_display_name };
      }).toEqual({ visible: false, badges: false, name: `QA public ${role}` });
      await page.reload();
      await expect(page.locator("#ops-board-visible")).toBeAttached();
      await openContainingDetails(page, "#ops-board-visible");
      await expect(page.locator("#ops-board-visible")).not.toBeChecked();
      await expect(page.locator("#ops-board-public-badges")).not.toBeChecked();
      await responsive(page, info, `profile-${role}`);
      expect(actor.errors).toEqual([]);
    } finally { await actor.context.close(); }
  });
}

test("admin destinations and CFP switch remain usable", async ({ browser }, info) => {
  const actor = await login(browser, "admin");
  try {
    const { page } = actor;
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/admin/i);
    for (const href of ["/admin/checkin", "/admin/users", "/admin/proposals", "/admin/agenda", "/admin/gamification", "/reviewer/weights", "/reviewer/leaderboard", "/admin/speakers", "/admin/sessions", "/admin/partners", "/admin/mcp", "/admin/tickets"]) {
      await expect(page.locator("main").locator(`a[href="${href}"]`).first(), href).toBeVisible();
    }
    await responsive(page, info, "admin-dashboard");
    const pb = new PocketBase(state.pbUrl);
    await pb.collection("_superusers").authWithPassword(state.superuserEmail, state.password);
    const checked = (await pb.collection("conference_config").getFirstListItem("")).cfp_open;
    const toggle = page.getByRole("button", { name: checked ? /close.*(cfp|submissions)/i : /open.*(cfp|submissions)/i });
    await expect(toggle).toBeEnabled();
    await toggle.click();
    await expect.poll(async () => (await pb.collection("conference_config").getFirstListItem("")).cfp_open).toBe(!checked);
    await page.reload();
    await page.getByRole("button", { name: checked ? /open.*(cfp|submissions)/i : /close.*(cfp|submissions)/i }).click();
    await expect.poll(async () => (await pb.collection("conference_config").getFirstListItem("")).cfp_open).toBe(checked);
    expect(actor.errors).toEqual([]);
  } finally { await actor.context.close(); }
});

test("admin hubs and reviewer screens expose compact controls at mobile widths", async ({ browser }, info) => {
  test.setTimeout(180_000);
  const admin = await login(browser, "admin");
  try {
    for (const path of ["/admin/users", "/admin/proposals", "/admin/agenda", "/admin/gamification", "/admin/speakers", "/admin/sessions", "/admin/partners", "/admin/mcp"]) {
      await admin.page.goto(path);
      await expect(admin.page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(admin.page).toHaveURL(new URL(path, state.baseURL).href);
      await expect(admin.page.locator("main")).not.toContainText("Something went wrong");
      await responsive(admin.page, info, path.replaceAll("/", "-"));
      const disclosures = admin.page.locator("main details");
      for (let index = 0; index < await disclosures.count(); index++) {
        const detail = disclosures.nth(index);
        const summary = detail.locator(":scope > summary");
        if (await summary.isVisible() && await detail.getAttribute("open") === null) {
          await summary.focus();
          await admin.page.keyboard.press("Enter");
          await expect(detail).toHaveAttribute("open", "");
        }
      }
      if (await disclosures.count()) await responsive(admin.page, info, `${path.replaceAll("/", "-")}-expanded`);
      await expect(admin.page.locator("main").getByRole("alert")).toHaveCount(0);
    }
    expect(admin.errors).toEqual([]);
  } finally { await admin.context.close(); }
  const reviewer = await login(browser, "reviewer");
  try {
    for (const path of ["/reviewer", "/reviewer/leaderboard", "/reviewer/weights", "/cfp/my-submissions", "/cfp/01-intro", "/cfp/02-personal", "/cfp/03-proposal", "/cfp/04-experience", "/cfp/05-expenses", "/cfp/06-confirmation", "/missions/redeem"]) {
      // Exercise CFP layouts inside their application window. Existing cold
      // entry checks the fallback date before loading conference_config; this
      // UI-only regression suite does not claim to fix late reopening behavior.
      await reviewer.page.clock.setFixedTime(path.startsWith("/cfp/")
        ? new Date(Date.parse(FALLBACK_CFP_DEADLINE) - 86_400_000)
        : new Date());
      await reviewer.page.goto(path);
      await expect(reviewer.page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(reviewer.page).toHaveURL(new URL(path, state.baseURL).href);
      await responsive(reviewer.page, info, path.replaceAll("/", "-"));
    }
    expect(reviewer.errors).toEqual([]);
  } finally { await reviewer.context.close(); }
});
