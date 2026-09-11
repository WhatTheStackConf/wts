import { Show, createSignal, onSettled } from "solid-js";
import { createAsyncResource } from "~/lib/async-resource";
import { agentStatus, CheckinAgentRequestError } from "~/lib/checkin-agent-client";
import type { AgentReadinessDTO } from "~/lib/checkin-agent-contract";

/** Safe status queries only: no overlapping polls, three consecutive failed
 * attempts, bounded backoff, explicit recovery. Mutations never use this loop. */
export function createAgentReadinessResource<S, T>(source: () => S | undefined, fetcher: (source: S) => Promise<T>) {
  const [failures, setFailures] = createSignal(0);
  const [data, actions] = createAsyncResource(source, async (value) => {
    try { const result = await fetcher(value); setFailures(0); return result; }
    catch (error) { setFailures((count) => error instanceof CheckinAgentRequestError && !error.retryable ? 3 : count + 1); throw error; }
  });
  onSettled(() => {
    let timer: number;
    let disposed = false;
    const refreshVisible = () => {
      if (!document.hidden && source() !== undefined && !data.loading && failures() < 3) void actions.refetch().catch(() => undefined);
    };
    const poll = async () => {
      if (disposed) return;
      if (!document.hidden && source() !== undefined && !data.loading && failures() < 3) await actions.refetch().catch(() => undefined);
      if (!disposed) timer = window.setTimeout(() => void poll(), Math.min(30000, 5000 * 2 ** failures()) + Math.floor(Math.random() * 500));
    };
    timer = window.setTimeout(() => void poll(), 5000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      disposed = true; window.clearTimeout(timer);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  });
  async function refresh() {
    if (data.loading) return;
    setFailures(0);
    await actions.refetch().catch(() => undefined);
  }
  return { data, refresh, failures };
}

interface AgentReadinessProps { station: AgentReadinessDTO }
export function AgentReadiness(props: AgentReadinessProps) {
  return (
    <section aria-label="Agent readiness" class="min-w-0 space-y-3 break-words">
      <h3 class="text-lg font-bold">Agent readiness · {props.station.stationLabel}</h3>
      <dl class="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div><dt class="font-bold">Agent connection</dt><dd>{props.station.connection.replaceAll("_", " ")}</dd></div>
        <div><dt class="font-bold">Machine credential</dt><dd>{props.station.credentialState.replaceAll("_", " ")}</dd></div>
        <div><dt class="font-bold">Protocol and identity compatibility</dt><dd>{props.station.compatibility}</dd></div>
        <div><dt class="font-bold">Printer/media profile approval</dt><dd>{props.station.profile}</dd></div>
        <div><dt class="font-bold">Local journal</dt><dd>{props.station.journal}</dd></div>
        <div><dt class="font-bold">Coordinator dependency</dt><dd>{props.station.coordinator}</dd></div>
        <div><dt class="font-bold">Administrative stop</dt><dd><Show when={props.station.stopped} fallback="Not stopped">Stopped — no future starts</Show></dd></div>
        <div><dt class="font-bold">Pre-start protocol gate</dt><dd><Show when={props.station.readyForAuthorization} fallback="Not ready">Compatible for protocol authorization only</Show></dd></div>
      </dl>
      <p class="text-sm">Last valid heartbeat: {props.station.lastHeartbeatAt || "Never"}. Expected interval {props.station.heartbeatIntervalMs / 1000}s; unready after {props.station.heartbeatTimeoutMs / 1000}s. Pre-start authorization expires within {props.station.authorizationTtlMs / 1000}s.</p>
      <Show when={props.station.credentialExpiresAt}><p class="text-sm">Credential expiry: {props.station.credentialExpiresAt}</p></Show>
      <Show when={props.station.reasons.includes("printer_output_unresolved")}><p role="status" class="alert alert-warning">A previously started task has unresolved printer output. New starts remain blocked; reconnecting or restoring the station does not clear physical uncertainty.</p></Show>
      <Show when={props.station.journal === "quarantined"}><p role="status" class="alert alert-warning">Station quarantined. An admin must investigate identity and journal history before issuing a replacement identity. Reconnection does not clear quarantine.</p></Show>
      <p class="font-bold text-warning">Supervised admission and printing require current station readiness. Connection alone is not printer or media approval.</p>
    </section>
  );
}

interface BoundAgentReadinessProps { stationId: string }
export function BoundAgentReadiness(props: BoundAgentReadinessProps) {
  const { data, refresh, failures } = createAgentReadinessResource(() => props.stationId, async (stationId) => {
    const result = await agentStatus();
    // A concurrent rebind must not render another station inside the old shell.
    if (!result.station || result.station.stationId !== stationId) throw new Error("Binding changed");
    return result.station;
  });
  return (
    <section aria-label="Your station agent" class="border-t border-base-content/20 pt-4 space-y-3" aria-busy={data.loading ? "true" : "false"}>
      <Show when={data.error}><p role="alert">Agent readiness could not be verified. Do not rely on previously displayed state. <Show when={failures() >= 3} fallback="Safe status retries are bounded.">Automatic retries stopped; refresh explicitly.</Show></p></Show>
      <Show when={!data.error && !data.loading && data()}>{(station) => <AgentReadiness station={station()} />}</Show>
      <Show when={data.loading}><p role="status">Verifying current agent readiness…</p></Show>
      <button type="button" class="btn btn-outline min-h-12" disabled={data.loading} onClick={() => void refresh()}>Refresh agent readiness</button>
    </section>
  );
}
