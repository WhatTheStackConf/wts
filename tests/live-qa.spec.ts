import { readFileSync } from "node:fs";
import { test, expect, type Browser, type Locator, type Page } from "@playwright/test";
import PocketBase from "pocketbase";

const state = JSON.parse(readFileSync(process.env.WTS_LIVE_QA_BROWSER_STATE!, "utf8")) as {
  disposable: boolean; baseURL: string; pbUrl: string; superuserEmail: string; password: string;
  slug: string; slotId: string; sessionId: string; weekdaySlug: string;
  users: Record<string, { id: string; email: string; password: string }>;
};
if (!state.disposable || new URL(state.pbUrl).hostname !== "127.0.0.1") throw new Error("Synthetic Q&A fixture required");
const talkPath = `/sessions/${state.slug}#live-qa`;
async function actorPage(browser: Browser, actor: string, mobile = false) {
  const context = await browser.newContext({ baseURL: state.baseURL, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
  const allowed = new Set([state.baseURL, state.pbUrl]);
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return allowed.has(url.origin) || url.protocol === "data:" ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  await page.goto(talkPath);
  await page.getByRole("link", { name: "Log in to ask", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(state.users[actor].email);
  await page.getByLabel("Password", { exact: true }).fill(state.users[actor].password);
  await page.getByRole("button", { name: "Log In", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/sessions/${state.slug}#live-qa$`));
  await expect(page.getByRole("button", { name: "Refresh questions", exact: true })).toBeEnabled();
  return { context, page };
}
async function rootClient() {
  const pb = new PocketBase(state.pbUrl);
  await pb.collection("_superusers").authWithPassword(state.superuserEmail, state.password);
  return pb;
}
async function api(page: Page, body: unknown, actor = "mc") {
  return page.evaluate(async ({ body, actorId }) => {
    const response = await fetch("/api/live-qa", { method: "POST", headers: { "Content-Type": "application/json", "X-WTS-QA-User": actorId }, body: JSON.stringify(body) });
    return { status: response.status, cache: response.headers.get("cache-control"), data: await response.json() };
  }, { body, actorId: state.users[actor].id });
}

test("Live Q&A navigation is absent when logged out", async ({ page }) => {
  await page.route("https://**/*", route => route.abort());
  await page.goto("/qa");
  await expect(page.locator(".navbar-end").getByRole("link", { name: "Log in", exact: true })).toBeVisible();
  await expect(page.locator('.drawer a[href="/qa"]')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "open sidebar", exact: true }).click();
  await expect(page.locator('#mobile-navigation a[href="/qa"]')).toHaveCount(0);
});

for (const role of ["user", "reviewer", "checkin_operator", "mc", "admin"]) {
  test(`Live Q&A is a top-level authenticated link for ${role}`, async ({ browser }) => {
    const actor = await actorPage(browser, role);
    try {
      const desktopLink = actor.page.locator('.navbar-center > ul > li > a[href="/qa"]');
      await expect(desktopLink).toBeVisible();
      await expect(desktopLink).toHaveText("Live Q&A");
      await expect(desktopLink).toHaveClass(/text-secondary-500/);
      await expect(actor.page.locator('#nav-conference a[href="/qa"]')).toHaveCount(0);
      await desktopLink.click();
      await expect(actor.page).toHaveURL(`${state.baseURL}/qa`);
      await expect(actor.page.getByRole("heading", { name: "Choose your stage", exact: true })).toBeVisible();
      if (role === "user") {
        let release = () => {};
        let observed = () => {};
        const pending = new Promise<void>(resolve => { release = resolve; });
        const requested = new Promise<void>(resolve => { observed = resolve; });
        await actor.page.route("**/_server", async route => { observed(); await pending; await route.continue(); });
        try {
          await actor.page.reload({ waitUntil: "domcontentloaded" });
          await requested;
          await expect(desktopLink).toHaveCount(0);
        } finally { release(); }
        await expect(desktopLink).toBeVisible();
        await actor.page.unroute("**/_server");
      }
      if (role === "user") await actor.page.screenshot({ path: "test-results/live-qa/authenticated-nav-desktop.png", fullPage: true });
      await actor.page.setViewportSize({ width: 390, height: 844 });
      await actor.page.getByRole("button", { name: "open sidebar", exact: true }).click();
      const drawer = actor.page.locator("#mobile-navigation");
      const mobileLink = drawer.locator(':scope > ul > li > a[href="/qa"]');
      await expect(mobileLink).toBeVisible();
      await expect(mobileLink).toHaveText("Live Q&A");
      await expect(mobileLink).toHaveClass(/text-secondary-500/);
      await expect(drawer.locator('details a[href="/qa"]')).toHaveCount(0);
      if (role === "user") await actor.page.screenshot({ path: "test-results/live-qa/authenticated-nav-mobile.png" });
      await mobileLink.click();
      await expect(drawer).toHaveCount(0);
      await actor.page.getByRole("button", { name: "open sidebar", exact: true }).click();
      await drawer.getByRole("button", { name: "Logout", exact: true }).click();
      await expect(actor.page).toHaveURL(`${state.baseURL}/`);
      await expect(actor.page.locator('.drawer a[href="/qa"]')).toHaveCount(0);
    } finally { await actor.context.close(); }
  });
}

test("public Q&A is stage-first, keeps stage links on reload, and excludes weekday talks", async ({ page }) => {
  await page.route("https://**/*", route => route.abort());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/qa");
  await expect(page.getByRole("button", { name: "Stage 1", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Session main-stage-one", { exact: true })).toBeVisible();
  await expect(page.getByText(`Session ${state.slug}`, { exact: true })).toHaveCount(0);
  await expect(page.getByText(`Session ${state.weekdaySlug}`, { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Stage 2", exact: true }).click();
  await expect(page).toHaveURL(/\/qa\?stage=stage-3$/);
  await expect(page.getByText(`Session ${state.slug}`, { exact: true })).toBeVisible();
  await expect(page.getByText("Engineering Hall", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Stage 2", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(`Session ${state.slug}`, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/live-qa/stage-picker-mobile.png", fullPage: true });
  await page.route("**/api/live-qa", route => route.request().method() === "GET"
    ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic programme outage" }) }) : route.continue());
  await page.getByRole("button", { name: "Refresh sessions", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Question availability is unverified");
  await expect(page.getByText("Question availability unverified", { exact: true })).toBeVisible();
  await page.unroute("**/api/live-qa");
  let release = () => {};
  let observed = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  const requestObserved = new Promise<void>(resolve => { observed = resolve; });
  await page.route("**/api/live-qa", async route => {
    if (route.request().method() === "GET") { observed(); await pending; }
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "Refresh sessions", exact: true }).click();
    await requestObserved;
    await expect(page.getByRole("alert")).toContainText("Question availability is unverified");
    await expect(page.getByText("Question availability unverified", { exact: true })).toBeVisible();
  } finally { release(); }
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Scheduled now · Questions open", { exact: true })).toBeVisible();
  await page.unroute("**/api/live-qa");
  await page.getByRole("button", { name: "Stage 5", exact: true }).click();
  await expect(page.getByText(`Session ${state.slug}`, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stage 5", exact: true })).toHaveAttribute("aria-pressed", "true");
  const programme = page.waitForResponse(response => response.url().endsWith("/api/live-qa") && response.request().method() === "GET");
  await page.goto(`/sessions/${state.weekdaySlug}`);
  await programme;
  await expect(page.getByRole("heading", { name: `Session ${state.weekdaySlug}`, exact: true })).toBeVisible();
  await expect(page.locator("#live-qa")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Log in to ask", exact: true })).toHaveCount(0);
});

async function expectResponsive(page: Page, scope: Locator, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await expect(scope).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Check actual layout, not just CSS classes or a root overflow clip.
  await expect.poll(() => scope.evaluate(root => {
    const failures: string[] = [];
    for (const element of [root, ...root.querySelectorAll("button, input, textarea, summary, li, a")]) {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const label = element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 80) || element.tagName;
      // Text fields may scroll their value internally without overflowing layout.
      if (rect.left < -1 || rect.right > window.innerWidth + 1 || (!element.matches("input, textarea") && element.scrollWidth > element.clientWidth + 1)) failures.push(`Overflow: ${label}`);
      if (element.matches("button, summary")) {
        if (rect.height < 44) failures.push(`Small target: ${label}`);
        const range = document.createRange();
        range.selectNodeContents(element);
        const lines = new Set(Array.from(range.getClientRects()).filter(line => line.width && line.height).map(line => Math.round(line.top)));
        if (lines.size > 1) failures.push(`Wrapped control: ${label}`);
      }
    }
    return failures;
  })).toEqual([]);
}

test("attendee asks privately; MC reads and marks answered after the session ends", async ({ browser }) => {
  const attendee = await actorPage(browser, "user", true);
  const mc = await actorPage(browser, "mc");
  const other = await actorPage(browser, "other");
  try {
    const errors: string[] = [];
    attendee.page.on("pageerror", error => errors.push(error.message));
    mc.page.on("pageerror", error => errors.push(error.message));
    await expect(attendee.page.getByText("Questions are open", { exact: true })).toBeVisible();
    await attendee.page.getByLabel("Your question", { exact: true }).fill("How do you keep concurrent updates consistent?");
    await attendee.page.getByRole("button", { name: "Send question", exact: true }).click();
    await expect(attendee.page.getByText("Question sent", { exact: true })).toBeVisible();
    await expect(mc.page.getByText("How do you keep concurrent updates consistent?", { exact: true })).toBeVisible();
    await other.page.getByRole("button", { name: "Refresh questions", exact: true }).click();
    await expect(other.page.getByText("How do you keep concurrent updates consistent?", { exact: true })).toHaveCount(0);
    const forbidden = await api(other.page, { operation: "catalogue", page: 1, search: "" }, "other");
    expect(forbidden.status).toBe(403);
    expect(forbidden.cache).toBe("private, no-store");
    const pb = await rootClient();
    // Change real canonical timing instead of mocking browser time or acceptance.
    // Keep the fixture's valid start/day binding, including just after midnight.
    await pb.collection("agenda_slots").update(state.slotId, { end_at: new Date(Date.now() - 1000).toISOString() });
    await expect(attendee.page.getByText("Questions are closed", { exact: true })).toBeVisible();
    await attendee.page.getByLabel("Your question", { exact: true }).fill("A late draft");
    await expect(attendee.page.getByRole("button", { name: "Send question", exact: true })).toBeDisabled();
    await mc.page.getByRole("button", { name: "Mark answered", exact: true }).click();
    await expect(mc.page.getByRole("button", { name: "Reopen question", exact: true })).toBeVisible();
    await expect(attendee.page.getByText("Answered", { exact: true })).toBeVisible();
    await mc.page.getByRole("button", { name: "Open questions", exact: true }).click();
    await expect(attendee.page.getByText("Questions are open", { exact: true })).toBeVisible();
    await mc.page.getByRole("button", { name: "Close questions", exact: true }).click();
    await expect(mc.page.getByText("MC override: closed", { exact: true })).toBeVisible();
    await mc.page.getByRole("button", { name: "Use agenda timing", exact: true }).click();
    await expect(mc.page.getByText("Using agenda timing", { exact: true })).toBeVisible();
    await mc.page.goto("/mc");
    await mc.page.getByRole("button", { name: "Stage 2", exact: true }).click();
    await expect(mc.page.getByRole("link", { name: new RegExp(`Session ${state.slug}`) })).toBeVisible();
    await mc.page.getByLabel("Search sessions in this stage").fill(state.slug);
    await expect(mc.page.getByRole("link", { name: new RegExp(`Session ${state.slug}`) })).toBeVisible();
    expect(await attendee.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    await attendee.page.screenshot({ path: "test-results/live-qa/attendee-mobile.png", fullPage: true });
    await mc.page.screenshot({ path: "test-results/live-qa/mc-dashboard.png", fullPage: true });
  } finally { await attendee.context.close(); await mc.context.close(); await other.context.close(); }
});

test("lost submission response retries the same question once even after closure", async ({ browser }) => {
  const attendee = await actorPage(browser, "other", true);
  const mc = await actorPage(browser, "mc");
  try {
    await mc.page.getByRole("button", { name: "Open questions", exact: true }).click();
    await expect(attendee.page.getByText("Questions are open", { exact: true })).toBeVisible();
    const attempts: unknown[] = [];
    let committed = false;
    await attendee.page.route("**/api/live-qa", async route => {
      const body = route.request().postDataJSON();
      if (body?.operation !== "ask") return route.continue();
      attempts.push(body);
      if (!committed) {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        committed = true;
        return route.abort("failed");
      }
      return route.continue();
    });
    const question = "Can the MC still find this after a lost response?";
    await attendee.page.getByLabel("Your question", { exact: true }).fill(question);
    await attendee.page.getByRole("button", { name: "Send question", exact: true }).click();
    await expect(attendee.page.getByRole("button", { name: "Retry exact question", exact: true })).toBeVisible();
    await expect(attendee.page.getByLabel("Your question", { exact: true })).toHaveAttribute("readonly", "");
    await expectResponsive(attendee.page, attendee.page.getByRole("region", { name: "Live Q&A", exact: true }), 320);
    await expect(attendee.page.getByRole("alert")).toContainText("Keep this page open");
    await mc.page.getByRole("button", { name: "Close questions", exact: true }).click();
    await expect(attendee.page.getByText("Questions are closed", { exact: true })).toBeVisible();
    await attendee.page.getByRole("button", { name: "Retry exact question", exact: true }).click();
    await expect(attendee.page.getByText("Question sent", { exact: true })).toBeVisible();
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    const result = await api(mc.page, { operation: "session", slug: state.slug, page: 1 });
    expect(result.status).toBe(200);
    expect(result.data.questions.filter((item: { body: string }) => item.body === question)).toHaveLength(1);
    await expect(mc.page.getByText(question, { exact: true })).toBeVisible();
    await mc.page.screenshot({ path: "test-results/live-qa/mc-queue.png", fullPage: true });
  } finally { await attendee.context.close(); await mc.context.close(); }
});

test("a stale tab cannot submit its private draft under a newly logged-in account", async ({ browser }) => {
  const attendee = await actorPage(browser, "user");
  const mc = await actorPage(browser, "mc");
  let releaseReads = () => {};
  const holdReads = new Promise<void>(resolve => { releaseReads = resolve; });
  try {
    await mc.page.getByRole("button", { name: "Open questions", exact: true }).click();
    await expect(attendee.page.getByText("Questions are open", { exact: true })).toBeVisible();
    const draft = "This private draft belongs to the original account only.";
    await attendee.page.getByLabel("Your question", { exact: true }).fill(draft);
    // Keep the old tab's last verified view mounted while another tab logs in.
    await attendee.page.route("**/api/live-qa", async route => {
      if (route.request().postDataJSON()?.operation === "session") await holdReads;
      await route.continue();
    });
    const switched = await attendee.context.newPage();
    await switched.goto("/login");
    await switched.getByLabel("Email", { exact: true }).fill(state.users.other.email);
    await switched.getByLabel("Password", { exact: true }).fill(state.users.other.password);
    await switched.getByRole("button", { name: "Log In", exact: true }).click();
    await expect(switched).toHaveURL(`${state.baseURL}/`);
    const rejected = attendee.page.waitForResponse(response => response.url().endsWith("/api/live-qa") && response.request().postDataJSON()?.operation === "ask");
    await attendee.page.getByRole("button", { name: "Send question", exact: true }).click();
    expect((await rejected).status()).toBe(403);
    await expect(attendee.page.getByLabel("Your question", { exact: true })).toHaveCount(0);
    await expect(attendee.page.getByText(draft, { exact: true })).toHaveCount(0);
    const result = await api(switched, { operation: "session", slug: state.slug, page: 1 }, "other");
    expect(result.status).toBe(200);
    expect(result.data.questions.some((question: { body: string }) => question.body === draft)).toBe(false);
  } finally { releaseReads(); await attendee.context.close(); await mc.context.close(); }
});

test("revoked MC loses private queue and failed reads preserve attendee draft", async ({ browser }) => {
  const mc = await actorPage(browser, "mc");
  const attendee = await actorPage(browser, "user", true);
  const pb = await rootClient();
  try {
    await expect(mc.page.getByRole("heading", { name: "Session questions", exact: true })).toBeVisible();
    await pb.collection("users").update(state.users.mc.id, { role: "user" });
    await expect(mc.page.getByRole("heading", { name: "Your questions", exact: true })).toBeVisible();
    await expect(mc.page.getByText("How do you keep concurrent updates consistent?", { exact: true })).toHaveCount(0);
    await expect(mc.page.getByRole("button", { name: "Open questions", exact: true })).toHaveCount(0);
    await attendee.page.getByLabel("Your question", { exact: true }).fill("Do not lose this draft during a failed refresh.");
    await attendee.page.route("**/api/live-qa", route => route.request().postDataJSON()?.operation === "session" ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic outage" }) }) : route.continue());
    await attendee.page.getByRole("button", { name: "Refresh questions", exact: true }).click();
    await expect(attendee.page.getByRole("alert")).toContainText("Couldn't refresh questions");
    await expect(attendee.page.getByLabel("Your question", { exact: true })).toHaveValue("Do not lose this draft during a failed refresh.");
    await expect(attendee.page.getByRole("button", { name: "Send question", exact: true })).toBeDisabled();
    await expectResponsive(attendee.page, attendee.page.getByRole("region", { name: "Live Q&A", exact: true }), 320);
    await attendee.page.unroute("**/api/live-qa");
    await attendee.page.getByRole("button", { name: "Refresh questions", exact: true }).click();
    await expect(attendee.page.getByRole("alert")).toHaveCount(0);
  } finally { await pb.collection("users").update(state.users.mc.id, { role: "mc" }); await mc.context.close(); await attendee.context.close(); }
});

test("attendee form, MC queue and catalogue fit narrow screens with timing help expanded or closed", async ({ browser }) => {
  const attendee = await actorPage(browser, "user");
  const mc = await actorPage(browser, "mc");
  try {
    for (const actor of [attendee, mc]) {
      const panel = actor.page.getByRole("region", { name: "Live Q&A", exact: true });
      await expect(panel.getByRole("heading", { name: actor === mc ? "Session questions" : "Your questions", exact: true })).toBeVisible();
      await actor.page.getByLabel("Your question", { exact: true }).fill("A-long-draft-without-spaces-".repeat(12));
      for (const width of [320, 375, 414, 768]) {
        await test.step(`${actor === mc ? "MC queue" : "Attendee"} at ${width}px`, async () => {
          await expectResponsive(actor.page, panel, width);
          await expect(panel.getByText("Private: only you, MCs and administrators can read your questions.", { exact: true })).toBeVisible();
          const help = panel.locator("summary", { hasText: "How timing works" });
          await help.focus();
          await help.press("Enter");
          await expect(panel.locator("details")).toHaveAttribute("open", "");
          await expectResponsive(actor.page, panel, width);
          await help.press("Enter");
          await expect(panel.locator("details")).not.toHaveAttribute("open", "");
          if (actor === mc) {
            await expect(panel.getByRole("button", { name: "Open questions", exact: true })).toBeVisible();
            await expect(panel.getByRole("button", { name: "Close questions", exact: true })).toBeVisible();
            await expect(panel.getByRole("button", { name: "Use agenda timing", exact: true })).toBeVisible();
          }
          await expect(actor.page.getByLabel("Your question", { exact: true })).toHaveValue("A-long-draft-without-spaces-".repeat(12));
        });
      }
    }
    await mc.page.goto("/mc");
    await expect(mc.page.getByRole("heading", { name: "MC Q&A", exact: true })).toBeVisible();
    await mc.page.getByRole("button", { name: "Stage 2", exact: true }).click();
    await expect(mc.page).toHaveURL(/\/mc\?stage=stage-3$/);
    const catalogue = mc.page.getByRole("region", { name: "Choose your stage", exact: true });
    for (const width of [320, 375, 414, 768]) {
      await test.step(`MC catalogue at ${width}px`, async () => {
        await mc.page.setViewportSize({ width, height: 900 });
        await mc.page.getByLabel("Search sessions in this stage").fill(state.slug);
        await expect(catalogue.getByRole("link", { name: `View question queue: Session ${state.slug}`, exact: true })).toBeVisible();
        await expect(catalogue.getByText(`Session ${state.weekdaySlug}`, { exact: true })).toHaveCount(0);
        await expect(catalogue.getByText("Session main-stage-one", { exact: true })).toHaveCount(0);
        await expectResponsive(mc.page, catalogue, width);
        const missing = "unmatched-session-".repeat(10);
        await mc.page.getByLabel("Search sessions in this stage").fill(missing);
        await expect(catalogue.getByText("No talks in this stage match your search.", { exact: true })).toBeVisible();
        await expectResponsive(mc.page, catalogue, width);
      });
    }
  } finally { await attendee.context.close(); await mc.context.close(); }
});
