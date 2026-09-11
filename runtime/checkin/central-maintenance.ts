import PocketBase from "pocketbase";
import { CheckinMonitoringWorker } from "../../src/lib/checkin-monitoring-worker.js";
import { readPrivateObject } from "./private-configuration.js";
import { verifyCheckinSchema } from "./schema-readiness.js";
import { AgentError, safeUrl } from "./protocol.js";
import type { AgentReadinessDTO } from "../../src/lib/checkin-agent-contract.js";

function number(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > max) throw new AgentError("invalid_config");
  return Number(value);
}
export function pause(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms); signal.addEventListener("abort", done, { once: true });
  });
}
/** Central ONLY; never owns, pulses or takes over the producer lease. */
export async function runCentralMaintenance(config: Record<string, unknown>, signal: AbortSignal): Promise<void> {
  if (Object.keys(config).some(key => !["pocketbaseUrl", "superuserCredentialFile", "pollIntervalMs", "deliveryLimit", "once"].includes(key)) || (config.once !== undefined && typeof config.once !== "boolean") || typeof config.pocketbaseUrl !== "string") throw new AgentError("invalid_config");
  const url = safeUrl(config.pocketbaseUrl);
  const interval = number(config.pollIntervalMs, 5000, 60000);
  const deliveryLimit = number(config.deliveryLimit, 10, 100);
  const credentials = readPrivateObject(config.superuserCredentialFile);
  if (Object.keys(credentials).some(key => !["email", "password"].includes(key)) || typeof credentials.email !== "string" || !credentials.email || typeof credentials.password !== "string" || !credentials.password) throw new AgentError("invalid_config");
  const pb = new PocketBase(url.href); pb.autoCancellation(false);
  pb.beforeSend = (url, options) => ({ url, options: { ...options, redirect: "error", signal: AbortSignal.timeout(5000) } });
  try {
    try { await pb.collection("_superusers").authWithPassword(credentials.email, credentials.password); }
    catch { throw new AgentError("coordinator_unavailable"); }
    await verifyCheckinSchema(pb);
    const worker = new CheckinMonitoringWorker(pb, { deliveryLimit, readReadiness: async () => {
      const result = await pb.send<{ stations: AgentReadinessDTO[] }>("/api/wts/checkin-agents", { method: "POST", body: { operation: "machine_monitoring_readiness" }, requestKey: null });
      if (!Array.isArray(result.stations) || result.stations.length !== 3 || new Set(result.stations.map(s => s.stationId)).size !== 3 || result.stations.some(s => !/^wts2026station[123]$/.test(s.stationId) || typeof s.readyForAuthorization !== "boolean")) throw new AgentError("maintenance_failed");
      return result.stations;
    } });
    while (!signal.aborted) {
      let failed = false;
      // Purge must proceed even if observation/delivery fails. All operations are
      // serialized; unknown mail outcomes are never automatically replayed.
      try {
        const lifecycle = await pb.send<{ centralDeletedAt: string | null; centralCompactedAt: string | null }>("/api/wts/checkin-lifecycle-worker", { method: "POST", body: { operation: "tick" }, requestKey: null });
        if (lifecycle.centralDeletedAt && !lifecycle.centralCompactedAt) await pb.send("/api/wts/checkin-lifecycle-worker", { method: "POST", body: { operation: "compact" }, requestKey: null });
        // Retired monitoring tables must remain empty after central deletion.
        if (!lifecycle.centralDeletedAt) {
          try { await worker.observe(); } catch { failed = true; }
          try { await worker.deliver(); } catch { failed = true; }
        }
      } catch { failed = true; }
      if (failed) {
        if (config.once === true) throw new AgentError("maintenance_failed");
        // An observation/mail/backend outage must not cancel future retention
        // deadlines. Delivery keeps its own durable no-replay fence; this retries
        // scheduling, not an uncertain email or an external admission request.
        console.error("maintenance_tick_degraded");
      } else console.log("maintenance_tick_ok");
      if (config.once === true) break;
      await pause(interval, signal);
    }
  } finally { pb.authStore.clear(); }
}
