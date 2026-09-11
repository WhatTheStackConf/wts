import { For, Show, createSignal, onSettled } from "solid-js";
import { createAsyncResource } from "~/lib/async-resource";
import type { AgentReadinessDTO } from "~/lib/checkin-agent-contract";
import type { MonitoringDashboard, MonitoringIncident, MonitoringConfigureCommand } from "~/lib/checkin-monitoring-contract";
import { monitoringDashboard, configureMonitoring, acknowledgeMonitoring, CheckinMonitoringRequestError } from "~/lib/checkin-monitoring-client";

const category: Record<MonitoringIncident["category"], string> = { station_unavailable: "Station unavailable", work_stalled: "Waiting work", admission_uncertain: "Admission uncertain — admin investigation required", output_uncertain: "Physical output uncertain — inspect at the owning station; do not reprint automatically" };
const action: Record<MonitoringIncident["nextAction"], string> = { configure_recipients: "Ask an admin to designate notification recipients.", investigate_delivery_no_retry: "Email may have been sent. Investigate delivery; automatic retry is blocked.", await_worker: "Email pending; waiting for the monitoring worker.", none: "No further notification action.", wait_for_repeat: "Unresolved incidents may notify again only at the permitted repeat time." };
function time(ms: number) { return ms ? new Date(ms).toISOString() : "Not yet"; }
function safeError(error: unknown) { return error instanceof CheckinMonitoringRequestError ? error.message : "Monitoring unavailable. Refresh or retry the same action."; }
export interface CheckinMonitoringViewProps {
  dashboard: MonitoringDashboard;
  readiness: AgentReadinessDTO[];
  onAcknowledge: (id: string) => void;
  acknowledging?: string;
  nowMs?: number;
}
/** Pure display seam. Never derives or changes operational readiness. */
export function CheckinMonitoringView(props: CheckinMonitoringViewProps) {
  return <div class="space-y-4 min-w-0 break-words">
    <p>Acknowledgement records that you saw an incident. It does not resolve admission, declare output, enable a station, or send another label.</p>
    <Show when={!props.dashboard.recipientsConfigured}><p role="status" class="alert alert-warning">No designated admin recipients. Email notifications cannot be delivered; there is no fallback to all admins.</p></Show>
    <p>Monitoring last observed: {time(props.dashboard.lastTickMs)}</p>
    <Show when={!props.dashboard.lastTickMs || (props.nowMs !== undefined && props.nowMs - props.dashboard.lastTickMs > 15000)}><p role="status" class="alert alert-warning">Monitoring observations are missing or delayed. Use authoritative agent readiness; an empty incident list does not prove readiness.</p></Show>
    <Show when={props.dashboard.scope === "unbound"}><p>Provision this device to see its station incidents.</p></Show>
    <ul aria-label="Authoritative station readiness"><For each={props.readiness.filter((s) => props.dashboard.scope === "all" || props.dashboard.scope === s.stationId)}>{(s) => <li class="border rounded p-3">{s.stationLabel}: {s.readyForAuthorization ? "Ready for authorization" : "Not ready for authorization"}. Connection: {s.connection}; compatibility: {s.compatibility}; profile: {s.profile}; journal: {s.journal}; coordinator: {s.coordinator}; stopped: {s.stopped ? "yes" : "no"}. Heartbeat {s.heartbeatIntervalMs / 1000}s; unready after {s.heartbeatTimeoutMs / 1000}s; authorization expires within {s.authorizationTtlMs / 1000}s.</li>}</For></ul>
    <Show when={props.dashboard.incidents.length} fallback={<p>No incidents on this page. This does not certify station readiness.</p>}>
      <ul aria-label="Monitoring incidents" class="space-y-3"><For each={props.dashboard.incidents}>{(i) => <li class="border rounded p-4 space-y-2">
        <h3 class="font-bold">{category[i.category]}</h3><p>Station: {i.stationId} · Incident: {i.id}<Show when={i.workflowId}> · Workflow: {i.workflowId}</Show></p>
        <p>{i.recoveredMs ? "Recovered" : i.openedMs ? "Open incident" : "Waiting warning"} · Since: {time(i.sinceMs)} · Recovery: {time(i.recoveredMs)}</p>
        <p>Email delivery: {i.delivery} · Notification: {i.deliveryKind || "none"} · Next permitted delivery: {time(i.nextDeliveryMs)}</p>
        <p>{action[i.nextAction]}</p>
        <Show when={!i.acknowledgedMs} fallback={<p>Acknowledged: {time(i.acknowledgedMs)}. Operational state is unchanged.</p>}><button type="button" class="btn min-h-11" disabled={props.acknowledging === i.id} onClick={() => props.onAcknowledge(i.id)}>Acknowledge incident {i.id}</button></Show>
      </li>}</For></ul>
    </Show>
  </div>;
}
export interface MonitoringClient {
  dashboard: typeof monitoringDashboard;
  configure: typeof configureMonitoring;
  acknowledge: typeof acknowledgeMonitoring;
}
const defaultClient: MonitoringClient = { dashboard: monitoringDashboard, configure: configureMonitoring, acknowledge: acknowledgeMonitoring };
interface ConfigProps { dashboard: MonitoringDashboard; client: MonitoringClient; onSaved: () => void; onCancel: () => void; reload: () => Promise<MonitoringDashboard | undefined> }
function MonitoringConfiguration(props: ConfigProps) {
  const [selected, setSelected] = createSignal([...props.dashboard.config!.recipientUserIds]);
  const [waiting, setWaiting] = createSignal(props.dashboard.config!.waitingMs / 1000);
  const [incident, setIncident] = createSignal(props.dashboard.config!.incidentMs / 1000);
  const [repeat, setRepeat] = createSignal(props.dashboard.config!.repeatMs / 60000);
  const [pending, setPending] = createSignal<MonitoringConfigureCommand>();
  const [snapshot, setSnapshot] = createSignal(props.dashboard);
  const [conflict, setConflict] = createSignal(false);
  const [reloading, setReloading] = createSignal(false);
  const [busy, setBusy] = createSignal(false); const [message, setMessage] = createSignal("");
  async function reload() {
    if (busy() || pending() || reloading()) return;
    setReloading(true);
    try {
      const fresh = await props.reload();
      if (!fresh?.config || fresh.scope !== "all") throw new Error();
      setSnapshot(fresh); setSelected([...fresh.config.recipientUserIds]);
      setWaiting(fresh.config.waitingMs / 1000); setIncident(fresh.config.incidentMs / 1000); setRepeat(fresh.config.repeatMs / 60000);
      setConflict(false); setMessage("Latest configuration loaded. Review before saving a new action.");
    } catch (e) { setMessage(safeError(e)); }
    finally { setReloading(false); }
  }
  async function save() {
    if (busy() || conflict() || reloading()) return;
    const retrying = !!pending();
    const command = pending() || { operationId: crypto.randomUUID(), expectedVersion: snapshot().config!.version, recipientUserIds: [...selected()], waitingMs: waiting() * 1000, incidentMs: incident() * 1000, repeatMs: repeat() * 60000 };
    setPending(command); setBusy(true); setMessage("");
    try { await props.client.configure(command); setPending(undefined); setMessage("Notification configuration saved."); props.onSaved(); }
    catch (e) {
      setMessage(safeError(e));
      // A later rejection cannot resolve an earlier possibly committed attempt.
      if (!retrying && e instanceof CheckinMonitoringRequestError && !e.ambiguous && (e.status === 409 || e.status === 400)) {
        setPending(undefined); setConflict(true);
      }
    }
    finally { setBusy(false); }
  }
  return <form class="space-y-3 border rounded p-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
    <h3 class="font-bold">Designated admin notifications</h3>
    <p>Only selected, currently verified admins receive email. Selecting nobody disables email and leaves a visible warning.</p>
    <fieldset disabled={busy() || !!pending() || conflict() || reloading()} class="space-y-3">
      <legend>Notification recipients and thresholds</legend>
      <For each={snapshot().adminChoices}>{(admin) => <label class="flex items-center gap-3 min-h-11 break-all"><input type="checkbox" class="checkbox" checked={selected().includes(admin.id)} onChange={(e) => setSelected((ids) => e.currentTarget.checked ? [...ids, admin.id] : ids.filter((id) => id !== admin.id))} />{admin.email}</label>}</For>
      <label class="block">Waiting warning (seconds)<input class="input w-full" type="number" required min="1" max="3600" step="1" value={waiting()} onInput={(e) => setWaiting(e.currentTarget.valueAsNumber)} /></label>
      <label class="block">Email incident threshold (seconds)<input class="input w-full" type="number" required min={waiting()} max="3600" step="1" value={incident()} onInput={(e) => setIncident(e.currentTarget.valueAsNumber)} /></label>
      <label class="block">Unresolved repeat interval (minutes; minimum 15)<input class="input w-full" type="number" required min="15" max="1440" step="1" value={repeat()} onInput={(e) => setRepeat(e.currentTarget.valueAsNumber)} /></label>
    </fieldset>
    <Show when={pending()}><p role="status">Submitted configuration is frozen. Retry the exact command to resolve its outcome; refreshing observations does not resolve it.</p></Show>
    <Show when={conflict()}><p role="alert">Configuration rejected. Discard and reload the latest configuration before a new action, or cancel.</p></Show>
    <button class="btn min-h-11" type="submit" disabled={busy() || conflict() || reloading()}>{pending() ? "Retry same notification configuration" : "Save notification configuration"}</button>
    <button class="btn min-h-11" type="button" disabled={busy() || !!pending() || reloading()} onClick={() => void reload()}>Discard edits and reload configuration</button>
    <button class="btn min-h-11" type="button" disabled={busy() || !!pending() || reloading()} onClick={() => props.onCancel()}>Cancel notification editing</button>
    <p role="status">{message()}</p>
  </form>;
}
export interface CheckinMonitoringPanelProps {
  /** Parent passes its existing authority projection; no independent readiness clock. */
  readiness: AgentReadinessDTO[];
  audience: "admin" | "operator";
  /** Explicit transport seam for focused browser interaction tests. */
  client?: MonitoringClient;
}
export function CheckinMonitoringPanel(props: CheckinMonitoringPanelProps) {
  const [mounted, setMounted] = createSignal(false); const [offset, setOffset] = createSignal(0);
  const [now, setNow] = createSignal(0); const [acknowledging, setAcknowledging] = createSignal(""); const [message, setMessage] = createSignal("");
  const [editor, setEditor] = createSignal<MonitoringDashboard>();
  const editing = () => !!editor();
  const client = props.client ?? defaultClient;
  const [dashboard, dashboardActions] = createAsyncResource(() => mounted() && { audience: props.audience, offset: offset() }, async (query) => client.dashboard(query.audience, query.offset));
  onSettled(() => { setNow(Date.now()); setMounted(true); const refresh = () => { setNow(Date.now()); if (!document.hidden && !dashboard.loading && !editing()) void dashboardActions.refetch().catch(() => undefined); }; const timer = setInterval(refresh, 5000); window.addEventListener("focus", refresh); return () => { clearInterval(timer); window.removeEventListener("focus", refresh); }; });
  async function acknowledge(id: string) {
    if (acknowledging()) return; setAcknowledging(id); setMessage("");
    try { await client.acknowledge(id); setMessage("Incident acknowledged. Operational state is unchanged."); void dashboardActions.refetch().catch(() => undefined); }
    catch (e) { setMessage(safeError(e)); } finally { setAcknowledging(""); }
  }
  return <section aria-label="Check-in monitoring" class="space-y-4 min-w-0">
    <h2 class="text-xl font-bold">Check-in monitoring</h2>
    <p role="status">{message()}</p>
    <Show when={dashboard.error}><p role="alert">{safeError(dashboard.error)}</p></Show>
    <button class="btn min-h-11" type="button" disabled={dashboard.loading} onClick={() => void dashboardActions.refetch().catch(() => undefined)}>Refresh monitoring</button>
    <Show when={!dashboard.error && dashboard()} fallback={<p>Monitoring is not available yet. Do not infer operational readiness.</p>}>{(data) => <>
      <CheckinMonitoringView dashboard={data()} readiness={props.readiness} acknowledging={acknowledging()} onAcknowledge={(id) => void acknowledge(id)} nowMs={now()} />
      <nav aria-label="Incident pages" class="flex flex-wrap gap-2"><button class="btn min-h-11" type="button" disabled={offset() === 0 || dashboard.loading || editing()} onClick={() => setOffset((n) => Math.max(0, n - 100))}>Previous incidents</button><button class="btn min-h-11" type="button" disabled={!data().hasMore || dashboard.loading || editing()} onClick={() => setOffset((n) => n + 100)}>Next incidents</button></nav>
      <Show when={props.audience === "admin" && data().scope === "all"}>
        <button class="btn min-h-11" type="button" disabled={editing()} onClick={() => setEditor(structuredClone(data()))}>Edit notification configuration</button>
        <details><summary class="min-h-11">Recent monitoring audit (up to 100 entries)</summary><ul><For each={data().audit}>{(entry) => <li>{time(entry.atMs)} · {entry.category} · Incident: {entry.incidentId || "none"} · Delivery: {entry.deliveryId || "none"} · Actor: {entry.actorUserId || "worker"}</li>}</For></ul></details>
      </Show>
    </>}</Show>
    {/* Editor lifetime is independent of dashboard reads and acknowledgement. */}
    <Show when={editor()}>{(snapshot) => <MonitoringConfiguration dashboard={snapshot()} client={client} reload={() => dashboardActions.refetch()} onCancel={() => setEditor(undefined)} onSaved={() => { setEditor(undefined); setMessage("Notification configuration saved."); void dashboardActions.refetch().catch(() => undefined); }} />}</Show>
  </section>;
}
export function CheckinOperatorMonitoring(props: { readiness: AgentReadinessDTO[] }) { return <CheckinMonitoringPanel audience="operator" readiness={props.readiness} />; }
export function CheckinAdminMonitoring(props: { readiness: AgentReadinessDTO[] }) { return <CheckinMonitoringPanel audience="admin" readiness={props.readiness} />; }
