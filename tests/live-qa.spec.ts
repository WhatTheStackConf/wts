import { readFileSync } from "node:fs";
import { test, expect, type Browser, type Page } from "@playwright/test";
import PocketBase from "pocketbase";

const state = JSON.parse(readFileSync(process.env.WTS_LIVE_QA_BROWSER_STATE!, "utf8")) as {
  disposable: boolean; baseURL: string; pbUrl: string; superuserEmail: string; password: string;
  slug: string; slotId: string; sessionId: string;
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
  await page.getByRole("link", { name: "Log in to ask a question" }).click();
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
    await pb.collection("agenda_slots").update(state.slotId, { start_at: new Date(Date.now() - 3_600_000).toISOString(), end_at: new Date(Date.now() - 1000).toISOString() });
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
    await expect(mc.page.getByRole("link", { name: new RegExp(`Session ${state.slug}`) })).toBeVisible();
    await mc.page.getByLabel("Search published sessions").fill(state.slug);
    await mc.page.getByRole("button", { name: "Search sessions", exact: true }).click();
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
      if (body.operation !== "ask") return route.continue();
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
      if (route.request().postDataJSON().operation === "session") await holdReads;
      await route.continue();
    });
    const switched = await attendee.context.newPage();
    await switched.goto("/login");
    await switched.getByLabel("Email", { exact: true }).fill(state.users.other.email);
    await switched.getByLabel("Password", { exact: true }).fill(state.users.other.password);
    await switched.getByRole("button", { name: "Log In", exact: true }).click();
    await expect(switched).toHaveURL(`${state.baseURL}/`);
    const rejected = attendee.page.waitForResponse(response => response.url().endsWith("/api/live-qa") && response.request().postDataJSON().operation === "ask");
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
    await attendee.page.route("**/api/live-qa", route => route.request().postDataJSON().operation === "session" ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic outage" }) }) : route.continue());
    await attendee.page.getByRole("button", { name: "Refresh questions", exact: true }).click();
    await expect(attendee.page.getByRole("alert")).toContainText("Couldn't refresh questions");
    await expect(attendee.page.getByLabel("Your question", { exact: true })).toHaveValue("Do not lose this draft during a failed refresh.");
    await expect(attendee.page.getByRole("button", { name: "Send question", exact: true })).toBeDisabled();
    await attendee.page.unroute("**/api/live-qa");
    await attendee.page.getByRole("button", { name: "Refresh questions", exact: true }).click();
    await expect(attendee.page.getByRole("alert")).toHaveCount(0);
  } finally { await pb.collection("users").update(state.users.mc.id, { role: "mc" }); await mc.context.close(); await attendee.context.close(); }
});
