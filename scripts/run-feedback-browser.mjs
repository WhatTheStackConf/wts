import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedFeedbackAdmin } from "./feedback-admin-fixture.mjs";
import { startFeedbackPocketBase } from "../src/lib/feedback-pocketbase-test-helper.ts";

// Always build a disposable copy with an allowlisted environment. Never load a
// developer .env, connect to production or send email during browser testing.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = await mkdtemp(join(tmpdir(), "wts-feedback-browser-"));
const appDir = join(root, "app");
const children = new Set();
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
try {
  fixture = await startFeedbackPocketBase();
  const adminMode = process.argv.includes("--admin");
  const adminFixture = adminMode ? await seedFeedbackAdmin(fixture) : undefined;
  await mkdir(appDir);
  for (const name of ["src", "public", "content", "scripts", "runtime"]) {
    await cp(join(repo, name), join(appDir, name), { recursive: true, filter: path => !path.split(/[\\/]/).some(part => part.startsWith(".env")) });
  }
  for (const name of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "tsconfig.checkin-runtime.json", "vite.config.ts", "velite.config.ts"]) await cp(join(repo, name), join(appDir, name));
  await mkdir(join(appDir, "node_modules"));
  for (const name of await readdir(join(repo, "node_modules"))) {
    if ([".nitro", ".vite", ".cache", ".vite-temp"].includes(name)) continue;
    await symlink(join(repo, "node_modules", name), join(appDir, "node_modules", name));
  }
  const listener = createServer();
  await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const baseURL = `http://127.0.0.1:${port}`;
  Object.assign(env, {
    NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(port),
    POCKETBASE_URL: fixture.baseUrl, PUBLIC_POCKETBASE_URL: fixture.baseUrl, POCKETBASE_PUBLIC_URL: fixture.baseUrl,
    PUBLIC_SITE_URL: baseURL, SITE_URL: baseURL, VITE_SITE_URL: baseURL,
    HIEVENTS_API_URL: `${fixture.baseUrl}/unused-synthetic`, HIEVENTS_API_KEY: "", HIEVENTS_EMAIL: "", HIEVENTS_PASSWORD: "",
    VITE_TURNSTILE_SITE_KEY: "", VITE_LISTMONK_LIST_ID: "",
  });
  if (adminFixture) Object.assign(env, { POCKETBASE_SUPERUSER_EMAIL: adminFixture.server.email, POCKETBASE_SUPERUSER_PASSWORD: adminFixture.server.password });
  await run("pnpm", ["build"]);
  const app = start(process.execPath, ["--import", join(repo, "scripts/checkin-browser-egress.mjs"), join(appDir, ".output/server/index.mjs")]);
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (app.exitCode !== null) throw new Error("Built feedback server exited before readiness");
    try { if ((await fetch(`${baseURL}/feedback`, { signal: AbortSignal.timeout(500) })).ok) { ready = true; break; } } catch { /* Starting. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("Built feedback server did not become ready");
  const statePath = join(root, "fixture.json");
  await writeFile(statePath, JSON.stringify({ disposable: true, baseURL, pbUrl: fixture.baseUrl, rootToken: fixture.pb.authStore.token, ...(adminFixture ? { accounts: adminFixture.accounts, surveys: adminFixture.surveys } : {}) }), { mode: 0o600 });
  if (adminMode) {
    await run(join(repo, "node_modules/.bin/playwright"), ["test", "--config=playwright.feedback-admin.config.ts"], { cwd: repo, env: { ...env, WTS_FEEDBACK_BROWSER_STATE: statePath } });
  }
  if (process.argv.includes("--inspect")) {
    console.log(`Disposable feedback inspection ready: ${baseURL}\nFixture: ${statePath}\nStop runner ${process.pid} with SIGTERM to remove disposable services and data.`);
    await new Promise(() => {});
  }
  if (!adminMode) await run(join(repo, "node_modules/.bin/playwright"), ["test", "--config=playwright.feedback.config.ts", ...process.argv.slice(2)], { cwd: repo, env: { ...env, WTS_FEEDBACK_BROWSER_STATE: statePath } });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Feedback browser verification failed.");
  process.exitCode = 1;
} finally { await clean(); }
