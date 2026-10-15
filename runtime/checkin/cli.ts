import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import PocketBase from "pocketbase";
import { Coordinator } from "./coordinator.js";
import { installCoordinatorAuthRecovery } from "./coordinator-auth.js";
import { loadCoordinatorProcessors } from "./coordinator-configuration.js";
import { verifyCheckinSchema } from "./schema-readiness.js";
import { runCentralMaintenance } from "./central-maintenance.js";
import { superviseCentralCoordinator } from "./central-coordinator.js";
import { readPrivateFile as privateFile, readPrivateObject as configFile } from "./private-configuration.js";
import { AgentJournal } from "./journal.js";
import { AgentLifecycle } from "./agent-lifecycle.js";
import { AgentRuntime, HttpAgentTransport, reportJournalFailure } from "./agent.js";
import { NiimbotSerialPrinter, SimulatedNiimbotPrinter } from "./printer.js";
import { AgentError, journalFailureState, safeUrl, validIdentity, type AgentIdentity, type Work } from "./protocol.js";
import { runAgentCycles } from "./agent-cycles.js";
import { acquireOwnership } from "./host-ownership.js";
import { validateAgentConfigKeys } from "./host-configuration.js";
import { serialDeviceKey, validSerialDeviceSelector, legacySerialDevice, type SerialDeviceSelector } from "./serial-devices.js";

type Config = Record<string, unknown>;
type StationPrinter = SimulatedNiimbotPrinter | NiimbotSerialPrinter;
interface OwnershipLease { release?: () => Promise<void> }
const COORDINATOR_KEYS = ["pocketbaseUrl", "superuserCredentialFile", "admissionCredentialFile", "host", "port", "heartbeatIntervalMs", "heartbeatTimeoutMs", "authorizationTtlMs", "pollIntervalMs"];

function text(value: unknown): string { if (typeof value !== "string" || !value) throw new AgentError("invalid_config"); return value; }
function validAgentConfigKeys(config: Config) {
  validateAgentConfigKeys(config);
}
function bounded(value: unknown, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new AgentError("invalid_config");
  return Number(value);
}
async function connectCoordinatorPocketBase(config: Config): Promise<PocketBase> {
  const url = safeUrl(text(config.pocketbaseUrl));
  const credentials = configFile(config.superuserCredentialFile);
  const pb = new PocketBase(url.href); pb.autoCancellation(false);
  pb.beforeSend = (url, options) => ({ url, options: { ...options, redirect: "error", signal: AbortSignal.timeout(5000) } });
  installCoordinatorAuthRecovery(pb, () => pb.collection("_superusers").authWithPassword(text(credentials.email), text(credentials.password)));
  try { await pb.collection("_superusers").authWithPassword(text(credentials.email), text(credentials.password)); }
  catch { throw new AgentError("coordinator_unavailable"); }
  await verifyCheckinSchema(pb);
  return pb;
}
async function openCoordinatorGateway(coordinator: Coordinator, config: Config, pb: PocketBase): Promise<{ reportingOnly: boolean; urlBound: string }> {
  // HTTP only on loopback; external agents require an HTTPS reverse proxy.
  const host = config.host ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "::1") throw new AgentError("invalid_config");
  try {
    const reportingOnly = await coordinator.lifecycleMode() !== "open";
    const urlBound = await (reportingOnly ? coordinator.listenReportingOnly(host, bounded(config.port, 8787, 0, 65535)) : coordinator.listen(host, bounded(config.port, 8787, 0, 65535)));
    return { reportingOnly, urlBound };
  } catch (error) {
    pb.authStore.clear();
    throw error instanceof AgentError ? error : new AgentError("coordinator_unavailable");
  }
}
async function runCoordinator(config: Config, signal: AbortSignal): Promise<void> {
  if (Object.keys(config).some(key => !COORDINATOR_KEYS.includes(key))) throw new AgentError("invalid_config");
  const pb = await connectCoordinatorPocketBase(config);
  const { admission, reset } = loadCoordinatorProcessors(config.admissionCredentialFile);
  const interval = bounded(config.heartbeatIntervalMs, 5000, 100, 60000);
  const pollInterval = bounded(config.pollIntervalMs, 250, 100, 60000);
  if (signal.aborted) { pb.authStore.clear(); return; }
  const coordinator = new Coordinator(pb, { heartbeatIntervalMs: interval, heartbeatTimeoutMs: bounded(config.heartbeatTimeoutMs, 15000, interval + 1, 180000), authorizationTtlMs: bounded(config.authorizationTtlMs, 10000, 100, 10000) });
  const { reportingOnly, urlBound } = await openCoordinatorGateway(coordinator, config, pb);
  console.log(JSON.stringify({ category: "coordinator_ready", port: Number(new URL(urlBound).port), admission: admission ? "configured" : "disabled" }));
  try {
    await superviseCentralCoordinator(coordinator, {
      signal, heartbeatIntervalMs: interval, pollIntervalMs: pollInterval,
      admission: admission ?? undefined, reset: reset ?? undefined, reportingOnly,
    });
  }
  finally { await coordinator.close(); pb.authStore.clear(); }
}
async function acquireAgentOwnership(config: Config, identity: AgentIdentity, device: SerialDeviceSelector | undefined, lifetime: boolean): Promise<() => Promise<void>> {
  const root = realpathSync(dirname(resolve(text(config.journalPath))));
  const scope = safeUrl(text(config.coordinatorUrl)).origin;
  const physical = device ?? (config.printerMode === "serial" ? await legacySerialDevice(text(config.printerAddress)) : undefined);
  return acquireOwnership([
    `station:${scope}:${identity.stationId}`, `printer:${scope}:${identity.printerIdentity}`,
    `agent:${scope}:${identity.agentIdentity}`, `journal:${scope}:${identity.journalIdentity}`, `state:${root}`,
    ...(physical ? [`usb:${serialDeviceKey(physical)}`] : []),
  ], lifetime);
}
function resumableAttempts(work: { attempts: Work[] }, journal: AgentJournal): Map<string, Work> {
  const attempts = new Map(work.attempts.map(attempt => [attempt.attemptId, attempt]));
  // Authorized attempts no longer appear in server work polling. Only
  // locally proven prestart states may enter process() again.
  for (const record of journal.pending()) if (record.state === "received" || record.state === "authorized") {
    attempts.set(record.attemptId, { attemptId: record.attemptId, profileId: record.profileId, payloadHash: record.payloadHash, ...(record.payload ? { payload: record.payload } : {}) });
  }
  return attempts;
}
/** One station lane: its journal, runtime and printer open lazily and close together on quiesce. */
class AgentLane {
  private journal: AgentJournal | undefined;
  private agent: AgentRuntime | undefined;
  private printer: StationPrinter | undefined;
  constructor(private readonly config: Config, private readonly identity: AgentIdentity, private readonly transport: HttpAgentTransport, private readonly device: SerialDeviceSelector | undefined, private readonly signal: AbortSignal) {}
  readonly quiesce = async () => { this.journal?.close(); this.journal = undefined; this.agent = undefined; this.printer = undefined; };
  async cycle(lifecycle: AgentLifecycle): Promise<void> {
    const lifecycleMode = await lifecycle.check(this.quiesce);
    if (this.signal.aborted || lifecycleMode === "retired") return;
    const { journal, agent } = await this.open();
    if (lifecycleMode === "purge_only") {
      try { await agent.recover(); } catch { console.log("agent_reporting_pending"); }
      console.log("agent_purge_only");
      return;
    }
    // Reporting/neutralization survives stops and revoked credentials. Drain
    // durable old outcomes before any heartbeat or fresh-start readiness gate.
    await agent.recover();
    if (this.signal.aborted) return;
    if (lifecycleMode === "reporting_only") throw new AgentError("request_rejected");
    await this.serve(journal, agent);
  }
  private async open(): Promise<{ journal: AgentJournal; agent: AgentRuntime }> {
    if (!this.journal) {
      try { this.journal = new AgentJournal(text(this.config.journalPath), this.identity); }
      catch (error) {
        const state = journalFailureState(error);
        await reportJournalFailure(this.identity, this.transport, state); throw new AgentError(`journal_${state}`);
      }
      this.agent = new AgentRuntime(this.identity, this.journal, this.transport);
    }
    return { journal: this.journal, agent: this.agent! };
  }
  private async serve(journal: AgentJournal, agent: AgentRuntime): Promise<void> {
    // A disconnected lane still reconciles outcomes, but must not advertise
    // fresh print readiness. Discovery never opens the physical printer.
    if (this.device) await this.preparePrinter()?.checkReady?.();
    if (this.signal.aborted) return;
    const heartbeat = await agent.heartbeat();
    if (!this.signal.aborted && heartbeat.station.readyForAuthorization) await this.printWork(journal, agent);
    console.log("agent_heartbeat_ok");
  }
  private async printWork(journal: AgentJournal, agent: AgentRuntime): Promise<void> {
    const attempts = resumableAttempts(await agent.work(), journal);
    if (attempts.size && !this.preparePrinter()) throw new AgentError("printer_unconfigured");
    const printer = this.printer;
    if (printer) for (const attempt of attempts.values()) {
      if (this.signal.aborted) break;
      await agent.process(attempt, printer);
    }
  }
  private preparePrinter(): StationPrinter | undefined {
    return this.printer ??= this.config.printerMode === "simulated"
      ? new SimulatedNiimbotPrinter(this.identity.printerIdentity)
      : this.config.printerMode === "serial"
        ? new NiimbotSerialPrinter(this.identity.printerIdentity, { ...(this.device ? { device: this.device, printerSerial: text(this.config.printerSerial) } : { address: text(this.config.printerAddress) }), debug: this.config.printerDebug === true })
        : undefined;
  }
}
async function runAgent(config: Config, options: { hostWorker?: boolean; lifetimeOwnership?: boolean }, signal: AbortSignal, lease: OwnershipLease): Promise<void> {
  // Never load PocketBase credentials on a Pi. Unknown config keys fail closed.
  validAgentConfigKeys(config);
  const identity = validIdentity(config.identity);
  const device = config.printerDevice === undefined ? undefined : validSerialDeviceSelector(config.printerDevice);
  const transport = new HttpAgentTransport(text(config.coordinatorUrl), privateFile(config.agentCredentialFile).trim());
  lease.release = await acquireAgentOwnership(config, identity, device, options.lifetimeOwnership === true);
  const lifecycle = new AgentLifecycle(text(config.journalPath), identity, transport);
  const lane = new AgentLane(config, identity, transport, device, signal);
  if (config.printerDebug !== undefined && typeof config.printerDebug !== "boolean") throw new AgentError("invalid_config");
  if (config.printerMode !== undefined && config.printerMode !== "simulated" && config.printerMode !== "serial") throw new AgentError("invalid_config");
  const interval = bounded(config.pollIntervalMs, 5000, 100, 60000);
  try {
    await runAgentCycles({ signal, intervalMs: interval, reconnect: options.hostWorker === true, once: config.once === true, report: category => console.log(category), cycle: () => lane.cycle(lifecycle) });
  } finally { await lane.quiesce(); }
}
/** Supervised entrypoint: private config paths; only adoption adds a public profile ID. */
export async function main(argv = process.argv.slice(2), options: { hostWorker?: boolean; lifetimeOwnership?: boolean } = {}): Promise<void> {
  if (argv[0] === "adopt-profile" ? argv.length !== 3 : argv.length !== 2 || !["coordinator", "maintenance", "agent", "init-agent"].includes(argv[0])) throw new AgentError("invalid_config");
  const [mode, path] = argv; const config = configFile(path);
  if (mode === "init-agent") { AgentJournal.provision(text(config.journalPath), validIdentity(config.identity)); console.log("journal_initialized"); return; }
  if (mode === "adopt-profile") {
    validAgentConfigKeys(config);
    // Metadata only: no credentials, transport, lifecycle, printer or signal loop.
    console.log(JSON.stringify(AgentJournal.adoptProfile(text(config.journalPath), validIdentity(config.identity), argv[2])));
    return;
  }
  const lease: OwnershipLease = {};
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once("SIGTERM", stop); process.once("SIGINT", stop);

  try {
    if (mode === "maintenance") await runCentralMaintenance(config, shutdown.signal);
    else if (mode === "coordinator") await runCoordinator(config, shutdown.signal);
    else await runAgent(config, options, shutdown.signal, lease);
  } finally { process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop); await lease.release?.(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), { lifetimeOwnership: true }).catch(error => {
    console.error(error instanceof AgentError ? error.category : "runtime_unavailable");
    // A controlled rejection/exhausted retry must not acquire another automatic
    // retry budget through systemd. Unexpected crashes may restart separately.
    process.exitCode = error instanceof AgentError ? 78 : 1;
  });
}
