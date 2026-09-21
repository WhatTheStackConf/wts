import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { test, expect, type Page } from "@playwright/test";
import PocketBase from "pocketbase";

const state = JSON.parse(readFileSync(process.env.WTS_LIVE_QA_BROWSER_STATE!, "utf8")) as {
  disposable: boolean; baseURL: string; pbUrl: string; superuserEmail: string; password: string;
  users: Record<string, { id: string; email: string; password: string }>;
};
if (!state.disposable || new URL(state.pbUrl).hostname !== "127.0.0.1") throw new Error("Disposable auth fixture required");

async function rootClient() {
  const pb = new PocketBase(state.pbUrl);
  await pb.collection("_superusers").authWithPassword(state.superuserEmail, state.password);
  return pb;
}
async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log In", exact: true }).click();
}

test.beforeEach(async ({ context }) => {
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" || url.protocol === "data:" ? route.continue() : route.abort();
  });
});

test("invalid email login shows recovery guidance, then valid login works", async ({ page, context }) => {
  await login(page, state.users.user.email, "wrong-disposable-password");
  await expect(page.getByRole("alert")).toContainText("Forgot Password");
  await expect(page.getByRole("alert")).not.toContainText("Internal Server Error");
  expect((await context.cookies()).some(cookie => cookie.name === "pb_auth")).toBe(false);
  await page.screenshot({ path: "test-results/auth-registration/login-recovery.png", fullPage: true });
  await page.getByLabel("Password", { exact: true }).fill(state.password);
  await page.getByRole("button", { name: "Log In", exact: true }).click();
  await expect(page).toHaveURL(`${state.baseURL}/`);
  expect((await context.cookies()).find(cookie => cookie.name === "pb_auth")?.httpOnly).toBe(true);
});

test("unverified email offers resend and does not claim success when sending fails", async ({ page }) => {
  const pb = await rootClient();
  const email = "auth-unverified@example.test";
  await pb.collection("users").create({ email, password: state.password, passwordConfirm: state.password, verified: false, role: "user" });
  await login(page, email, state.password);
  await expect(page.getByRole("alert")).toContainText("verify your email");
  await page.route("**/request-verification", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ status: 503, message: "Synthetic mail failure" }) }));
  await page.getByRole("button", { name: "Resend Verification Email" }).click();
  await expect(page.getByRole("alert")).toContainText("could not send");
  await expect(page.getByRole("button", { name: "Email Sent!" })).toHaveCount(0);
});

test("registration is closed in the page and direct API while login stays available", async ({ page, request }) => {
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Registration closed", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Account", exact: true })).toHaveCount(0);
  const response = await request.post(`${state.pbUrl}/api/collections/users/records`, { data: {
    email: "auth-new-email@example.test", password: state.password, passwordConfirm: state.password,
  } });
  expect(response.status()).toBe(403);
  const pb = await rootClient();
  expect((await pb.collection("users").getList(1, 1, { filter: 'email = "auth-new-email@example.test"' })).totalItems).toBe(0);
  await page.getByRole("main").getByRole("link", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(`${state.baseURL}/login`);
});

test("new Google signup is denied but an existing account completes OAuth and HttpOnly session", async ({ page, context }) => {
  const pb = await rootClient();
  const provider = createServer((request, response) => {
    const url = new URL(request.url!, "http://127.0.0.1");
    if (url.pathname === "/authorize") {
      const callback = new URL(url.searchParams.get("redirect_uri")!);
      callback.searchParams.set("state", url.searchParams.get("state")!);
      callback.searchParams.set("code", "synthetic-code");
      response.writeHead(302, { Location: callback.href });
      response.end();
      return;
    }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(url.pathname === "/token"
      ? { access_token: "synthetic-provider-token", token_type: "Bearer", expires_in: 3600 }
      : { sub: "new-browser-google-user", name: "Browser Google User", email: "auth-google@example.test", email_verified: true }));
  });
  try {
    await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
    const address = provider.address();
    if (!address || typeof address === "string") throw new Error("Missing provider address");
    const url = `http://127.0.0.1:${address.port}`;
    await pb.collections.update("users", { oauth2: { enabled: true, providers: [{
      name: "google", clientId: "synthetic", clientSecret: "synthetic",
      authURL: `${url}/authorize`, tokenURL: `${url}/token`, userInfoURL: `${url}/userinfo`,
    }] } });
    await page.goto("/login");
    await page.getByRole("button", { name: "Log in with Google", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("registration is closed");
    expect((await pb.collection("users").getList(1, 1, { filter: 'email = "auth-google@example.test"' })).totalItems).toBe(0);
    expect((await context.cookies()).some(cookie => cookie.name === "pb_auth")).toBe(false);
    await pb.collection("users").create({ email: "auth-google@example.test", password: state.password, passwordConfirm: state.password, role: "user", verified: true });
    await page.getByRole("button", { name: "Log in with Google", exact: true }).click();
    await expect(page).toHaveURL(`${state.baseURL}/`);
    const user = await pb.collection("users").getFirstListItem('email = "auth-google@example.test"');
    expect(user.role).toBe("user");
    expect(user.verified).toBe(true);
    expect((await context.cookies()).find(cookie => cookie.name === "pb_auth")?.httpOnly).toBe(true);
  } finally {
    await new Promise<void>(resolve => provider.close(() => resolve()));
  }
});
