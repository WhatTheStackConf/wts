import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { tmpdir } from "node:os";
import { test as base, expect, type Page } from "@playwright/test";
import PocketBase from "pocketbase";

type Account = { id: string; email: string; password: string };
export interface CheckinFixtureState {
  disposable: true;
  root: string;
  baseURL: string;
  pbUrl: string;
  superuserEmail: string;
  password: string;
  users: Record<"admin" | "operator" | "ordinary" | "handoff", Account>;
}
export function fixtureState(): CheckinFixtureState {
  const path = process.env.WTS_CHECKIN_BROWSER_STATE;
  if (!path) throw new Error("Use pnpm test:checkin-browser; external app/database URLs are deliberately unsupported");
  const state = JSON.parse(readFileSync(path, "utf8")) as CheckinFixtureState;
  if (state.disposable !== true || dirname(state.root) !== tmpdir() || !basename(state.root).startsWith("wts-checkin-browser-") || dirname(path) !== state.root) throw new Error("Missing disposable fixture ownership marker");
  for (const url of [state.baseURL, state.pbUrl]) {
    if (new URL(url).hostname !== "127.0.0.1" || new URL(url).protocol !== "http:") throw new Error("Refusing non-loopback fixture");
  }
  return state;
}

export const test = base.extend<{ state: CheckinFixtureState; db: PocketBase; networkGuard: void; actorPage: (account: Account) => Promise<Page> }>({
  actorPage: async ({ browser, state }, use) => {
    const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
    const unexpected: string[] = [];
    await use(async (account) => {
      const context = await browser.newContext({ baseURL: state.baseURL, serviceWorkers: "block" });
      contexts.push(context);
      await context.route("**/*", async (route) => {
        const request = route.request();
        if ([state.baseURL, state.pbUrl].includes(new URL(request.url()).origin)) return route.continue();
        if (["fetch", "xhr"].includes(request.resourceType())) unexpected.push(new URL(request.url()).origin);
        await route.abort("blockedbyclient");
      });
      const page = await context.newPage();
      await login(page, account);
      return page;
    });
    for (const context of contexts) await context.close();
    expect(unexpected, "No unexpected external API from secondary actors").toEqual([]);
  },
  state: async ({ browserName: _browserName }, use) => { await use(fixtureState()); },
  db: async ({ state }, use) => {
    const pb = new PocketBase(state.pbUrl);
    pb.autoCancellation(false);
    await pb.collection("_superusers").authWithPassword(state.superuserEmail, state.password);
    await use(pb);
    pb.authStore.clear();
  },
  networkGuard: [async ({ context, state }, use) => {
    const unexpected: string[] = [];
    const allowed = new Set([state.baseURL, state.pbUrl]);
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (allowed.has(new URL(request.url()).origin)) return route.continue();
      // Fonts/avatars/analytics never leave this test browser. API dependencies
      // are not mocked: any unexpected fetch/XHR is a test failure.
      if (["fetch", "xhr"].includes(request.resourceType())) unexpected.push(new URL(request.url()).origin);
      await route.abort("blockedbyclient");
    });
    await use();
    expect(unexpected, "No unexpected external browser API calls").toEqual([]);
  }, { auto: true }],
});
export { expect };

export async function login(page: Page, account: Account) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Log In", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/);
  const authCookie = (await page.context().cookies()).find((cookie) => cookie.name === "pb_auth");
  expect(authCookie?.httpOnly, "Login must establish the real server session").toBe(true);
}

export async function status(page: Page) {
  const response = await page.evaluate(async () => {
    const result = await fetch("/api/checkin", {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "same-origin", body: JSON.stringify({ operation: "status" }),
    });
    return { ok: result.ok, body: await result.json() };
  });
  expect(response.ok, JSON.stringify(response.body)).toBe(true);
  return response.body;
}

/** APIRequestContext does not send Secure cookies on HTTP loopback like Chromium
 * does. Explicit synthetic cookies keep negative wire tests authenticated. */
export async function sessionCookieHeader(page: Page) {
  return (await page.context().cookies()).map(({ name, value }) => `${name}=${value}`).join("; ");
}
