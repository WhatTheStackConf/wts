import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { get as httpsGet } from "node:https";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import PocketBase from "pocketbase";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = await mkdtemp(join(tmpdir(), "wts-checkin-browser-"));
const appDir = join(root, "app");
const children = new Set();
let cleanupPromise;
const clean = () => cleanupPromise ??= (async () => {
  for (const child of children) {
    if (child.exitCode !== null) continue;
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 2000)),
    ]);
  }
  await rm(root, { recursive: true, force: true });
})();
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, async () => { await clean(); process.exit(130); });

async function port() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (!address || typeof address === "string") throw new Error("Could not allocate disposable port");
  return address.port;
}

function start(command, args, options = {}) {
  const child = spawn(command, args, { cwd: appDir, env, stdio: "inherit", ...options });
  children.add(child);
  return child;
}
async function run(command, args, options) {
  const child = start(command, args, options);
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  if (code !== 0) throw new Error(`${command} ${args.join(" ")} exited ${code}`);
}
async function ready(url, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Disposable server exited ${child.exitCode} before ${url}`);
    try { if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* not yet listening */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Disposable server not ready: ${url}`);
}

// Allowlist rather than inheriting shell secrets. No dotenv file is copied/read.
const env = Object.fromEntries(["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "CI", "PLAYWRIGHT_BROWSERS_PATH", "PNPM_HOME"].flatMap((key) => process.env[key] ? [[key, process.env[key]]] : []));
try {
  await mkdir(appDir);
  for (const directory of ["src", "public", "content", "scripts", "runtime"]) {
    await cp(join(repo, directory), join(appDir, directory), { recursive: true, filter: (path) => !path.split(/[\\/]/).some((part) => part.startsWith(".env")) });
  }
  for (const name of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "tsconfig.checkin-runtime.json", "vite.config.ts", "velite.config.ts"]) {
    await cp(join(repo, name), join(appDir, name));
  }
  await mkdir(join(appDir, "node_modules"));
  for (const name of await readdir(join(repo, "node_modules"))) {
    if ([".nitro", ".vite", ".cache", ".vite-temp"].includes(name)) continue;
    await symlink(join(repo, "node_modules", name), join(appDir, "node_modules", name));
  }
  const pbPort = await port();
  const appPort = await port();
  const pbUrl = `http://127.0.0.1:${pbPort}`;
  const baseURL = `http://127.0.0.1:${appPort}`;
  const upstreamURL = `https://127.0.0.1:${await port()}`;
  const upstreamToken = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url")}.${Buffer.from('{"account_id":77}').toString("base64url")}.${randomBytes(24).toString("base64url")}`;
  const certPath = join(root, "upstream-cert.pem");
  // Trust only this per-run synthetic TLS certificate, not arbitrary upstreams.
  const certificate = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-noenc", "-keyout", join(root, "upstream-key.pem"), "-out", certPath, "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { env, stdio: "ignore" });
  if (certificate.status !== 0) throw new Error("Could not generate disposable upstream TLS certificate; openssl is required");
  const password = `Disposable-${randomBytes(24).toString("hex")}!`;
  const superuserEmail = "browser-root@example.test";
  Object.assign(env, {
    NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(appPort),
    POCKETBASE_URL: pbUrl, PUBLIC_POCKETBASE_URL: pbUrl, POCKETBASE_PUBLIC_URL: pbUrl, VITE_POCKETBASE_URL: pbUrl,
    POCKETBASE_SUPERUSER_EMAIL: superuserEmail, POCKETBASE_SUPERUSER_PASSWORD: password,
    PUBLIC_SITE_URL: baseURL, SITE_URL: baseURL, VITE_SITE_URL: baseURL,
    HIEVENTS_API_URL: `${upstreamURL}/api`, HIEVENTS_API_KEY: upstreamToken, HIEVENTS_ACCOUNT_ID: "77", HIEVENTS_EMAIL: "", HIEVENTS_PASSWORD: "", HIEVENTS_EVENT_ID: "",
    NODE_EXTRA_CA_CERTS: certPath, WTS_SYNTHETIC_UPSTREAM_ROOT: root,
    VITE_TURNSTILE_SITE_KEY: "", VITE_LISTMONK_LIST_ID: "",
  });
  const upstreamProcess = start(process.execPath, [join(repo, "scripts/checkin-hievents-fixture.mjs")]);
  const ca = await readFile(certPath);
  let upstreamReady = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (upstreamProcess.exitCode !== null) throw new Error("Synthetic upstream exited before readiness");
    upstreamReady = await new Promise((resolve) => {
      const req = httpsGet(`${upstreamURL}/health`, { ca, timeout: 500 }, (response) => { response.resume(); resolve(response.statusCode === 200); });
      req.on("error", () => resolve(false)); req.on("timeout", () => { req.destroy(); resolve(false); });
    });
    if (upstreamReady) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!upstreamReady) throw new Error("Synthetic upstream TLS health check failed");
  const migrationsDir = join(root, "pb_migrations");
  const hooksDir = join(root, "pb_hooks");
  const dataDir = join(root, "pb_data");
  await mkdir(migrationsDir); await mkdir(hooksDir); await mkdir(dataDir);
  // Legacy ID-addressed schema edits are not valid on fresh PocketBase. Include
  // the named base schema dependencies, then the UNMODIFIED feature migration.
  const migrations = [
    "1735401500_create_cfp_applicants.js", "1735401600_create_cfp_submissions.js",
    "1768850000_roles_and_reviews.js", "1768850001_fix_user_role.js",
    "1768850002_create_cfp_weight_votes.js", "1768850003_restrict_admin_writes.js",
    "1776000002_add_cfp_submissions_status.js", "1777000000_harden_auth_and_reviewer_rules.js",
    "1777000001_fix_users_role_update_rule.js", "1781000000_fix_registration_role_escalation.js",
    "1783000000_create_mcp_tokens.js", "1787000004_create_admin_actions.js", "1787000007_harden_reviewer_ownership.js",
    "1790000008_add_journaled_print_delivery.js",
    ...(await readdir(join(repo, "pocketbase/pb_migrations"))).filter((name) => /checkin.*\.js$/.test(name)),
  ];
  if (!migrations.some((name) => name.includes("checkin"))) throw new Error("Required checkin migration is missing");
  for (const name of migrations) await cp(join(repo, "pocketbase/pb_migrations", name), join(migrationsDir, name));
  const hooks = (await readdir(join(repo, "pocketbase/pb_hooks"))).filter((name) => name.startsWith("checkin") || name === "users_role_guard.pb.js" || name === "admin_action_ledger.pb.js");
  if (!hooks.some((name) => name.startsWith("checkin"))) throw new Error("Required checkin hook is missing");
  for (const name of hooks) await cp(join(repo, "pocketbase/pb_hooks", name), join(hooksDir, name));
  const binary = join(repo, "pocketbase/pocketbase");
  const version = spawnSync(binary, ["--version"], { encoding: "utf8", env });
  if (version.status !== 0 || !version.stdout.includes("0.30.4")) throw new Error("Required PocketBase 0.30.4 missing; run pnpm pocketbase:download-test");
  const pbArgs = [`--dir=${dataDir}`, `--migrationsDir=${migrationsDir}`, `--hooksDir=${hooksDir}`, "--automigrate=false"];
  await run(binary, ["migrate", "up", ...pbArgs]);
  await run(binary, ["superuser", "create", superuserEmail, password, ...pbArgs]);
  const pbProcess = start(binary, ["serve", `--http=127.0.0.1:${pbPort}`, "--hooksWatch=false", ...pbArgs]);
  await ready(`${pbUrl}/api/health`, pbProcess);
  const pb = new PocketBase(pbUrl);
  await pb.collection("_superusers").authWithPassword(superuserEmail, password);
  const users = {};
  for (const [key, role] of [["admin", "admin"], ["operator", "checkin_operator"], ["handoff", "checkin_operator"], ["ordinary", "user"]]) {
    const email = `browser-${key}@example.test`;
    const record = await pb.collection("users").create({ email, password, passwordConfirm: password, verified: true, role, name: `Browser ${key}` }).catch((error) => {
      throw new Error(`Disposable ${key} creation failed: ${JSON.stringify(error.response?.data ?? {})}`);
    });
    users[key] = { id: record.id, email, password };
  }
  await run("pnpm", ["build"]);
  const appProcess = start(process.execPath, ["--import", join(repo, "scripts/checkin-browser-egress.mjs"), join(appDir, ".output/server/index.mjs")]);
  await ready(`${baseURL}/login`, appProcess);
  const statePath = join(root, "fixture.json");
  await writeFile(statePath, JSON.stringify({ disposable: true, root, baseURL, pbUrl, superuserEmail, password, users, upstreamURL, upstreamToken }), { mode: 0o600 });
  if (process.argv.includes("--inspect")) {
    console.log(`Disposable inspection ready: ${baseURL}\nFixture: ${statePath}\nSend SIGTERM to runner ${process.pid} to stop and delete all disposable state.`);
    await new Promise(() => {});
  }
  await run("pnpm", ["exec", "playwright", "test", ...process.argv.slice(2)], {
    cwd: repo, env: { ...env, WTS_CHECKIN_BROWSER_STATE: statePath },
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await clean();
}
