#!/usr/bin/env node
/**
 * Browser route-guard matrix for PRD #1 security testing.
 * Requires: dev server on 5173, QA test users created.
 */
import { chromium } from "playwright";

const BASE = process.env.APP_URL || "http://localhost:5173";
const PASS = process.env.QA_TEST_PASSWORD || "QaTest!Sec2026";

const ROLES = {
  guest: null,
  user: { email: "qa-regular@wts-test.local" },
  reviewer: { email: "qa-reviewer@wts-test.local" },
  admin: { email: "qa-admin@wts-test.local" },
};

const ROUTES = [
  { path: "/admin", expect: { guest: /login/, user: /^\/$/, reviewer: /^\/$/, admin: /admin/ } },
  { path: "/admin/users", expect: { guest: /login/, user: /^\/$/, reviewer: /^\/$/, admin: /admin\/users/ } },
  { path: "/reviewer", expect: { guest: /login/, user: /^\/$/, reviewer: /reviewer/, admin: /reviewer/ } },
  { path: "/reviewer/weights", expect: { guest: /login/, user: /^\/$/, reviewer: /reviewer\/weights/, admin: /reviewer\/weights/ } },
  { path: "/admin/weights", expect: { guest: /login/, user: /^\/$/, reviewer: /reviewer\/weights/, admin: /reviewer\/weights/ } },
  { path: "/user/profile", expect: { guest: /login/, user: /profile/, reviewer: /profile/, admin: /profile/ } },
];

async function login(page, creds) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').first().fill(creds.email);
  await page.locator('input[type="password"]').first().fill(PASS);
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => !location.pathname.includes("/login"), null, {
    timeout: 15000,
  });
  await page.waitForTimeout(800);
}

async function logout(page) {
  await page.context().clearCookies();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
}

function checkContent(path, pathname, text) {
  if (pathname.includes("/login")) return { ok: true, note: "login" };
  if (path === "/admin/users" && pathname.includes("/admin/users")) {
    return { ok: /Users|Role|email/i.test(text), note: "users table" };
  }
  if (path === "/admin" && pathname.includes("/admin") && !pathname.includes("/users")) {
    return { ok: /Admin|Dashboard|Proposals/i.test(text), note: "admin dash" };
  }
  if (path.startsWith("/reviewer") && pathname.includes("/reviewer")) {
    if (path.includes("weights")) {
      return { ok: /Relevance|Weight|Originality|criteria/i.test(text), note: "weights ui" };
    }
    return { ok: /Review|Submission|Portal/i.test(text), note: "reviewer portal" };
  }
  if (path === "/user/profile" && pathname.includes("/profile")) {
    return { ok: /Profile|Proposals|Account/i.test(text), note: "profile" };
  }
  if (pathname === "/" || pathname === "") {
    return { ok: true, note: "home redirect" };
  }
  return { ok: true, note: "other" };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const matrix = [];

  for (const [roleName, creds] of Object.entries(ROLES)) {
    const context = await browser.newContext();
    const page = await context.newPage();

    if (creds) {
      try {
        await login(page, creds);
      } catch (e) {
        console.error(`Login failed for ${roleName}:`, e.message);
        await context.close();
        continue;
      }
    }

    for (const route of ROUTES) {
      const expectRe = route.expect[roleName];
      await page.goto(`${BASE}${route.path}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);

      const url = new URL(page.url());
      const pathname = url.pathname;
      const text = await page.locator("body").innerText();

      const urlOk = expectRe.test(pathname) || (expectRe.source === "login" && pathname.includes("/login"));
      const content = checkContent(route.path, pathname, text);
      const pass = urlOk && content.ok;

      matrix.push({
        route: route.path,
        role: roleName,
        pass,
        finalUrl: pathname,
        note: content.note,
      });
    }

    await context.close();
  }

  // Server action smoke: reviewer weights page should load without auth error
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, ROLES.reviewer);
    const resPromise = page.waitForResponse(
      (r) => r.url().includes("/_server") && r.request().method() === "POST",
      { timeout: 15000 },
    ).catch(() => null);
    await page.goto(`${BASE}/reviewer/weights`, { waitUntil: "domcontentloaded" });
    const res = await resPromise;
    const saOk = res && res.status() === 200;
    console.log(`\nServer action (reviewer /reviewer/weights): ${saOk ? "PASS" : "FAIL"} status=${res?.status()}`);
    matrix.push({ route: "_server:fetchWeightVotes", role: "reviewer", pass: !!saOk, finalUrl: "/reviewer/weights", note: `http ${res?.status()}` });

    await page.goto(`${BASE}/admin`);
    const noCookie = await page.context().request.post(`${BASE}/_server`, {
      headers: { "X-Server-Id": "ed400b358b62a06491424bba6f8eb13b4e5d700f67d112a42e98c4085c9b7aa3", "X-Server-Instance": "server-fn:qa" },
      data: "[]",
    }).catch((e) => ({ status: () => 0, ok: false }));
    const unauthBlocked = !noCookie.ok() || noCookie.status() >= 400;
    console.log(`Server action (no cookie): ${unauthBlocked ? "PASS" : "FAIL"} status=${noCookie.status?.() ?? "err"}`);
    matrix.push({ route: "_server:no-cookie", role: "guest", pass: unauthBlocked, finalUrl: "n/a", note: "blocked" });

    await context.close();
  }

  await browser.close();

  console.log("\n=== ROUTE MATRIX ===\n");
  console.log("| Route | Guest | User | Reviewer | Admin |");
  console.log("|-------|-------|------|----------|-------|");
  for (const route of ROUTES) {
    const cells = ["guest", "user", "reviewer", "admin"].map((role) => {
      const r = matrix.find((m) => m.route === route.path && m.role === role);
      return r?.pass ? "PASS" : `FAIL(${r?.finalUrl})`;
    });
    console.log(`| ${route.path} | ${cells.join(" | ")} |`);
  }

  console.log("\nDetail:");
  for (const m of matrix) {
    console.log(`  ${m.role.padEnd(8)} ${m.route.padEnd(18)} -> ${m.finalUrl} (${m.note})`);
  }

  const failed = matrix.filter((m) => !m.pass);
  if (failed.length) {
    console.log("\nFailures detail:");
    for (const f of failed) console.log(`  ${f.role} ${f.route} -> ${f.finalUrl} (${f.note})`);
  }

  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
