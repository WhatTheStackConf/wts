import { pathToFileURL } from "node:url";
import PocketBase from "pocketbase";
import { Coordinator } from "./coordinator.js";
import { loadCoordinatorProcessors } from "./coordinator-configuration.js";
import { verifyCheckinSchema } from "./schema-readiness.js";
import { runCentralMaintenance } from "./central-maintenance.js";
import { superviseCentralCoordinator } from "./central-coordinator.js";
import { readPrivateFile as privateFile, readPrivateObject as configFile } from "./private-configuration.js";
import { AgentJournal } from "./journal.js";
import { AgentLifecycle } from "./agent-lifecycle.js";
import { AgentRuntime, HttpAgentTransport, reportJournalFailure } from "./agent.js";
import { NiimbotSerialPrinter, SimulatedNiimbotPrinter } from "./printer.js";
import { AgentError, journalFailureState, safeUrl, validIdentity } from "./protocol.js";
function text(value: unknown): string { if (typeof value !== "string" || !value) throw new AgentError("invalid_config"); return value; }
function bounded(value: unknown, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new AgentError("invalid_config");
  return Number(value);
}
/** Supervised entrypoint: paths only in argv, no dotenv or browser/public settings. */
export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (argv.length !== 2 || !["coordinator", "maintenance", "agent", "init-agent"].includes(argv[0])) throw new AgentError("invalid_config");
  const [mode, path] = argv; const config = configFile(path);
  if (mode === "init-agent") { AgentJournal.provision(text(config.journalPath), validIdentity(config.identity)); console.log("journal_initialized"); return; }
  let stopped = false;
  const shutdown = new AbortController();
  let wake: (() => void) | undefined;
  const stop = () => { stopped = true; shutdown.abort(); wake?.(); };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  const pause = (ms: number) => new Promise<void>(resolve => { const timer = setTimeout(() => { wake = undefined; resolve(); }, ms); wake = () => { clearTimeout(timer); wake = undefined; resolve(); }; });
  try {
    if (mode === "maintenance") { await runCentralMaintenance(config, shutdown.signal); return; }
    if (mode === "coordinator") {
      if (Object.keys(config).some(key => !["pocketbaseUrl", "superuserCredentialFile", "admissionCredentialFile", "host", "port", "heartbeatIntervalMs", "heartbeatTimeoutMs", "authorizationTtlMs", "pollIntervalMs"].includes(key))) throw new AgentError("invalid_config");
      const url = safeUrl(text(config.pocketbaseUrl));
      const credentials = configFile(config.superuserCredentialFile);
      const pb = new PocketBase(url.href); pb.autoCancellation(false);
      pb.beforeSend = (url, options) => ({ url, options: { ...options, redirect: "error", signal: AbortSignal.timeout(5000) } });
      try { await pb.collection("_superusers").authWithPassword(text(credentials.email), text(credentials.password)); }
      catch { throw new AgentError("coordinator_unavailable"); }
      await verifyCheckinSchema(pb);
      const { admission, reset } = loadCoordinatorProcessors(config.admissionCredentialFile);
      const interval = bounded(config.heartbeatIntervalMs, 5000, 100, 60000);
      const pollInterval = bounded(config.pollIntervalMs, 250, 100, 60000);
      if (stopped) { pb.authStore.clear(); return; }
      const coordinator = new Coordinator(pb, { heartbeatIntervalMs: interval, heartbeatTimeoutMs: bounded(config.heartbeatTimeoutMs, 15000, interval + 1, 180000), authorizationTtlMs: bounded(config.authorizationTtlMs, 10000, 100, 10000) });
      // HTTP only on loopback; external agents require an HTTPS reverse proxy.
      const host = config.host ?? "127.0.0.1";
      if (host !== "127.0.0.1" && host !== "::1") throw new AgentError("invalid_config");
      let reportingOnly: boolean, urlBound: string;
      try {
        reportingOnly = await coordinator.lifecycleMode() !== "open";
        urlBound = await (reportingOnly ? coordinator.listenReportingOnly(host, bounded(config.port, 8787, 0, 65535)) : coordinator.listen(host, bounded(config.port, 8787, 0, 65535)));
      } catch (error) {
        pb.authStore.clear();
        throw error instanceof AgentError ? error : new AgentError("coordinator_unavailable");
      }
      console.log(JSON.stringify({ category: "coordinator_ready", port: Number(new URL(urlBound).port), admission: admission ? "configured" : "disabled" }));
      try {
        await superviseCentralCoordinator(coordinator, {
          signal: shutdown.signal, heartbeatIntervalMs: interval, pollIntervalMs: pollInterval,
          admission: admission ?? undefined, reset: reset ?? undefined, reportingOnly,
        });
      }
      finally { await coordinator.close(); pb.authStore.clear(); }
      return;
    }
    // Never load PocketBase credentials on a Pi. Unknown config keys fail closed.
    if (Object.keys(config).some(k => !["identity", "journalPath", "coordinatorUrl", "agentCredentialFile", "once", "pollIntervalMs", "printerMode", "printerAddress", "printerDebug"].includes(k))) throw new AgentError("invalid_config");
    const identity = validIdentity(config.identity);
    const transport = new HttpAgentTransport(text(config.coordinatorUrl), privateFile(config.agentCredentialFile).trim());
    const lifecycle = new AgentLifecycle(text(config.journalPath), identity, transport);
    let journal: AgentJournal | undefined;
    let agent: AgentRuntime | undefined;
    const quiesce = async () => { journal?.close(); journal = undefined; agent = undefined; printer = undefined; };
    if (config.printerDebug !== undefined && typeof config.printerDebug !== "boolean") throw new AgentError("invalid_config");
    if (config.printerMode !== undefined && config.printerMode !== "simulated" && config.printerMode !== "serial") throw new AgentError("invalid_config");
    let printer: SimulatedNiimbotPrinter | NiimbotSerialPrinter | undefined;
    const preparePrinter = () => printer ??= config.printerMode === "simulated"
      ? new SimulatedNiimbotPrinter(identity.printerIdentity)
      : config.printerMode === "serial"
        ? new NiimbotSerialPrinter(identity.printerIdentity, { address: text(config.printerAddress), debug: config.printerDebug === true })
        : undefined;
    const interval = bounded(config.pollIntervalMs, 5000, 100, 60000);
    try {
      do {
        const lifecycleMode = await lifecycle.check(quiesce);
        if (lifecycleMode === "retired") {
          if (config.once === true) break;
          await pause(interval); continue;
        }
        if (!journal) {
          try { journal = new AgentJournal(text(config.journalPath), identity); }
          catch (error) {
            const state = journalFailureState(error);
            await reportJournalFailure(identity, transport, state); throw new AgentError(`journal_${state}`);
          }
          agent = new AgentRuntime(identity, journal, transport);
        }
        if (lifecycleMode === "purge_only") {
          try { await agent!.recover(); } catch { console.log("agent_reporting_pending"); }
          console.log("agent_purge_only");
          if (config.once === true) break;
          await pause(interval); continue;
        }
        // Reporting/neutralization survives stops and revoked credentials. Drain
        // durable old outcomes before any heartbeat or fresh-start readiness gate.
        await agent!.recover();
        if (lifecycleMode === "reporting_only") throw new AgentError("request_rejected");
        const heartbeat = await agent!.heartbeat();
        if (heartbeat.station.readyForAuthorization) {
          const work = await agent!.work();
          const attempts = new Map(work.attempts.map(attempt => [attempt.attemptId, attempt]));
          // Authorized attempts no longer appear in server work polling. Only
          // locally proven prestart states may enter process() again.
          for (const record of journal.pending()) if (record.state === "received" || record.state === "authorized") {
            attempts.set(record.attemptId, { attemptId: record.attemptId, profileId: record.profileId, payloadHash: record.payloadHash, ...(record.payload ? { payload: record.payload } : {}) });
          }
          if (attempts.size && !preparePrinter()) throw new AgentError("printer_unconfigured");
          if (printer) for (const attempt of attempts.values()) await agent!.process(attempt, printer);
        }
        console.log("agent_heartbeat_ok");
        if (config.once === true) break;
        await pause(interval);
      } while (!stopped);
    } finally { await quiesce(); }
  } finally { process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof AgentError ? error.category : "runtime_unavailable");
    // A controlled rejection/exhausted retry must not acquire another automatic
    // retry budget through systemd. Unexpected crashes may restart separately.
    process.exitCode = error instanceof AgentError ? 78 : 1;
  });
}
