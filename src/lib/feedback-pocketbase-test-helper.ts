import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import PocketBase, { BaseAuthStore } from "pocketbase";

/** Disposable loopback database; copies only real feedback migrations/hooks.
 * No existing data, .env, mail, cron, production credentials or outbound hooks.
 * Feedback is standalone: PocketBase's built-in migrations are its only prerequisite.
 * No survey is seeded until invitation() is called. pb is a fixture superuser client.
 */
export async function startFeedbackPocketBase(options: { binary?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "wts-feedback-test-"));
  const migrationsDir = join(root, "pb_migrations");
  const hooksDir = join(root, "pb_hooks");
  const dataDir = join(root, "pb_data");
  for (const dir of [migrationsDir, hooksDir, dataDir]) mkdirSync(dir);
  const source = fileURLToPath(new URL("../../pocketbase/", import.meta.url));
  const migrations = readdirSync(join(source, "pb_migrations")).filter(n => n.endsWith("_create_feedback.js"));
  const hooks = readdirSync(join(source, "pb_hooks")).filter(n => n.startsWith("feedback"));
  for (const name of migrations) copyFileSync(join(source, "pb_migrations", name), join(migrationsDir, name));
  for (const name of hooks) copyFileSync(join(source, "pb_hooks", name), join(hooksDir, name));
  const binary = options.binary || process.env.WTS_TEST_POCKETBASE_BINARY || join(source, "pocketbase");
  const args = [`--dir=${dataDir}`, `--migrationsDir=${migrationsDir}`, `--hooksDir=${hooksDir}`];
  function run(command: string[]) {
    const result = spawnSync(binary, [...command, ...args], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`Disposable feedback PB failed: ${result.error?.message || ""}\n${result.stdout}\n${result.stderr}`);
    return result.stdout.trim();
  }
  const password = `Fixture-only-${randomBytes(24).toString("hex")}`;
  const email = "feedback-root@example.test";
  let server: ChildProcess | undefined;
  let logs = "";
  async function stop() {
    if (!server || server.exitCode !== null) return;
    const child = server;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 1000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
      child.kill("SIGTERM");
    });
  }
  try {
    const version = run(["--version"]);
    run(["migrate", "up"]);
    run(["superuser", "create", email, password, "--automigrate=false"]);
    const port = await new Promise<number>((resolve, reject) => {
      const listener = createServer();
      listener.once("error", reject);
      listener.listen(0, "127.0.0.1", () => {
        const address = listener.address();
        if (!address || typeof address === "string") return reject(new Error("Missing fixture port"));
        listener.close(error => error ? reject(error) : resolve(address.port));
      });
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    async function start() {
      server = spawn(binary, ["serve", `--http=127.0.0.1:${port}`, ...args, "--dev=false", "--automigrate=false", "--hooksWatch=false"], { stdio: ["ignore", "pipe", "pipe"] });
      server.stdout?.on("data", chunk => { logs += String(chunk); });
      server.stderr?.on("data", chunk => { logs += String(chunk); });
      for (let attempt = 0; attempt < 100; attempt++) {
        try { if ((await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(300) })).ok) return; } catch { /* starting */ }
        if (server.exitCode !== null) break;
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      throw new Error(`Disposable feedback PB failed to start: ${logs}`);
    }
    await start();
    const pb = new PocketBase(baseUrl, new BaseAuthStore());
    pb.autoCancellation(false);
    await pb.collection("_superusers").authWithPassword(email, password);
    return {
      pb, baseUrl, root, version, migrations, hooks,
      logs: () => logs,
      restart: async () => { await stop(); await start(); },
      cleanup: async () => { await stop(); rmSync(root, { recursive: true, force: true }); },
      /** Fault injection changes disposable storage only, never the production hook. */
      async responseInsertFailure(enabled: boolean) {
        await stop();
        try {
          const sql = enabled
            ? "CREATE TRIGGER feedback_fixture_abort BEFORE INSERT ON feedback_responses BEGIN SELECT RAISE(ABORT, 'fixture response insert failure'); END;"
            : "DROP TRIGGER feedback_fixture_abort;";
          const result = spawnSync("python3", ["-c", "import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.executescript(sys.argv[2]); db.close()", join(dataDir, "data.db"), sql], { encoding: "utf8" });
          if (result.status !== 0) throw new Error(`Fixture fault injection failed: ${result.stderr}`);
        } finally { await start(); }
      },
      async invitation(options: { survey?: string; surveyFields?: Record<string, unknown>; invitationFields?: Record<string, unknown> } = {}) {
        const now = Date.now();
        const survey = options.survey
          ? await pb.collection("feedback_surveys").getOne(options.survey)
          : await pb.collection("feedback_surveys").create({
            key: `fixture-${randomUUID()}`, title: "Synthetic feedback", version: "v1", open: true,
            opens_at: new Date(now - 60_000).toISOString(), closes_at: new Date(now + 3_600_000).toISOString(),
            sessions: [{ id: "synthetic-session", title: "Synthetic session" }], ...options.surveyFields,
          });
        const token = randomBytes(32).toString("base64url");
        const invitation = await pb.collection("feedback_invitations").create({
          survey: survey.id, source_key: `fixture:${randomUUID()}`, email: "attendee@example.test",
          token_hash: createHash("sha256").update(token).digest("hex"), used: false, revoked: false,
          expires_at: new Date(now + 3_600_000).toISOString(), ...options.invitationFields,
        });
        return { survey, invitation, token };
      },
    };
  } catch (error) {
    await stop();
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
export type FeedbackPocketBaseFixture = Awaited<ReturnType<typeof startFeedbackPocketBase>>;
