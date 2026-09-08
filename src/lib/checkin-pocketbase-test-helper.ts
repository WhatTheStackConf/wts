import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import PocketBase from "pocketbase";

/** Real isolated PB; no .env, copied production data, or outbound-effect hooks.
 * All feature migrations are copied byte-for-byte, never rewritten or skipped. */
export async function startCheckinPocketBase() {
  const root = mkdtempSync(join(tmpdir(), "wts-checkin-test-"));
  const migrationsDir = join(root, "pb_migrations");
  const hooksDir = join(root, "pb_hooks");
  const dataDir = join(root, "pb_data");
  for (const directory of [migrationsDir, hooksDir, dataDir]) mkdirSync(directory);
  const source = fileURLToPath(new URL("../../pocketbase/", import.meta.url));
  const migrations = [
    "1735401500_create_cfp_applicants.js", "1735401600_create_cfp_submissions.js",
    "1768850000_roles_and_reviews.js", "1768850001_fix_user_role.js",
    "1768850002_create_cfp_weight_votes.js", "1768850003_restrict_admin_writes.js",
    "1776000002_add_cfp_submissions_status.js", "1777000000_harden_auth_and_reviewer_rules.js",
    "1777000001_fix_users_role_update_rule.js", "1781000000_fix_registration_role_escalation.js",
    "1783000000_create_mcp_tokens.js", "1787000004_create_admin_actions.js",
    "1787000007_harden_reviewer_ownership.js",
    ...readdirSync(join(source, "pb_migrations")).filter((name) => /checkin.*\.js$/.test(name)),
  ];
  for (const name of migrations) copyFileSync(join(source, "pb_migrations", name), join(migrationsDir, name));
  for (const name of readdirSync(join(source, "pb_hooks")).filter((name) => name.startsWith("checkin") || name === "users_role_guard.pb.js" || name === "admin_action_ledger.pb.js")) {
    copyFileSync(join(source, "pb_hooks", name), join(hooksDir, name));
  }
  const binary = join(source, "pocketbase");
  const args = [`--dir=${dataDir}`, `--migrationsDir=${migrationsDir}`, `--hooksDir=${hooksDir}`];
  function run(command: string[]) {
    const result = spawnSync(binary, [...command, ...args], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`Disposable PB command failed: ${result.error?.message || ""}\n${result.stdout}\n${result.stderr}`);
  }
  const password = "Disposable-test-only-2026!";
  const email = "root-checkin@example.test";
  let server: ChildProcess | undefined;
  let logs = "";
  async function stop() {
    if (!server || server.exitCode !== null) return;
    const process = server;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { process.kill("SIGKILL"); }, 1000);
      process.once("exit", () => { clearTimeout(timer); resolve(); });
      process.kill("SIGTERM");
    });
  }
  try {
    run(["migrate", "up"]);
    run(["superuser", "create", email, password, "--automigrate=false"]);
    const port = await new Promise<number>((resolve, reject) => {
      const listener = createServer();
      listener.once("error", reject);
      listener.listen(0, "127.0.0.1", () => {
        const address = listener.address();
        if (!address || typeof address === "string") return reject(new Error("Missing local test port"));
        listener.close((error) => error ? reject(error) : resolve(address.port));
      });
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    async function start() {
      server = spawn(binary, ["serve", `--http=127.0.0.1:${port}`, ...args, "--automigrate=false", "--hooksWatch=false"], { stdio: ["ignore", "pipe", "pipe"] });
      server.stdout?.on("data", (chunk) => { logs += String(chunk); });
      server.stderr?.on("data", (chunk) => { logs += String(chunk); });
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          if ((await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(300) })).ok) return;
        } catch { /* Local process starting. */ }
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      throw new Error(`Disposable PB failed to start: ${logs}`);
    }
    await start();
    const pb = new PocketBase(baseUrl);
    pb.autoCancellation(false);

    await pb.collection("_superusers").authWithPassword(email, password);
    return {
      pb, baseUrl, root, migrations, password,
      logs: () => logs,
      restart: async () => { await stop(); await start(); },
      cleanup: async () => { await stop(); rmSync(root, { recursive: true, force: true }); },
      async user(role: string, name = "Test Human") {
        const id = crypto.randomUUID();
        const userEmail = `${id}@example.test`;
        const record = await pb.collection("users").create({ email: userEmail, password, passwordConfirm: password, name, role, verified: true });
        const client = new PocketBase(baseUrl);
        client.autoCancellation(false);
        await client.collection("users").authWithPassword(userEmail, password);
        return { record, client, actor: { userId: record.id, role } };
      },
    };
  } catch (error) {
    await stop();
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
