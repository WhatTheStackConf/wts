import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { copyApp, freePort } from "./browser-runner-support.mjs";
import { startLiveQaPocketBase } from "../src/lib/live-qa-pocketbase-test-helper.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = await mkdtemp(join(tmpdir(), "wts-live-qa-browser-"));
const appDir = join(root, "app");
const children = new Set();
const gamification = process.argv.includes("--gamification");
const workspace = process.argv.includes("--workspace") || gamification;
let fixture;
let cleanupPromise;
async function clean() {
  return cleanupPromise ??= (async () => {
    for (const child of children) {
      if (child.exitCode !== null) continue;
      await new Promise(resolve => {
        const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
        child.kill("SIGTERM");
      });
    }
    await fixture?.cleanup();
    await rm(root, { recursive: true, force: true });
  })();
}
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, async () => { await clean(); process.exit(130); });
const env = Object.fromEntries(["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "CI", "PLAYWRIGHT_BROWSERS_PATH", "PNPM_HOME"].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
function start(command, args, options = {}) {
  const child = spawn(command, args, { cwd: appDir, env, stdio: "inherit", ...options });
  children.add(child);
  return child;
}
async function run(command, args, options) {
  const child = start(command, args, options);
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  if (code !== 0) throw new Error(`${command} exited ${code}`);
}
async function createUsers() {
  const users = {};
  for (const role of ["user", "reviewer", "checkin_operator", "mc", "admin"]) {
    const user = await fixture.user(role, `Browser ${role}`);
    users[role] = { id: user.record.id, email: user.record.email, password: fixture.password };
  }
  if (workspace) env.WTS_2027_ADMIN_USER_IDS = users.admin.id;
  const other = await fixture.user("user", "Browser other attendee");
  users.other = { id: other.record.id, email: other.record.email, password: fixture.password };
  return users;
}
async function openWorkspaceCfp() {
  const config = await fixture.pb.collection("conference_config").getFirstListItem("");
  await fixture.pb.collection("conference_config").update(config.id, {
    cfp_open: true,
    cfp_deadline: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    availability: { cfp: true, review: true },
  });
}
async function waitForQa(app, baseURL) {
  for (let i = 0; i < 120; i++) {
    if (app.exitCode !== null) throw new Error("Built Q&A server exited before readiness");
    try { if ((await fetch(`${baseURL}/login`, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* Booting. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Built Q&A server did not become ready");
}
function playwrightConfig() {
  if (gamification) return "playwright.gamification.config.ts";
  return workspace ? "playwright.workspace.config.ts" : "playwright.live-qa.config.ts";
}
async function main() {
  fixture = await startLiveQaPocketBase({ workspace, binary: process.env.WTS_AUTH_TEST_PB_BINARY });
  await copyApp(repo, appDir, ["tokens.css"]);
  const port = await freePort();
  const baseURL = `http://127.0.0.1:${port}`;
  Object.assign(env, {
    NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(port),
    POCKETBASE_URL: fixture.baseUrl, PUBLIC_POCKETBASE_URL: fixture.baseUrl, POCKETBASE_PUBLIC_URL: fixture.baseUrl,
    POCKETBASE_SUPERUSER_EMAIL: fixture.superuserEmail, POCKETBASE_SUPERUSER_PASSWORD: fixture.password,
    PUBLIC_SITE_URL: baseURL, SITE_URL: baseURL, VITE_SITE_URL: baseURL,
    HIEVENTS_API_URL: `${fixture.baseUrl}/unused-synthetic`, HIEVENTS_API_KEY: "", HIEVENTS_EMAIL: "", HIEVENTS_PASSWORD: "",
    GAMIFICATION_CODE_PEPPER: workspace ? `disposable-workspace-${crypto.randomUUID()}` : "",
    VITE_TURNSTILE_SITE_KEY: "", VITE_LISTMONK_LIST_ID: "",
  });
  const users = await createUsers();
  const talk = await fixture.session({ slug: "live-qa-browser-talk", stageKey: "stage-3", stageName: "Stage 2", displayOrder: 2, locationLabel: "Engineering Hall" });
  await fixture.session({ slug: "main-stage-one", stageKey: "stage-2", stageName: "Stage 1", displayOrder: 1, locationLabel: "Web Hall" });
  await fixture.pb.collection("agenda_tracks").create({ programme: talk.programme.id, key: "stage-5", name: "Stage 5", display_order: 5 });
  const weekday = await fixture.session({ slug: "weekday-qa-excluded", mainDay: false });
  if (workspace) await openWorkspaceCfp();
  // Public page dependencies absent from the narrow backend fixture are created
  // via their real migrations, never through a mocked public response.
  await run("pnpm", ["build"]);
  const app = start(process.execPath, ["--import", join(repo, "scripts/checkin-browser-egress.mjs"), join(appDir, ".output/server/index.mjs")]);
  await waitForQa(app, baseURL);
  const statePath = join(root, "fixture.json");
  await writeFile(statePath, JSON.stringify({ disposable: true, baseURL, pbUrl: fixture.baseUrl, superuserEmail: fixture.superuserEmail, password: fixture.password, users, slug: talk.slug, slotId: talk.slot.id, sessionId: talk.session.id, weekdaySlug: weekday.slug }), { mode: 0o600 });
  if (process.argv.includes("--inspect")) {
    console.log(`Disposable Q&A inspection ready: ${baseURL}\nFixture: ${statePath}\nStop runner ${process.pid} with SIGTERM to remove the disposable services and data.`);
    await new Promise(() => {});
  }
  await run("pnpm", ["exec", "playwright", "test", `--config=${playwrightConfig()}`, ...process.argv.slice(2).filter(argument => argument !== "--workspace" && argument !== "--gamification")], { cwd: repo, env: { ...env, WTS_LIVE_QA_BROWSER_STATE: statePath } });
}
try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally { await clean(); }
