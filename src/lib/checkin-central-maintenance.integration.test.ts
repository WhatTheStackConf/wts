import { expect, it } from "vite-plus/test";
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { startCheckinPocketBase } from "./checkin-pocketbase-test-helper";
import { CheckinAgentService } from "./checkin-agent-service";
import { CheckinLifecycleService } from "./checkin-lifecycle-service";
import { CheckinMonitoringWorker } from "./checkin-monitoring-worker";

const entry = join(process.cwd(), ".output/checkin-runtime/runtime/checkin/cli.js");
function launch(mode: string, path: string) {
  const child = spawn(process.execPath, [entry, mode, path], { stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", b => { output += b; }); child.stderr.on("data", b => { output += b; });
  const exited = new Promise<number | null>(resolve => child.once("exit", code => resolve(code)));
  return { child, exited, output: () => output };
}
async function until(check: () => boolean) { for (let n = 0; n < 200; n++) { if (check()) return; await new Promise(r => setTimeout(r, 25)); } throw new Error("runtime did not become ready"); }

it("runs compiled independent maintenance without a producer, keeps closed gateway read-only, and compacts fixed-deadline purge", { timeout: 60000 }, async () => {
  // pnpm test builds once before parallel tests; never rewrite a live CLI module.
  expect(spawnSync(join(process.cwd(), "node_modules/.bin/tsc"), ["-p", "tsconfig.checkin-runtime.json", "--noEmit"], { encoding: "utf8" }).status).toBe(0);
  const f = await startCheckinPocketBase(); let coordinator: ReturnType<typeof launch> | undefined;
  try {
    const admin = await f.user("admin");
    const credentials = join(f.root, "credentials.json");
    writeFileSync(credentials, JSON.stringify({ email: "root-checkin@example.test", password: f.password }), { mode: 0o600 });
    const cfg = (name: string, extra: object) => { const path = join(f.root, name); writeFileSync(path, JSON.stringify({ pocketbaseUrl: f.baseUrl, superuserCredentialFile: credentials, ...extra }), { mode: 0o600 }); return path; };
    const maintenancePath = cfg("maintenance.json", { once: true });
    const before = await f.pb.collection("checkin_coordinator").getOne("wts2026coord000");
    // Start the observation period in the privileged test clock, then exercise
    // expiry using the actual compiled CLI and its normal wall clock.
    await new CheckinMonitoringWorker(f.pb, { now: () => Date.now() - 3600000, readReadiness: async () => (await f.pb.send<any>("/api/wts/checkin-agents", { method: "POST", body: { operation: "machine_monitoring_readiness" } })).stations }).observe();
    const run = launch("maintenance", maintenancePath); expect(await run.exited).toBe(0); expect(run.output()).toContain("maintenance_tick_ok");
    const incidents = await f.pb.collection("checkin_monitoring_incidents").getFullList();
    expect(incidents).toHaveLength(3); expect(incidents.every(i => i.category === "station_unavailable" && i.opened_ms > 0)).toBe(true);
    const read = () => f.pb.send<any>("/api/wts/checkin-agents", { method: "POST", body: { operation: "machine_monitoring_readiness", nowMs: 0 } });
    const snapshot = await read(); expect(snapshot.stations).toHaveLength(3); expect(snapshot.stations.every((s: any) => s.coordinator === "unavailable")).toBe(true);
    expect(await f.pb.collection("checkin_coordinator").getOne("wts2026coord000")).toEqual(before);
    const deliveries = await f.pb.collection("checkin_monitoring_deliveries").getFullList();
    expect(deliveries).toHaveLength(3); expect(deliveries.every(d => d.state === "pending" && !d.send_started && !d.claim_token)).toBe(true);
    await expect(admin.client.send("/api/wts/checkin-agents", { method: "POST", body: { operation: "machine_monitoring_readiness" } })).rejects.toMatchObject({ status: 403 });

    // Explicitly configure the station through its supported command if default
    // printer identity is unconfigured.
    const station = await f.pb.collection("checkin_stations").getOne("wts2026station1");
    const { CheckinService } = await import("./checkin-service");
    await new CheckinService(f.pb, admin.actor).adminControl({ operation: "configure_station", operationId: crypto.randomUUID(), stationId: "wts2026station1", expectedVersion: station.version, label: "Test", location: "Test", printerRef: "test-printer", reason: "configuration" });
    const credential = (await new CheckinAgentService(f.pb, admin.actor).issue({ operationId: crypto.randomUUID(), stationId: "wts2026station1", expectedStationVersion: station.version + 1, reason: "configuration", note: "Synthetic no physical device", agentIdentity: "test-pi", printerIdentity: "test-printer", journalIdentity: "test-journal", profileId: "", credentialLifetimeHours: 1 })).credential!;
    coordinator = launch("coordinator", cfg("coordinator.json", { port: 0, heartbeatIntervalMs: 100, pollIntervalMs: 100 }));
    await until(() => coordinator!.output().includes("coordinator_ready"));
    const port = JSON.parse(coordinator.output().split("\n").find(s => s.startsWith("{"))!).port;
    const lifecycle = new CheckinLifecycleService(f.pb, admin.actor); const closed = await lifecycle.close({ operationId: crypto.randomUUID(), confirmEdition: "WTS2026" });
    await until(() => coordinator!.output().includes("coordinator_reporting_only"));
    const gateway = (operation: string) => fetch(`http://127.0.0.1:${port}/v1/agent`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential}` }, body: JSON.stringify({ operation, payload: { stationId: "wts2026station1" } }) });
    expect((await gateway("status")).status).toBe(200); expect((await gateway("work")).status).toBe(503);
    const retired = await f.pb.collection("checkin_coordinator").getOne("wts2026coord000"); expect(retired.owner).toBe("");
    coordinator.child.kill("SIGTERM"); expect(await coordinator.exited).toBe(0); coordinator = undefined;
    coordinator = launch("coordinator", cfg("closed.json", { port: 0 })); await until(() => coordinator!.output().includes("coordinator_reporting_only"));
    expect(await f.pb.collection("checkin_coordinator").getOne("wts2026coord000")).toEqual(retired);
    // Clock injection stays at the existing privileged worker hook. Closure itself
    // uses the real admin hook and its immutable 30-day deadline.
    const beforeDeadline = await f.pb.send<any>("/api/wts/checkin-lifecycle-worker", { method: "POST", body: { operation: "tick", nowMs: Date.parse(closed.purgeDeadline!) - 1 } }); expect(beforeDeadline.centralDeletedAt).toBeNull();
    const atDeadline = await f.pb.send<any>("/api/wts/checkin-lifecycle-worker", { method: "POST", body: { operation: "tick", nowMs: Date.parse(closed.purgeDeadline!) } }); expect(atDeadline.centralDeletedAt).toBe(closed.purgeDeadline);
    const compact = launch("maintenance", maintenancePath); expect(await compact.exited).toBe(0);
    const final = await lifecycle.status(); expect(final.centralCompactedAt).not.toBeNull(); expect(final.purgeDeadline).toBe(closed.purgeDeadline);
    expect(await f.pb.collection("checkin_agent_attempts").getFullList()).toHaveLength(0);
  } finally { if (coordinator) { coordinator.child.kill("SIGTERM"); await coordinator.exited; } await f.cleanup(); }
});
