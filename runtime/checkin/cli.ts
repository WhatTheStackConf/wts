import { readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import PocketBase from "pocketbase";
import { Coordinator } from "./coordinator.js";
import { createAdmissionProcessorFromEnvironment } from "./admission.js";
import { AgentJournal } from "./journal.js";
import { AgentRuntime, HttpAgentTransport, reportJournalFailure } from "./agent.js";
import { AgentError, journalFailureState, object, safeUrl, validIdentity } from "./protocol.js";

function privateFile(path: unknown): string {
  if (typeof path !== "string") throw new AgentError("invalid_config");
  try {
    const stat = statSync(path);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 16384) throw new Error();
    return readFileSync(path, "utf8");
  } catch { throw new AgentError("invalid_config"); }
}
function configFile(path: unknown) {
  try { return object(JSON.parse(privateFile(path))); } catch { throw new AgentError("invalid_config"); }
}
function text(value: unknown): string { if (typeof value !== "string" || !value) throw new AgentError("invalid_config"); return value; }
function bounded(value: unknown, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new AgentError("invalid_config");
  return Number(value);
}
/** Supervised entrypoint: paths only in argv, no dotenv or browser/public settings. */
export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (argv.length !== 2 || !["coordinator", "agent", "init-agent"].includes(argv[0])) throw new AgentError("invalid_config");
  const [mode, path] = argv; const config = configFile(path);
  if (mode === "init-agent") { AgentJournal.provision(text(config.journalPath), validIdentity(config.identity)); console.log("journal_initialized"); return; }
  let stopped = false;
  let wake: (() => void) | undefined;
  const stop = () => { stopped = true; wake?.(); };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  const pause = (ms: number) => new Promise<void>(resolve => { const timer = setTimeout(() => { wake = undefined; resolve(); }, ms); wake = () => { clearTimeout(timer); wake = undefined; resolve(); }; });
  try {
    if (mode === "coordinator") {
      const url = safeUrl(text(config.pocketbaseUrl));
      const credentials = configFile(config.superuserCredentialFile);
      const pb = new PocketBase(url.href); pb.autoCancellation(false);
      pb.beforeSend = (url, options) => ({ url, options: { ...options, redirect: "error", signal: AbortSignal.timeout(5000) } });
      try { await pb.collection("_superusers").authWithPassword(text(credentials.email), text(credentials.password)); }
      catch { throw new AgentError("coordinator_unavailable"); }
      const interval = bounded(config.heartbeatIntervalMs, 5000, 100, 60000);
      const coordinator = new Coordinator(pb, { heartbeatIntervalMs: interval, heartbeatTimeoutMs: bounded(config.heartbeatTimeoutMs, 15000, interval + 1, 180000), authorizationTtlMs: bounded(config.authorizationTtlMs, 10000, 100, 10000) });
      // HTTP only on loopback; external agents require an HTTPS reverse proxy.
      const host = config.host ?? "127.0.0.1";
      if (host !== "127.0.0.1" && host !== "::1") throw new AgentError("invalid_config");
      const urlBound = await coordinator.listen(host, bounded(config.port, 8787, 0, 65535));
      console.log(JSON.stringify({ category: "coordinator_ready", port: Number(new URL(urlBound).port) }));
      const admission = createAdmissionProcessorFromEnvironment();
      try {
        while (!stopped) {
          await pause(interval);
          if (stopped) break;
          await coordinator.pulse();
          if (admission) {
            try { await coordinator.processAdmissions(admission); }
            catch { /* Keep the supervisor heartbeat alive; the durable boundary remains for review. */ }
          }
        }
      }
      finally { await coordinator.close(); pb.authStore.clear(); }
      return;
    }
    // Never load PocketBase credentials on a Pi. Unknown config keys fail closed.
    if (Object.keys(config).some(k => !["identity", "journalPath", "coordinatorUrl", "agentCredentialFile", "once", "pollIntervalMs"].includes(k))) throw new AgentError("invalid_config");
    const identity = validIdentity(config.identity);
    const transport = new HttpAgentTransport(text(config.coordinatorUrl), privateFile(config.agentCredentialFile).trim());
    let journal: AgentJournal;
    try { journal = new AgentJournal(text(config.journalPath), identity); }
    catch (error) {
      const state = journalFailureState(error);
      await reportJournalFailure(identity, transport, state); throw new AgentError(`journal_${state}`);
    }
    const agent = new AgentRuntime(identity, journal, transport);
    const interval = bounded(config.pollIntervalMs, 5000, 100, 60000);
    try {
      do {
        const heartbeat = await agent.heartbeat();
        // Durable receipt only: intentionally no automatic authorize/start/output.
        if (heartbeat.station.readyForAuthorization) await agent.work();
        console.log("agent_heartbeat_ok");
        if (config.once === true) break;
        await pause(interval);
      } while (!stopped);
    } finally { journal.close(); }
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
