import { readFileSync } from "node:fs";
import { test, expect, type Browser, type Page, type TestInfo } from "@playwright/test";
import PocketBase from "pocketbase";

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

async function loginWithCredentials(browser: Browser, email: string, password: string) {
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
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log In", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  return { context, page, errors };
}

async function login(browser: Browser, role: string) {
  const user = state.users[role];
  return loginWithCredentials(browser, user.email, user.password);
}
async function navigateClientSide(page: Page, path: string) {
  await page.evaluate(({ target }) => {
    let link = document.querySelector<HTMLAnchorElement>('[data-testid="capability-smoke-link"]');
    if (!link) {
      link = document.createElement("a");
      link.dataset.testid = "capability-smoke-link";
      link.textContent = "Navigate to protected route";
      link.style.cssText = "position:fixed;top:0;left:0;z-index:99999;background:#fff;color:#000;padding:8px";
      document.body.append(link);
    }
    link.href = target;
  }, { target: path });
  await page.getByTestId("capability-smoke-link").click();
  await expect(page).toHaveURL(new URL(path, state.baseURL).href);
  await expect(page.getByRole("heading", { name: "404", exact: true })).toBeVisible();
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
      const nameOf = (element: HTMLElement) => element.id || element.textContent?.trim().slice(0, 70) || element.tagName;
      const lineTops = (element: HTMLElement) => {
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
        return lines;
      };
      if (document.documentElement.scrollWidth > window.innerWidth) problems.push("Document scrolls horizontally");
      for (const element of root.querySelectorAll<HTMLElement>("input:not([type=hidden]), textarea, select, .btn, h1, h2, summary")) {
        if (!element.checkVisibility()) continue;
        const rect = element.getBoundingClientRect();
        // An intentionally scrollable data table is allowed; off-canvas primary
        // controls are not. Root overflow clipping must not conceal a failure.
        if (element.closest(".overflow-x-auto")) continue;
        if (rect.left < -1 || rect.right > window.innerWidth + 1) {
          problems.push(`Offscreen: ${nameOf(element)}`);
        }
        if (!element.matches(".btn")) continue;
        if (lineTops(element).length > 1) problems.push(`Wrapped button: ${element.textContent?.trim()}`);
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

test("profile email truncates inside the identity column", async ({ browser }) => {
  const actor = await login(browser, "user");
  try {
    const { page } = actor;
    await page.goto("/user/profile");
    const email = page.getByText(state.users.user.email, { exact: true });
    const logout = page.getByRole("button", { name: "Log out" });
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => document.fonts.ready);
      const box = (await email.boundingBox())!;
      const column = (await logout.boundingBox())!;
      expect.soft(box.x, `email left edge at ${width}px`).toBeGreaterThanOrEqual(column.x - 1);
      expect.soft(box.x + box.width, `email right edge at ${width}px`).toBeLessThanOrEqual(Math.min(column.x + column.width, width) + 1);
      if (width > 390) continue;
      const truncated = await email.evaluate(element => element.scrollWidth > element.clientWidth);
      expect.soft(truncated, `email ellipsis at ${width}px`).toBe(true);
    }
  } finally { await actor.context.close(); }
});

test("admin destinations and closed CFP preparation remain usable", async ({ browser }, info) => {
  const actor = await login(browser, "admin");
  try {
    const { page } = actor;
    const pb = new PocketBase(state.pbUrl);
    await pb.collection("_superusers").authWithPassword(state.superuserEmail, state.password);
    const configuration = await pb.collection("conference_config").getFirstListItem("");
    await pb.collection("conference_config").update(configuration.id, {
      cfp_open: true,
      availability: { cfp: true, review: true },
    });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/admin/i);
    for (const href of ["/admin/checkin", "/admin/users", "/admin/proposals", "/admin/agenda", "/admin/gamification", "/reviewer/weights", "/reviewer/leaderboard", "/admin/speakers", "/admin/sessions", "/admin/partners", "/admin/mcp", "/admin/tickets"]) {
      await expect(page.locator("main").locator(`a[href="${href}"]`).first(), href).toBeVisible();
    }
    await expect(page.locator('section[aria-labelledby="cfp-settings-title"]').getByText("Active", { exact: true })).toBeVisible();
    await responsive(page, info, "admin-dashboard");
    const deadline = page.locator("#cfp-deadline");
    await deadline.fill("2027-06-30");
    await page.getByRole("button", { name: "Save closed configuration" }).click();
    await expect.poll(async () => {
      const updated = await pb.collection("conference_config").getOne(configuration.id);
      return { cfp_open: updated.cfp_open, availability: updated.availability };
    }).toEqual({ cfp_open: false, availability: { cfp: false, review: false } });
    await expect(page.locator('section[aria-labelledby="cfp-settings-title"]').getByText("Closed", { exact: true })).toBeVisible();
    for (const path of ["/cfp", "/cfp/", "/cfp/closed", "/cfp/my-submissions", "/cfp/01-intro", "/reviewer", "/reviewer/weights", "/reviewer/leaderboard", "/admin/weights", "/admin/weights/"]) {
      const response = await page.request.get(new URL(path, state.baseURL).href);
      expect(response.status(), path).toBe(404);
      expect(response.headers()["cache-control"]).toContain("no-store");
      const body = await response.text();
      expect(body).not.toContain("<!DOCTYPE html");
      expect(body).not.toMatch(/log in/i);
    }

    await page.locator('a[href="/reviewer/weights"]').click();
    await expect(page).toHaveURL(new URL("/reviewer/weights", state.baseURL).href);
    await expect(page.getByRole("heading", { name: "404", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Criteria weights", exact: true })).toHaveCount(0);

    const anonymous = await browser.newContext({ baseURL: state.baseURL });
    try {
      const allowed = new Set([state.baseURL, state.pbUrl]);
      await anonymous.route("**/*", route => {
        const url = new URL(route.request().url());
        return allowed.has(url.origin) || url.protocol === "data:" ? route.continue() : route.abort();
      });
      for (const path of ["/cfp/01-intro", "/reviewer/weights"]) {
        const response = await anonymous.request.get(path);
        expect(response.status(), `anonymous ${path}`).toBe(404);
      }
      const anonymousPage = await anonymous.newPage();
      await anonymousPage.goto("/");
      await navigateClientSide(anonymousPage, "/reviewer/weights");
      await navigateClientSide(anonymousPage, "/admin/weights/");
    } finally {
      await anonymous.close();
    }

    for (const role of ["user", "reviewer"]) {
      const staff = await login(browser, role);
      try {
        for (const path of ["/cfp/01-intro", "/reviewer/weights"]) {
          const response = await staff.page.request.get(new URL(path, state.baseURL).href);
          expect(response.status(), `${role} ${path}`).toBe(404);
        }
        await staff.page.goto("/");
        await navigateClientSide(staff.page, role === "user" ? "/cfp/01-intro" : "/reviewer/weights");
        await navigateClientSide(staff.page, role === "user" ? "/admin/weights/" : "/cfp/closed");
        if (role === "user") {
          await staff.page.goto("/admin");
          await expect(staff.page).not.toHaveURL(/\/admin(?:\/|$)/);
          await expect(staff.page.locator("#cfp-deadline")).toHaveCount(0);
        }
      } finally {
        await staff.context.close();
      }
    }

    const historicalAdmin = await pb.collection("users").create({
      email: "historical-admin@example.test",
      password: state.password,
      passwordConfirm: state.password,
      name: "Historical Staff",
      role: "admin",
      verified: true,
    });
    const staleStaff = await loginWithCredentials(browser, historicalAdmin.email, state.password);
    try {
      await staleStaff.page.goto("/admin");
      for (const path of ["/cfp/01-intro", "/reviewer/weights"]) {
        const response = await staleStaff.page.request.get(new URL(path, state.baseURL).href);
        expect(response.status(), `historical admin ${path}`).toBe(404);
      }
      await staleStaff.page.locator("#cfp-deadline").fill("2030-06-30");
      await staleStaff.page.getByRole("button", { name: "Save closed configuration" }).click();
      await expect(staleStaff.page.getByRole("alert")).toContainText("Unauthorized");
      await expect.poll(async () => {
        const updated = await pb.collection("conference_config").getOne(configuration.id);
        return { cfp_open: updated.cfp_open, availability: updated.availability };
      }).toEqual({ cfp_open: false, availability: { cfp: false, review: false } });
    } finally {
      await staleStaff.context.close();
    }

    await page.goto("/admin");
    await deadline.fill("");
    await page.getByRole("button", { name: "Save closed configuration" }).click();
    await expect.poll(async () =>
      (await pb.collection("conference_config").getOne(configuration.id)).cfp_deadline,
    ).toBeFalsy();
    await page.reload();
    await expect(deadline).toHaveValue("");
    await pb.collection("conference_config").update(configuration.id, {
      cfp_open: true,
      availability: { cfp: true, review: true },
    });
    await expect.poll(async () => {
      const updated = await pb.collection("conference_config").getOne(configuration.id);
      return { cfp_open: updated.cfp_open, availability: updated.availability };
    }).toEqual({ cfp_open: true, availability: { cfp: true, review: true } });
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
      await reviewer.page.goto(path);
      await expect(reviewer.page.getByRole("heading", { level: 1 }), `Expected ${path} to render its main heading`).toBeVisible();
      await expect(reviewer.page).toHaveURL(new URL(path, state.baseURL).href);
      await responsive(reviewer.page, info, path.replaceAll("/", "-"));
    }
    expect(reviewer.errors).toEqual([]);
  } finally { await reviewer.context.close(); }
});
