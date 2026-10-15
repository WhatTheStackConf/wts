import { fork } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AgentError } from "./protocol.js";
import { loadHostConfiguration, privateHostPath, type HostStation } from "./host-configuration.js";
import { listSerialDevices, resolveSerialDevice, serialDeviceKey, validSerialDeviceSelector } from "./serial-devices.js";
import { readPrivateObject } from "./private-configuration.js";
import { acquireOwnership } from "./host-ownership.js";

function event(station: HostStation, category: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ stationId: station.identity.stationId, printerIdentity: station.identity.printerIdentity, category, ...extra }));
}
/** A worker owns its locks and journal until it actually exits, even if its
 * supervisor dies. IPC disconnect asks it to drain; no replacement starts over it. */
export async function runPrintHost(stations: HostStation[], signal: AbortSignal): Promise<void> {
  const exits = stations.map(station => new Promise<boolean>(resolve => {
    if (signal.aborted) { resolve(true); return; }
    const child = fork(fileURLToPath(import.meta.url), ["worker", station.configFile], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
    event(station, "worker_starting");
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let completed = false;
    const stop = () => {
      child.kill("SIGTERM");
      killTimer ??= setTimeout(() => child.kill("SIGKILL"), 30000);
      killTimer.unref();
    };
    signal.addEventListener("abort", stop, { once: true });
    const finish = (success: boolean) => {
      if (completed) return; completed = true;
      if (killTimer) clearTimeout(killTimer);
      signal.removeEventListener("abort", stop);
      resolve(success);
    };
    // Forward only fixed-category diagnostics, never driver packets or arbitrary
    // exception/config data. Bound buffers when a dependency writes no newline.
    for (const stream of [child.stdout, child.stderr]) {
      let buffer = "";
      stream?.on("data", chunk => {
        buffer += String(chunk);
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
          if (/^[a-z][a-z_]{2,100}$/.test(line)) event(station, line);
        }
        if (buffer.length > 4096) buffer = "";
      });
    }
    child.once("error", () => { event(station, "worker_unavailable"); finish(false); });
    child.once("exit", (code, childSignal) => {
      event(station, signal.aborted ? "worker_stopped" : code === 0 ? "worker_finished" : "worker_blocked", { exitCode: code, signal: childSignal });
      finish(code === 0 || signal.aborted);
    });
    if (signal.aborted) stop();
  }));
  const results = await Promise.all(exits);
  if (results.some(success => !success)) throw new AgentError("host_workers_blocked");
}

async function inspectDevice(path: string): Promise<void> {
  const device = validSerialDeviceSelector(readPrivateObject(privateHostPath(path)));
  await acquireOwnership([`usb:${serialDeviceKey(device)}`], true);
  const { inspectSerialPrinter } = await import("./printer-identification.js");
  console.log(JSON.stringify(await inspectSerialPrinter(device), null, 2));
}
async function runHostWorker(configFile: string): Promise<void> {
  // Not an alternative public unlocked entrypoint: worker main acquires all
  // leases itself. Disconnect drains if the parent disappears unexpectedly.
  if (!process.connected) throw new AgentError("invalid_config");
  const disconnected = () => process.kill(process.pid, "SIGTERM");
  process.once("disconnect", disconnected);
  try {
    const { main } = await import("./cli.js");
    await main(["agent", configFile], { hostWorker: true, lifetimeOwnership: true });
  } finally {
    process.removeListener("disconnect", disconnected);
    if (process.connected) process.disconnect?.();
  }
}
async function checkStations(stations: HostStation[]): Promise<void> {
  const devices = stations.some(station => !station.simulated) ? await listSerialDevices() : [];
  let missing = false;
  for (const station of stations) {
    try {
      const address = station.printerDevice ? resolveSerialDevice(station.printerDevice, devices) : "simulated";
      event(station, "configuration_valid", { address });
    } catch (error) {
      if (!(error instanceof AgentError)) throw error;
      event(station, error.category); missing = true;
    }
  }
  if (missing) throw new AgentError("host_devices_unavailable");
}
async function runHost(stations: HostStation[]): Promise<void> {
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try { await runPrintHost(stations, shutdown.signal); }
  finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
}

export async function printHostMain(argv = process.argv.slice(2)): Promise<void> {
  if (argv.length === 1 && argv[0] === "devices") {
    console.log(JSON.stringify(await listSerialDevices(), null, 2)); return;
  }
  if (argv.length !== 2 || !["check", "run", "worker", "inspect"].includes(argv[0])) throw new AgentError("invalid_config");
  if (argv[0] === "inspect") return inspectDevice(argv[1]);
  if (argv[0] === "worker") return runHostWorker(argv[1]);
  const stations = loadHostConfiguration(argv[1]);
  if (argv[0] === "check") return checkStations(stations);
  await runHost(stations);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  printHostMain().catch(error => {
    console.error(error instanceof AgentError ? error.category : "host_unavailable");
    process.exitCode = error instanceof AgentError ? 78 : 1;
    if (process.connected) process.disconnect?.();
  });
}
