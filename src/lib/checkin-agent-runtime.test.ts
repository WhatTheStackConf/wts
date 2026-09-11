import { afterEach, expect, it } from "vite-plus/test";
import { mkdtempSync, rmSync, copyFileSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { startCheckinPocketBase } from "~/lib/checkin-pocketbase-test-helper";
import { CheckinService } from "~/lib/checkin-service";
import { CheckinAgentService } from "~/lib/checkin-agent-service";
import { AgentJournal } from "../../runtime/checkin/journal.js";
import { AgentRuntime, HttpAgentTransport } from "../../runtime/checkin/agent.js";
import { AgentError, printPayloadHash, type Operation } from "../../runtime/checkin/protocol.js";
import { NiimbotSerialPrinter, SimulatedNiimbotPrinter, type NiimbotPrinter } from "../../runtime/checkin/printer.js";
import { LABEL_FONT_VERSION, LABEL_RENDERER_VERSION } from "~/lib/checkin-label-render-contract";

it("scopes the service to an exact serial path without unsupported device globs", () => {
  const unit = readFileSync(new URL("../../deployment/systemd/wts-checkin-agent.service", import.meta.url), "utf8");
  const devicePaths = unit.split("\n").filter((line) => line.startsWith("DeviceAllow="));
  expect(devicePaths).toEqual(["DeviceAllow=/dev/serial/by-id/usb-NIIMBOT_B1_LABEL_PRINTER_<serial>-if00 rw"]);
  expect(unit).toContain("PrivateDevices=no");
  expect(unit).toContain("DevicePolicy=closed");
  expect(unit).toContain("RestartPreventExitStatus=78");
});

it("adds profile snapshots after journaled delivery without rewriting legacy work or replaying migrations", async () => {
  const fixture = await startCheckinPocketBase();
  try {
    const root = join(fixture.root, "upgrade");
    const migrationsDir = join(root, "pb_migrations");
    const dataDir = join(root, "pb_data");
    mkdirSync(migrationsDir, { recursive: true });
    const migration = "1790000009_add_checkin_profile_snapshots.js";
    // Exercise this historical upgrade, not every future release migration.
    const ordered = [...new Set(fixture.migrations)].filter(name => name <= migration).sort();
    expect(ordered.at(-1)).toBe(migration);
    expect(ordered.at(-2)).toBe("1790000008_add_journaled_print_delivery.js");
    const copy = (name: string) => copyFileSync(new URL(`../../pocketbase/pb_migrations/${name}`, import.meta.url), join(migrationsDir, name));
    for (const name of ordered.filter((name) => name !== migration)) copy(name);
    const migrate = () => {
      const result = spawnSync(fileURLToPath(new URL("../../pocketbase/pocketbase", import.meta.url)), ["migrate", "up", `--dir=${dataDir}`, `--migrationsDir=${migrationsDir}`], { encoding: "utf8" });
      expect(result.status, result.stdout + result.stderr).toBe(0);
    };
    migrate();
    const tables = ["checkin_arrival_workflows", "checkin_print_attempts"];
    const dbPath = join(dataDir, "data.db");
    const before = new DatabaseSync(dbPath);
    let snapshots: Record<string, unknown>[];
    try {
      for (const table of tables) {
        expect(before.prepare(`PRAGMA table_info(${table})`).all().map((field) => field.name)).not.toContain("profile_snapshot");
      }
      // Synthetic pre-upgrade rows, deliberately bypassing current application hooks.
      before.prepare("INSERT INTO checkin_arrival_workflows (id, name, state, profile_config) VALUES (?, ?, ?, ?)").run("legacyworkflow1", "Legacy Test", "accepted", '{"version":1}');
      before.prepare("INSERT INTO checkin_print_attempts (id, workflow_id, state, payload_hash, profile_config) VALUES (?, ?, ?, ?, ?)").run("legacyprint0001", "legacyworkflow1", "queued", "a".repeat(64), '{"version":1}');
      snapshots = tables.map((table) => before.prepare(`SELECT * FROM ${table}`).get()!);
    } finally { before.close(); }
    copy(migration);
    migrate();
    migrate(); // Re-running the real deploy command must be a no-op.
    const after = new DatabaseSync(dbPath, { readOnly: true });
    try {
      tables.forEach((table, index) => {
        expect(after.prepare(`PRAGMA table_info(${table})`).all().map((field) => field.name)).toContain("profile_snapshot");
        const row = after.prepare(`SELECT * FROM ${table}`).get()!;
        const { profile_snapshot: profileSnapshot, ...unchanged } = row;
        expect(profileSnapshot).toBeNull(); // No invented approval or mutable-profile backfill.
        expect(unchanged).toEqual(snapshots[index]);
      });
      expect(after.prepare("SELECT COUNT(*) AS count FROM _migrations WHERE file = ?").get(migration)?.count).toBe(1);
    } finally { after.close(); }
  } finally { await fixture.cleanup(); }
}, 40000);

it("runs the compiled CLIs against disposable PocketBase and quarantines a missing journal", async () => {
  // The canonical test command compiles before workers start. Rechecking must
  // not rewrite modules while sibling CLI integration tests execute them.
  const build = spawnSync("pnpm", ["exec", "tsc", "--project", "tsconfig.checkin-runtime.json", "--noEmit"], { encoding: "utf8" });
  expect(build.status, build.stdout + build.stderr).toBe(0);
  const fixture = await startCheckinPocketBase();
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const admin = await fixture.user("admin");
    const human = new CheckinService(fixture.pb, admin.actor);
    const service = new CheckinAgentService(fixture.pb, admin.actor);
    const stationId = "wts2026station1";
    await human.adminControl({ operation: "configure_station", operationId: crypto.randomUUID(), expectedVersion: 1, stationId, label: "CLI Test", location: "Test", printerRef: "test-printer", reason: "configuration" });
    const localIdentity = { ...identity, profileId: "" };
    const issued = await service.issue({ ...localIdentity, stationId, operationId: crypto.randomUUID(), expectedStationVersion: 2, reason: "configuration", note: "Disposable CLI fixture", credentialLifetimeHours: 1 });
    const root = join(fixture.root, "cli");
    const config = (name: string, value: unknown) => { const file = root + name; writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value), { mode: 0o600 }); return file; };
    const credential = config("-pb.json", { email: "root-checkin@example.test", password: fixture.password });
    const coordConfig = config("-coordinator.json", { pocketbaseUrl: fixture.baseUrl, superuserCredentialFile: credential, host: "127.0.0.1", port: 0, heartbeatIntervalMs: 100 });
    child = spawn(process.execPath, [".output/checkin-runtime/runtime/checkin/cli.js", "coordinator", coordConfig], { stdio: ["ignore", "pipe", "pipe"] });
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CLI readiness timeout")), 10000);
      child!.once("exit", () => { clearTimeout(timer); reject(new Error("Coordinator CLI exited")); });
      child!.stdout!.on("data", chunk => { try { const result = JSON.parse(String(chunk)); if (result.category === "coordinator_ready") { clearTimeout(timer); resolve(result.port); } } catch { /* await complete line */ } });
    });
    const journalPath = root + "-journal.sqlite";
    const agentConfig = config("-agent.json", { identity: localIdentity, journalPath, coordinatorUrl: `http://127.0.0.1:${port}`, agentCredentialFile: config("-token", issued.credential!), once: true });
    const run = (mode: string) => spawnSync(process.execPath, [".output/checkin-runtime/runtime/checkin/cli.js", mode, agentConfig], { encoding: "utf8", timeout: 15000 });
    expect(run("init-agent").status).toBe(0);
    const heartbeat = run("agent"); expect(heartbeat.status, heartbeat.stderr).toBe(0); expect(heartbeat.stdout).toContain("agent_heartbeat_ok");
    expect((await service.adminList()).stations.find(s => s.stationId === stationId)).toMatchObject({ connection: "connected", journal: "healthy" });
    rmSync(journalPath); const failed = run("agent"); expect(failed.status).toBe(78); expect(failed.stderr).toContain("journal_lost");
    expect((await service.adminList()).stations.find(s => s.stationId === stationId)).toMatchObject({ journal: "quarantined" });
  } finally {
    if (child && child.exitCode === null) await new Promise<void>(resolve => { child!.once("exit", () => resolve()); child!.kill("SIGTERM"); });
    await fixture.cleanup();
  }
}, 40000);


it("durably reuses authorization after response loss and never retries a possibly-started boundary", async () => {
  const file = path(); AgentJournal.provision(file, identity);
  let journal = new AgentJournal(file, identity);
  let now = Date.now();
  const calls: { operation: Operation; payload: Record<string, unknown> }[] = [];
  let lost = true;
  const work = { attemptId: "attempt01", profileId: identity.profileId, payloadHash: "b".repeat(64) };
  const transport = { async request(operation: Operation, payload: Record<string, unknown>): Promise<unknown> {
    calls.push({ operation, payload: structuredClone(payload) });
    if (operation === "authorize") {
      if (lost) { lost = false; throw new AgentError("network_unavailable"); }
      return { attemptId: work.attemptId, stationId: identity.stationId, agentId: "agent01", payloadHash: work.payloadHash, expiresAt: new Date(now + 9000).toISOString(), stationGeneration: 1, systemGeneration: 1, coordinatorGeneration: 1 };
    }
    if (operation === "start") throw new AgentError("network_unavailable");
    if (operation === "outcome") return { attemptId: work.attemptId, outcome: payload.outcome };
    throw new Error("Unexpected request");
  } };
  let runtime = new AgentRuntime(identity, journal, transport, { now: () => now });
  await expect(runtime.authorize(work)).rejects.toThrow(); journal.close();
  journal = new AgentJournal(file, identity); runtime = new AgentRuntime(identity, journal, transport, { now: () => now });
  await runtime.authorize(work);
  expect(calls[0].payload).toEqual(calls[1].payload);
  expect(calls[0].payload.authorizationHash).toMatch(/^[a-f0-9]{64}$/);
  await expect(runtime.start(work.attemptId)).rejects.toThrow();
  await expect(runtime.start(work.attemptId)).rejects.toThrow();
  expect(calls.filter(c => c.operation === "start")).toHaveLength(1);
  journal.close(); journal = new AgentJournal(file, identity);
  runtime = new AgentRuntime(identity, journal, transport, { now: () => now });
  expect(await runtime.report(work.attemptId, "output_uncertain")).toEqual({ attemptId: work.attemptId, outcome: "output_uncertain" });
  await expect(runtime.report(work.attemptId, "protocol_complete")).rejects.toThrow();
  journal.close();
});

it("bounds safe retries, honors rate limits, and never automatically repeats mutations", async () => {
  const credential = "wts_agent_" + "a".repeat(64);
  const delays: number[] = []; let calls = 0;
  const transport = new HttpAgentTransport("http://127.0.0.1:9999", credential, {
    fetch: async () => { calls++; return new Response("{}", { status: 429, headers: { "Retry-After": "2" } }); },
    sleep: async ms => { delays.push(ms); }, random: () => 0,
  });
  await expect(transport.request("heartbeat", {})).rejects.toThrow("backpressure");
  expect(calls).toBe(3); expect(delays).toEqual([2000, 2000]);
  calls = 0; delays.length = 0;
  await expect(transport.request("start", {})).rejects.toThrow(); expect(calls).toBe(1); expect(delays).toEqual([]);
  const forbidden = new HttpAgentTransport("https://example.test", credential, { fetch: async (_url, options) => { expect(options?.redirect).toBe("error"); calls++; return new Response("secret diagnostic", { status: 403 }); } });
  calls = 0; await expect(forbidden.request("work", {})).rejects.toThrow("request_rejected"); expect(calls).toBe(1);
  expect(() => new HttpAgentTransport("http://192.0.2.1", credential)).toThrow("invalid_config");
  const huge = new HttpAgentTransport("http://127.0.0.1", credential, { fetch: async () => new Response(JSON.stringify({ data: "x".repeat(70000) }), { headers: { "Content-Type": "application/json" } }) });
  await expect(huge.request("status", {})).rejects.toThrow("invalid_response");
});
it("rejects corrupt journals and exposes a restored snapshot's older sequence", () => {
  const file = path(); const backup = path(); AgentJournal.provision(file, identity);
  let journal = new AgentJournal(file, identity); const old = journal.heartbeat(); journal.close(); copyFileSync(file, backup);
  journal = new AgentJournal(file, identity); const current = journal.heartbeat(); journal.close();
  copyFileSync(backup, file); journal = new AgentJournal(file, identity);
  expect(journal.snapshot()).toEqual(old); expect(journal.snapshot().journalSequence).toBeLessThan(current.journalSequence); journal.close();
  writeFileSync(file, "not sqlite"); expect(() => new AgentJournal(file, identity)).toThrow("journal_corrupt");
});
it("rejects delayed authorization and identity/payload mismatch without opening a start boundary", async () => {
  const file = path(); AgentJournal.provision(file, identity); const journal = new AgentJournal(file, identity);
  let clock = Date.now(); let mono = 0;
  const work = { attemptId: "attempt02", profileId: identity.profileId, payloadHash: "c".repeat(64) };
  const runtime = new AgentRuntime(identity, journal, { async request() { mono += 10001; return { attemptId: work.attemptId, stationId: identity.stationId, agentId: "agent01", payloadHash: work.payloadHash, expiresAt: new Date(clock + 9000).toISOString(), stationGeneration: 1, systemGeneration: 1, coordinatorGeneration: 1 }; } }, { now: () => clock, monotonic: () => mono });
  await expect(runtime.authorize(work)).rejects.toThrow("authorization_expired");
  await expect(runtime.start(work.attemptId)).rejects.toThrow("start_blocked");
  await expect(runtime.authorize({ ...work, payloadHash: "d".repeat(64) })).rejects.toThrow("attempt_conflict"); journal.close();
});

const identity = { stationId: "wts2026station1", agentIdentity: "test-pi", printerIdentity: "test-printer", journalIdentity: "test-journal", profileId: "testprofile0000" };
const roots: string[] = [];
function path() { const root = mkdtempSync(join(tmpdir(), "agent-runtime-")); roots.push(root); return join(root, "journal.sqlite"); }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
it("requires explicit provisioning and preserves heartbeat history across a real SQLite reopen", () => {
  const file = path();
  expect(() => new AgentJournal(file, identity)).toThrow("journal_lost");
  AgentJournal.provision(file, identity);
  expect(() => AgentJournal.provision(file, identity)).toThrow();
  const journal = new AgentJournal(file, identity);
  const first = journal.heartbeat(); const second = journal.heartbeat();
  expect(second.journalSequence).toBeGreaterThan(first.journalSequence);
  expect(second.journalDigest).not.toBe(first.journalDigest);
  journal.close();
  const reopened = new AgentJournal(file, identity);
  expect(reopened.snapshot()).toEqual(second); reopened.close();
  expect(() => new AgentJournal(file, { ...identity, printerIdentity: "other" })).toThrow("journal_restored");
});

it("receipts immutable label payloads before acknowledgement and serializes the complete simulated print task", async () => {
  const file = path(); AgentJournal.provision(file, identity); const journal = new AgentJournal(file, identity);
  const calls: Operation[] = [];
  const transport = { async request(operation: Operation, payload: Record<string, unknown>): Promise<unknown> {
    calls.push(operation);
    if (operation === "authorize") return { attemptId: payload.attemptId, stationId: identity.stationId, agentId: "agent000000001", payloadHash: payload.payloadHash, expiresAt: new Date(Date.now() + 9000).toISOString(), stationGeneration: 1, systemGeneration: 1, coordinatorGeneration: 1 };
    if (operation === "start") return { attemptId: payload.attemptId, started: true, reportUntil: "" };
    if (operation === "outcome") return { attemptId: payload.attemptId, outcome: payload.outcome };
    throw new Error(`unexpected ${operation}`);
  } };
  const printer = new SimulatedNiimbotPrinter(identity.printerIdentity, async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  const agent = new AgentRuntime(identity, journal, transport);
  const payload = { purpose: "initial" as const, text: { name: "Ана O’Neill", affiliation: "WTS" }, profile: { printerRef: identity.printerIdentity, stockRef: "stock", raster: { width: 600, height: 360 } }, rendererVersion: "renderer-v1", fontVersion: "font-v1" };
  const first = { attemptId: "print000000001", profileId: identity.profileId, payloadHash: printPayloadHash(identity.profileId, payload), payload };
  const secondPayload = { ...payload, text: { name: "Bojan", affiliation: "WTS" } };
  const second = { attemptId: "print000000002", profileId: identity.profileId, payloadHash: printPayloadHash(identity.profileId, secondPayload), payload: secondPayload };
  await expect(Promise.all([agent.process(first, printer), agent.process(second, printer)])).resolves.toEqual(["protocol_complete", "protocol_complete"]);
  expect(printer.printed).toHaveLength(2);
  expect(calls.filter((operation) => operation === "start")).toHaveLength(2);
  await expect(agent.process({ ...first, payload: { ...payload, text: { name: "Changed", affiliation: "WTS" } } }, printer)).rejects.toThrow("payload_hash_mismatch");
  journal.close();
});

it("turns a simulated printer failure into durable output uncertainty without a replay", async () => {
  const file = path(); AgentJournal.provision(file, identity); const journal = new AgentJournal(file, identity);
  const transport = { async request(operation: Operation, payload: Record<string, unknown>): Promise<unknown> {
    if (operation === "authorize") return { attemptId: payload.attemptId, stationId: identity.stationId, agentId: "agent000000001", payloadHash: payload.payloadHash, expiresAt: new Date(Date.now() + 9000).toISOString(), stationGeneration: 1, systemGeneration: 1, coordinatorGeneration: 1 };
    if (operation === "start") return { attemptId: payload.attemptId, started: true, reportUntil: "" };
    if (operation === "outcome") return { attemptId: payload.attemptId, outcome: payload.outcome };
    throw new Error(`unexpected ${operation}`);
  } };
  const printer: NiimbotPrinter = { printerIdentity: identity.printerIdentity, print: async () => { throw new Error("simulated disconnect"); } };
  const agent = new AgentRuntime(identity, journal, transport);
  const payload = { purpose: "initial" as const, text: { name: "Ana", affiliation: "" }, profile: { printerRef: identity.printerIdentity }, rendererVersion: "renderer-v1", fontVersion: "font-v1" };
  const work = { attemptId: "print000000003", profileId: identity.profileId, payloadHash: printPayloadHash(identity.profileId, payload), payload };
  await expect(agent.process(work, printer)).resolves.toBe("output_uncertain");
  await expect(agent.process(work, printer)).resolves.toBe("output_uncertain");
  expect(journal.get(work.attemptId)).toMatchObject({ state: "reported", outcome: "output_uncertain" });
  journal.close();
});

it("keeps raster preparation failures before the authorization boundary", async () => {
  const file = path(); AgentJournal.provision(file, identity); const journal = new AgentJournal(file, identity);
  const calls: Operation[] = [];
  const transport = { async request(operation: Operation): Promise<unknown> { calls.push(operation); throw new Error(`unexpected ${operation}`); } };
  const printer: NiimbotPrinter = {
    printerIdentity: identity.printerIdentity,
    prepare: async () => { throw new AgentError("invalid_profile"); },
    print: async () => undefined,
  };
  const agent = new AgentRuntime(identity, journal, transport);
  const payload = { purpose: "initial" as const, text: { name: "Ana", affiliation: "" }, profile: { printerRef: identity.printerIdentity }, rendererVersion: "renderer-v1", fontVersion: "font-v1" };
  const work = { attemptId: "print000000006", profileId: identity.profileId, payloadHash: printPayloadHash(identity.profileId, payload), payload };
  await expect(agent.process(work, printer)).rejects.toThrow("invalid_profile");
  expect(calls).toEqual([]);
  expect(journal.get(work.attemptId)).toMatchObject({ state: "received" });
  journal.close();
});

it("routes a physical print through the configured stable serial printer and frozen PNG payload", async () => {
  const calls: { address: string; model: string; density: number; labelType: number; pngBase64: string }[] = [];
  const printer = new NiimbotSerialPrinter(identity.printerIdentity, {
    address: "/dev/serial/by-id/usb-NIIMBOT_B1_LABEL_PRINTER_test-if00",
    driver: { print: async (request) => { calls.push(request); } },
  });
  const payload = {
    purpose: "initial" as const,
    text: { name: "Ana", affiliation: "WTS" },
    profile: { id: "testprofile0000", stationId: identity.stationId, version: 1, approval: "approved" as const, config: { rendererVersion: LABEL_RENDERER_VERSION, fontVersion: LABEL_FONT_VERSION, printerRef: identity.printerIdentity, stockRef: "stock", synthetic: false, media: { widthMm: 50 as const, heightMm: 30 as const, kind: "precut-gap" as const }, raster: { width: 600, height: 360 }, printable: { x: 12, y: 12, width: 576, height: 336 }, margins: { top: 24, right: 18, bottom: 24, left: 18 }, offset: { x: 0, y: 0 }, direction: 0 as const, feed: { mode: "gap" as const, gapDots: 24, advanceDots: 0 }, density: 5, threshold: 160 } },
    rendererVersion: LABEL_RENDERER_VERSION,
    fontVersion: LABEL_FONT_VERSION,
    pngBase64: "iVBORw0KGgoAAAANSUhEUg==",
  };
  await printer.print("print000000004", payload);
  expect(calls).toEqual([{
    address: "/dev/serial/by-id/usb-NIIMBOT_B1_LABEL_PRINTER_test-if00",
    model: "B1",
    density: 5,
    labelType: 1,
    printDirection: "top",
    debug: false,
    pngBase64: payload.pngBase64,
  }]);
  await printer.print("print000000005", { ...payload, pngBase64: undefined });
  expect(calls).toHaveLength(2);
  expect(calls[1].pngBase64).toMatch(/^iVBORw0KGgo/);
  expect(calls[1].pngBase64).not.toBe(payload.pngBase64);
});
