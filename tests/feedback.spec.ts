import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import PocketBase from "pocketbase";

const state = JSON.parse(readFileSync(process.env.WTS_FEEDBACK_BROWSER_STATE!, "utf8")) as {
  disposable: boolean; baseURL: string; pbUrl: string; rootToken: string;
};
if (!state.disposable || new URL(state.pbUrl).hostname !== "127.0.0.1") throw new Error("Disposable feedback fixture required");
const pb = new PocketBase(state.pbUrl);
pb.authStore.save(state.rootToken);
pb.autoCancellation(false);
const screenshots = ".impeccable/review/feedback";
mkdirSync(screenshots, { recursive: true });
async function invitation(options: { used?: boolean; revoked?: boolean; expired?: boolean; closed?: boolean } = {}) {
  const token = randomBytes(32).toString("base64url");
  const survey = await pb.collection("feedback_surveys").create({
    key: `synthetic-${randomUUID()}`, title: "WhatTheStack 2026 feedback", version: "main-day-v1", open: !options.closed,
    opens_at: new Date(Date.now() - 60_000).toISOString(), closes_at: new Date(Date.now() + 864_000_000).toISOString(),
    sessions: [{ id: "synthetic-talk", title: "Synthetic test session" }],
  });
  const record = await pb.collection("feedback_invitations").create({
    survey: survey.id, source_key: `synthetic:${randomUUID()}`, email: "attendee@example.test",
    token_hash: createHash("sha256").update(token).digest("hex"), used: options.used ?? false, revoked: options.revoked ?? false,
    expires_at: new Date(Date.now() + (options.expired ? -60_000 : 864_000_000)).toISOString(),
  });
  return { token, survey, record, url: `/feedback#token=${token}` };
}
async function open(page: Page, url: string) {
  const response = await page.goto(url);
  if (response) {
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["x-robots-tag"]).toContain("noindex");
    expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  }
  return response;
}
async function overall(page: Page) {
  await page.getByRole("group", { name: /Overall, how was/ }).getByRole("radio", { name: /Excellent/ }).check();
}
async function responses(survey: string) {
  return pb.collection("feedback_responses").getFullList({ filter: pb.filter("survey = {:survey}", { survey }) });
}
test.beforeEach(async ({ context }) => {
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.origin === state.baseURL || url.origin === state.pbUrl || url.protocol === "data:" ? route.continue() : route.abort();
  });
});

test("unlisted shell does not expose a form or execute tracking/auth restoration", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", request => requests.push(request.url()));
  const response = await open(page, "/feedback");
  const html = await response!.text();
  expect(html).not.toContain("umami.foundry.mk");
  expect(html).not.toContain("connect.facebook.net");
  expect(html).not.toContain("facebook.com/tr");
  await expect(page.getByRole("button", { name: /Submit feedback/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Open your feedback invitation" })).toBeVisible();
  await page.keyboard.press("Tab");
  expect(requests.some(url => url.includes("/_server") || url.includes("umami") || url.includes("facebook"))).toBe(false);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});

test("invalid, expired, revoked, used and closed invitations cannot open the form", async ({ page }) => {
  await open(page, `/feedback#token=${randomBytes(32).toString("base64url")}`);
  await expect(page.getByRole("heading", { name: "Open your feedback invitation" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Submit feedback/ })).toHaveCount(0);
  for (const options of [{ expired: true }, { revoked: true }, { used: true }, { closed: true }]) {
    const invite = await invitation(options);
    await open(page, invite.url);
    await expect(page.getByRole("button", { name: /Submit feedback/ })).toHaveCount(0);
    const heading = "expired" in options ? "This invitation has expired" : "used" in options ? "This invitation has already been used" : "closed" in options ? "Feedback is now closed" : "Open your feedback invitation";
    await expect(page.getByRole("heading", { level: 2, name: heading, exact: true })).toBeVisible();
    expect(await responses(invite.survey.id)).toHaveLength(0);
  }
});

test("logged-out attendee submits once; tokens and identities stay out of answers", async ({ page }) => {
  const invite = await invitation();
  const calls: { url: string; cookie: string | undefined }[] = [];
  page.on("request", request => {
    if (request.url().includes("/api/feedback")) calls.push({ url: request.url(), cookie: request.headers()["cookie"] });
  });
  await open(page, invite.url);
  await expect(page.getByRole("button", { name: /Submit feedback/ })).toBeVisible();
  await expect(page).toHaveURL(`${state.baseURL}/feedback`);
  expect((await pb.collection("feedback_invitations").getOne(invite.record.id)).used).toBe(false);
  await overall(page);
  await page.getByRole("button", { name: /Submit feedback/ }).click();
  await expect(page.getByRole("heading", { name: /thank/i })).toBeVisible();
  const rows = await responses(invite.survey.id);
  expect(rows).toHaveLength(1);
  expect(rows[0].answers.overall).toBe(5);
  for (const key of ["created", "updated", "email", "token", "token_hash", "invitation", "user", "source_key"]) expect(rows[0]).not.toHaveProperty(key);
  expect(JSON.stringify(rows)).not.toContain(invite.token);
  expect(JSON.stringify(rows)).not.toContain("attendee@example.test");
  expect(calls.every(call => call.cookie === undefined && !call.url.includes(invite.token))).toBe(true);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  await open(page, invite.url);
  await expect(page.getByText(/already.*(used|submitted)|already have/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Submit feedback/ })).toHaveCount(0);
  expect(await responses(invite.survey.id)).toHaveLength(1);
});

test("existing auth cookie is not used or forwarded by feedback", async ({ page, context }) => {
  const invite = await invitation();
  await context.addCookies([{ name: "pb_auth", value: encodeURIComponent(JSON.stringify({ token: state.rootToken, record: null })), url: state.baseURL, httpOnly: true, sameSite: "Lax" }]);
  const requests: { path: string; cookie: string | undefined }[] = [];
  page.on("request", request => requests.push({ path: new URL(request.url()).pathname, cookie: request.headers()["cookie"] }));
  await open(page, invite.url);
  await overall(page);
  await page.getByRole("button", { name: /Submit feedback/ }).click();
  await expect(page.getByRole("heading", { name: /thank/i })).toBeVisible();
  expect(requests.some(request => request.path === "/_server")).toBe(false);
  expect(requests.filter(request => request.path === "/api/feedback").every(request => !request.cookie)).toBe(true);
  expect((await context.cookies()).some(cookie => cookie.name === "pb_auth")).toBe(true);
  expect(await responses(invite.survey.id)).toHaveLength(1);
});

test("mobile form keeps answers after a temporary failure and focuses confirmation", async ({ page }) => {
  const invite = await invitation();
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, invite.url);
  await overall(page);
  await page.getByLabel(/What should we.*keep/i).fill("Synthetic: keep the practical talks.");
  await page.getByLabel(/most important thing.*change/i).fill("Synthetic: more time between sessions.");
  await page.route("**/api/feedback", route => route.request().postDataJSON().action === "submit"
    ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ state: "unavailable" }) }) : route.continue());
  await page.getByRole("button", { name: /Submit feedback/ }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel(/What should we.*keep/i)).toHaveValue("Synthetic: keep the practical talks.");
  expect((await pb.collection("feedback_invitations").getOne(invite.record.id)).used).toBe(false);
  expect(await responses(invite.survey.id)).toHaveLength(0);
  await page.unroute("**/api/feedback");
  await page.getByRole("button", { name: /Submit feedback|Try again|Retry/i }).click();
  const thanks = page.getByRole("heading", { name: /thank/i });
  await expect(thanks).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${screenshots}/mobile-success.png`, fullPage: true });
  expect(await responses(invite.survey.id)).toHaveLength(1);
});

test("a proxy size rejection preserves editable answers and the invitation for retry", async ({ page }) => {
  const invite = await invitation();
  await open(page, invite.url);
  await overall(page);
  const keep = page.getByLabel(/What should we.*keep/i);
  await keep.fill("Synthetic draft survives a size rejection.");
  await page.route("**/api/feedback", route => route.request().postDataJSON().action === "submit"
    ? route.fulfill({ status: 413, contentType: "text/html", body: "Request too large" }) : route.continue());
  await page.getByRole("button", { name: /Submit feedback/ }).click();
  await expect(page.getByRole("alert")).toContainText("shorten your comments");
  await expect(keep).toHaveValue("Synthetic draft survives a size rejection.");
  await expect(keep).toBeEditable();
  expect((await pb.collection("feedback_invitations").getOne(invite.record.id)).used).toBe(false);
  expect(await responses(invite.survey.id)).toHaveLength(0);
  await keep.fill("Shorter synthetic draft.");
  await page.unroute("**/api/feedback");
  await page.getByRole("button", { name: /Submit feedback/ }).click();
  await expect(page.getByRole("heading", { name: /thank/i })).toBeVisible();
  const rows = await responses(invite.survey.id);
  expect(rows).toHaveLength(1);
  expect(rows[0].answers.keep).toBe("Shorter synthetic draft.");
});

test("optional session feedback and bounded more choices reach the real database", async ({ page }) => {
  const invite = await invitation();
  await open(page, invite.url);
  await overall(page);
  await page.getByRole("group", { name: "Talk selection and relevance (optional)" }).getByRole("radio", { name: /Good/ }).check();
  await page.getByRole("checkbox", { name: "Deep technical talks" }).check();
  await page.getByRole("checkbox", { name: "Live demos" }).check();
  await page.getByRole("checkbox", { name: "Other", exact: true }).check();
  await expect(page.getByRole("checkbox", { name: "Workshops", exact: true })).toBeDisabled();
  await page.getByLabel("What else would you like more of? (optional)").fill("Synthetic: open-source clinics.");
  await page.locator("summary").filter({ hasText: "Feedback on a particular session" }).click();
  await page.getByRole("combobox", { name: "Choose a session to review" }).selectOption("synthetic-talk");
  await page.getByRole("group", { name: "How useful was this session to you? (optional)" }).getByRole("radio", { name: /Extremely useful/ }).check();
  await page.getByLabel("Anything you'd like to share about this session? (optional)").fill("Synthetic: useful examples.");
  await page.getByRole("button", { name: "Submit feedback", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Thank you/ })).toBeVisible();
  const rows = await responses(invite.survey.id);
  expect(rows).toHaveLength(1);
  expect(rows[0].answers).toMatchObject({ overall: 5, parts: { content: 4 }, more: ["technical", "demos", "other"], moreOther: "Synthetic: open-source clinics.", sessions: [{ sessionId: "synthetic-talk", usefulness: 5, comment: "Synthetic: useful examples." }] });
});

test("lost submission acknowledgement retries without duplicating an accepted response", async ({ page }) => {
  const invite = await invitation();
  await open(page, invite.url);
  await overall(page);
  let lost = false;
  await page.route("**/api/feedback", async route => {
    if (route.request().postDataJSON().action !== "submit" || lost) return route.continue();
    lost = true;
    const accepted = await route.fetch();
    expect(await accepted.json()).toEqual({ state: "submitted" });
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Submit feedback", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("couldn't confirm");
  expect(await responses(invite.survey.id)).toHaveLength(1);
  await page.getByRole("button", { name: "Retry submission", exact: true }).click();
  await expect(page.getByRole("heading", { name: "This invitation has already been used" })).toBeVisible();
  expect(await responses(invite.survey.id)).toHaveLength(1);
  await page.unrouteAll({ behavior: "wait" });
});

test("desktop and mobile survey render with readable labels and no overflow", async ({ page }) => {
  const invite = await invitation();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, invite.url);
  await expect(page.getByRole("button", { name: /Submit feedback/ })).toBeVisible();
  await expect(page.getByText("Thanks for joining us! Tell us what worked and what you'd change for next year.", { exact: true })).toBeVisible();
  await expect(page.locator(".feedback-privacy, .feedback-deadline, time")).toHaveCount(0);
  await expect(page.getByText(/practical privacy|system operators|stored separately|identifying details/i)).toHaveCount(0);
  const submit = page.getByRole("button", { name: /Submit feedback/ });
  async function contrast() {
    return submit.evaluate(element => {
      const style = getComputedStyle(element);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d")!;
      const luminance = (color: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => {
          const channel = value / 255;
          return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
        });
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      };
      const a = luminance(style.color), b = luminance(style.backgroundColor);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    });
  }
  const resting = await contrast();
  expect(resting).toBeGreaterThanOrEqual(4.5);
  await submit.hover();
  const hovering = await contrast();
  expect(hovering).toBeGreaterThanOrEqual(4.5);
  expect(hovering).not.toBe(resting);
  await page.mouse.move(0, 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  console.log(`Feedback button contrast: resting=${resting.toFixed(2)}:1 hover=${hovering.toFixed(2)}:1`);
  await page.screenshot({ path: `${screenshots}/desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${screenshots}/mobile.png`, fullPage: true });
  await page.getByRole("button", { name: /Submit feedback/ }).click();
  expect(await responses(invite.survey.id)).toHaveLength(0);
  await expect(page.getByRole("radio").first()).toBeFocused();
});
