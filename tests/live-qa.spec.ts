import { readFileSync } from "node:fs";
import { test, expect, type Browser, type Locator, type Page } from "@playwright/test";
import PocketBase from "pocketbase";

const state = JSON.parse(readFileSync(process.env.WTS_LIVE_QA_BROWSER_STATE!, "utf8")) as {
  disposable: boolean; baseURL: string; pbUrl: string; superuserEmail: string; password: string;
  slug: string; slotId: string; sessionId: string; weekdaySlug: string;
  users: Record<string, { id: string; email: string; password: string }>;
};
if (!state.disposable || new URL(state.pbUrl).hostname !== "127.0.0.1") throw new Error("Synthetic Q&A fixture required");
const talkPath = `/mc?session=${encodeURIComponent(state.slug)}#live-qa`;
async function actorPage(browser: Browser, actor: string, mobile = false) {
  const context = await browser.newContext({ baseURL: state.baseURL, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
  const allowed = new Set([state.baseURL, state.pbUrl]);
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return allowed.has(url.origin) || url.protocol === "data:" ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(state.users[actor].email);
  await page.getByLabel("Password", { exact: true }).fill(state.users[actor].password);
  await page.getByRole("button", { name: "Log In", exact: true }).click();
  await expect(page).toHaveURL(`${state.baseURL}/`);
  await page.goto(talkPath);
  await expect(page.getByRole("button", { name: "Refresh questions", exact: true })).toBeEnabled();
  return { context, page };
}
async function rootClient() {
  const pb = new PocketBase(state.pbUrl);
  await pb.collection("_superusers").authWithPassword(state.superuserEmail, state.password);
  return pb;
}

test("retired public pages return the current not-found page despite published data", async ({ page }) => {
  await page.route("https://**/*", route => route.abort());
  for (const path of ["/agenda", "/speakers", `/speakers/${state.slug}`, `/speakers/${state.slug}/promo`, "/sessions", `/sessions/${state.slug}`, "/sponsors", "/timeline", "/missions", "/qa"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page.locator(".support-not-found")).toBeVisible();
    await expect(page.getByRole("link", { name: "Past editions", exact: true }).last()).toHaveAttribute("href", "/#archive");
  }
});

test("the private MC queue remains unavailable to signed-out visitors", async ({ page }) => {
  await page.route("https://**/*", route => route.abort());
  await page.goto(talkPath);
  await expect(page.getByRole("alert")).toContainText("only available to MCs and administrators");
  await expect(page.getByRole("button", { name: "Refresh questions", exact: true })).toHaveCount(0);
});

// Sample each frame across a delayed real response: identical-looking replacement
// controls still lose keyboard focus, and a settled screenshot misses the jump.
async function watchPoll(page: Page, scope: Locator, focus: Locator) {
  await focus.focus();
  const root = await scope.elementHandle();
  if (!root) throw new Error("Polling scope missing");
  await page.evaluate(root => {
    const focused = document.activeElement;
    const controls = Array.from(root.querySelectorAll<HTMLElement>("button, input, textarea, a, summary"))
      .map(node => ({ node, top: node.getBoundingClientRect().top, disabled: node.matches(":disabled") }));
    const failures = new Set<string>();
    let frames = 0;
    let active = true;
    const sample = () => {
      frames++;
      for (const { node, top, disabled } of controls) {
        if (!node.isConnected) failures.add("control replaced");
        if (Math.abs(node.getBoundingClientRect().top - top) > 1) failures.add("control moved");
        if (node.matches(":disabled") !== disabled) failures.add("control availability changed");
      }
      if (document.activeElement !== focused) failures.add("focus lost");
      if (active) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    Object.assign(window, { qaPollProbe: { stop: () => { active = false; return { frames, failures: [...failures] }; } } });
  }, root);
  return async () => {
    const result = await page.evaluate(() => (window as unknown as { qaPollProbe: { stop: () => { frames: number; failures: string[] } } }).qaPollProbe.stop());
    expect(result.frames).toBeGreaterThan(1);
    expect(result.failures).toEqual([]);
  };
}

async function holdQaRead(page: Page, method: "GET" | "POST") {
  let release = () => {};
  let observed = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { observed = resolve; });
  await page.route("**/api/live-qa", async route => {
    if (route.request().method() === method && (method === "GET" || route.request().postDataJSON()?.operation === "session")) {
      observed();
      await gate;
    }
    await route.continue();
  });
  return { release, requested };
}

async function pollVisible(page: Page) {
  // The real visibility-triggered poll, without advancing auth/browser time.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
}
async function twoFrames(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function unchangedPoll(page: Page, scope: Locator, focus: Locator, method: "GET" | "POST") {
  const held = await holdQaRead(page, method);
  const stop = await watchPoll(page, scope, focus);
  const response = page.waitForResponse(response => response.url().endsWith("/api/live-qa") && response.request().method() === method);
  try { await pollVisible(page); await held.requested; await twoFrames(page); }
  finally { held.release(); }
  await response;
  await twoFrames(page);
  await stop();
  await page.unroute("**/api/live-qa");
}

test("polling keeps stage controls, links, search and geometry stable and publishes real updates", async ({ browser }) => {
  const mc = await actorPage(browser, "mc");
  const { page } = mc;
  try {
  const initial = await holdQaRead(page, "GET");
  try {
    await page.goto("/mc?stage=stage-3");
    await initial.requested;
    await expect(page.getByText("Refreshing main-day sessions…", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Stage 2", exact: true })).toHaveCount(0);
  } finally { initial.release(); }
  const stage = page.getByRole("button", { name: "Stage 2", exact: true });
  await expect(stage).toBeVisible();
  await page.unroute("**/api/live-qa");
  const scope = page.getByRole("region", { name: "Choose your stage", exact: true });
  const search = page.getByLabel("Search sessions in this stage");
  await search.fill(state.slug);
  const link = scope.getByRole("link", { name: new RegExp(`Session ${state.slug}`) });
  for (const focus of [stage, search, link]) {
    await unchangedPoll(page, scope, focus, "GET");
    await expect(search).toHaveValue(state.slug);
  }
  const pb = await rootClient();
  const session = await pb.collection("sessions").getOne(state.sessionId);
  const linkHandle = await link.elementHandle();
  try {
    await pb.collection("sessions").update(state.sessionId, { title: `Updated Session ${state.slug}` });
    await pollVisible(page);
    await expect(scope.getByRole("heading", { name: `Updated Session ${state.slug}`, exact: true })).toBeVisible();
    expect(await linkHandle!.evaluate(node => node.isConnected)).toBe(true);
  } finally { await pb.collection("sessions").update(state.sessionId, { title: session.title }); }
  } finally { await mc.context.close(); }
});

test("polling keeps private question controls and drafts stable, updates answers and redacts denial", async ({ browser }) => {
  const pb = await rootClient();
  const seeded = await pb.collection("live_qa_questions").create({ session: state.sessionId, author: state.users.user.id, body: "Polling identity fixture question", answered: false, request_id: crypto.randomUUID(), request_payload: { fixture: true }, request_reply: { fixture: true } });
  const mc = await actorPage(browser, "mc");
  const { page } = mc;
  try {
    const initial = await holdQaRead(page, "POST");
    try {
      await page.reload({ waitUntil: "domcontentloaded" });
      await initial.requested;
      await expect(page.getByText("Checking questions…", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Send question", exact: true })).toBeDisabled();
      await expect(page.getByRole("region", { name: "Submitted questions", exact: true })).toHaveCount(0);
    } finally { initial.release(); }
    await expect(page.getByRole("heading", { name: "Session questions", exact: true })).toBeVisible();
    await page.unroute("**/api/live-qa");
    const scope = page.getByRole("region", { name: "Live Q&A", exact: true });
    const draft = page.getByLabel("Your question", { exact: true });
    await draft.fill("Keep this private polling draft");
    const row = scope.getByRole("listitem").filter({ hasText: seeded.body });
    const answer = row.getByRole("button", { name: "Mark answered", exact: true });
    await expect(answer).toBeVisible();
    for (const focus of [draft, answer]) {
      await unchangedPoll(page, scope, focus, "POST");
      await expect(draft).toHaveValue("Keep this private polling draft");
    }
    const answerHandle = await answer.elementHandle();
    await pb.collection("live_qa_questions").update(seeded.id, { answered: true });
    await pollVisible(page);
    await expect(row.getByRole("button", { name: "Reopen question", exact: true })).toBeVisible();
    expect(await answerHandle!.evaluate(node => node.isConnected)).toBe(true);
    await page.route("**/api/live-qa", route => route.request().postDataJSON()?.operation === "session"
      ? route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Synthetic permission denial" }) }) : route.continue());
    await pollVisible(page);
    await expect(scope.getByRole("alert")).toContainText("Q&A access could not be verified");
    await expect(draft).toHaveCount(0);
    await expect(row).toHaveCount(0);
    await expect(scope.getByRole("button", { name: "Open questions", exact: true })).toHaveCount(0);
    await page.unroute("**/api/live-qa");
    await scope.getByRole("button", { name: "Refresh questions", exact: true }).click();
    await expect(draft).toHaveValue("");
  } finally { await mc.context.close(); await pb.collection("live_qa_questions").delete(seeded.id); }
});

test("polling does not drop a question-page click during an in-flight refresh", async ({ browser }) => {
  const pb = await rootClient();
  const seeded: string[] = [];
  let actor: Awaited<ReturnType<typeof actorPage>> | undefined;
  try {
    for (let index = 0; index < 51; index++) {
      const question = await pb.collection("live_qa_questions").create({ session: state.sessionId, author: state.users.user.id, body: `Paging fixture ${index}`, answered: false, request_id: crypto.randomUUID(), request_payload: { fixture: true }, request_reply: { fixture: true } });
      seeded.push(question.id);
    }
    actor = await actorPage(browser, "mc");
    const { page } = actor;
    const next = page.getByRole("button", { name: "Next questions", exact: true });
    await expect(next).toBeEnabled();
    const held = await holdQaRead(page, "POST");
    try {
      await pollVisible(page);
      await held.requested;
      await next.click();
      await expect(next).toBeDisabled();
    } finally { held.release(); }
    await expect(page.getByText("Page 2 of 2", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Submitted questions", exact: true }).getByRole("listitem")).toHaveCount(1);
    await page.unroute("**/api/live-qa");
    await page.getByRole("button", { name: "Previous questions", exact: true }).click();
    await expect(page.getByText("Page 1 of 2", { exact: true })).toBeVisible();
  } finally {
    await actor?.context.close();
    for (const id of seeded) await pb.collection("live_qa_questions").delete(id);
  }
});

async function expectResponsive(page: Page, scope: Locator, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await expect(scope).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Check actual layout, not just CSS classes or a root overflow clip.
  await expect.poll(() => scope.evaluate(root => {
    const failures: string[] = [];
    const labelOf = (element: Element) => element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 80) || element.tagName;
    // Text fields may scroll their value internally without overflowing layout.
    const overflows = (element: Element, rect: DOMRect) => rect.left < -1 || rect.right > window.innerWidth + 1 || (!element.matches("input, textarea") && element.scrollWidth > element.clientWidth + 1);
    const lineCount = (element: Element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return new Set(Array.from(range.getClientRects()).filter(line => line.width && line.height).map(line => Math.round(line.top))).size;
    };
    for (const element of [root, ...root.querySelectorAll("button, input, textarea, summary, li, a")]) {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const label = labelOf(element);
      if (overflows(element, rect)) failures.push(`Overflow: ${label}`);
      if (element.matches("button, summary")) {
        if (rect.height < 44) failures.push(`Small target: ${label}`);
        if (lineCount(element) > 1) failures.push(`Wrapped control: ${label}`);
      }
    }
    return failures;
  })).toEqual([]);
}


test("MC queue and catalogue fit narrow screens with timing help expanded or closed", async ({ browser }) => {
  const mc = await actorPage(browser, "mc");
  try {
      const panel = mc.page.getByRole("region", { name: "Live Q&A", exact: true });
      await expect(panel.getByRole("heading", { name: "Session questions", exact: true })).toBeVisible();
      await mc.page.getByLabel("Your question", { exact: true }).fill("A-long-draft-without-spaces-".repeat(12));
      for (const width of [320, 375, 414, 768]) {
        await test.step(`MC queue at ${width}px`, async () => {
          await expectResponsive(mc.page, panel, width);
          const help = panel.locator("summary", { hasText: "How timing works" });
          await help.focus();
          await help.press("Enter");
          await expect(panel.locator("details")).toHaveAttribute("open", "");
          await expectResponsive(mc.page, panel, width);
          await help.press("Enter");
          await expect(panel.locator("details")).not.toHaveAttribute("open", "");
            await expect(panel.getByRole("button", { name: "Open questions", exact: true })).toBeVisible();
            await expect(panel.getByRole("button", { name: "Close questions", exact: true })).toBeVisible();
            await expect(panel.getByRole("button", { name: "Use agenda timing", exact: true })).toBeVisible();
          await expect(mc.page.getByLabel("Your question", { exact: true })).toHaveValue("A-long-draft-without-spaces-".repeat(12));
        });
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
  } finally { await mc.context.close(); }
});
