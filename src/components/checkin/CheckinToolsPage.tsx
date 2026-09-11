import { For, Show, createEffect, createMemo, createSignal, onCleanup, onSettled } from "solid-js";
import { Meta, Title } from "@solidjs/meta";
import { useAuth } from "~/lib/auth-context";
import { useRequireCheckinOperator } from "~/lib/route-guards";
import { createAsyncResource } from "~/lib/async-resource";
import { bindCheckinStation, checkinStatus, previewCheckinStation } from "~/lib/checkin-client";
import { agentStatus } from "~/lib/checkin-agent-client";
import type { CheckinPreviewDTO } from "~/lib/checkin-contract";
import { provisioningCameraCode } from "~/lib/checkin-camera";
import { cameraHeldReference } from "~/lib/checkin-camera-recovery";
import { readLookupHold } from "~/lib/checkin-lookup-held";
import { CheckinCameraScanner } from "~/components/checkin/checkin-camera-scanner";
import { CheckinOperatorRecovery } from "~/components/checkin/CheckinRecovery";
import { CheckinEventSelector } from "~/components/checkin/CheckinEventSelector";
import { AgentReadiness, createAgentReadinessResource } from "~/components/checkin/AgentReadiness";
import "./checkin-tools.css";

type View = "recent" | "arrivals" | "phone" | "diagnostics";
const views: { id: View; label: string }[] = [
  { id: "recent", label: "Recent work" }, { id: "arrivals", label: "Arrivals" },
  { id: "phone", label: "Phone" }, { id: "diagnostics", label: "Diagnostics" },
];

export default function CheckinToolsPage() {
  const guard = useRequireCheckinOperator(), auth = useAuth();
  const actorKey = createMemo(() => guard.authorized() && guard.user()?.id ? `${guard.user()!.id}:${guard.user()!.role}` : undefined);
  const [statusFailed, setStatusFailed] = createSignal(false);
  const [status, statusActions] = createAsyncResource(actorKey, async actor => {
    try { const value = await checkinStatus(); if (!disposed && actor === actorKey()) setStatusFailed(false); return { ...value, verifiedFor: actor }; }
    catch (error) { if (!disposed && actor === actorKey()) setStatusFailed(true); throw error; }
  });
  // Polling is observation, not a new authority boundary. Retain the mounted
  // command surface; redact on an actual failure or actor/binding fence change.
  const current = () => actorKey() && status()?.verifiedFor === actorKey() ? status() : undefined;
  const unavailable = () => !current() || statusFailed() || !!status.error;
  const scope = createMemo(() => {
    const s = current();
    return s?.bindingState === "bound" && s.binding && !s.binding.revoked && s.station && s.binding.stationId === s.station.id
      ? `${actorKey()}:${s.binding.id}:${s.binding.version}:${s.station.id}` : undefined;
  });
  const machineSource = createMemo(() => !unavailable() && scope() ? `${scope()}:${current()?.station?.version}:${current()?.system.generation}` : undefined);
  const [machineFailed, setMachineFailed] = createSignal(false);
  const { data: machine, refresh: refreshMachine } = createAgentReadinessResource(machineSource, async fence => {
    try {
      const value = await agentStatus();
      if (!value.station || value.station.stationId !== current()?.station?.id) throw new Error("Station changed");
      if (!disposed && fence === machineSource()) setMachineFailed(false);
      return { ...value, fence };
    } catch (error) { if (!disposed && fence === machineSource()) setMachineFailed(true); throw error; }
  });
  const agent = () => !unavailable() && !machineFailed() && !machine.error && machine()?.fence === machineSource() ? machine()?.station : undefined;
  const readiness = () => {
    if (unavailable()) return statusFailed() || status.error ? "Connection lost · verify station" : "Checking station…";
    if (current()?.bindingState === "revoked") return "Phone revoked · ask an admin";
    if (!scope()) return "Pair this phone to a station";
    if (!current()?.system.enabled) return "System stopped";
    if (!current()?.station?.enabled) return "Station disabled";
    if (!agent()) return "Checking printer connection";
    if (agent()?.readyForAuthorization) return "Connected";
    if (agent()?.journal === "quarantined") return "Station needs review";
    if (agent()?.credentialState === "expired") return "Station session expired";
    if (agent()?.profile !== "approved") return "Label profile needs approval";
    if (agent()?.coordinator !== "connected") return "Coordinator offline";
    if (agent()?.connection === "connected") return "Station needs attention";
    return "Printer agent unavailable";
  };
  const [view, setView] = createSignal<View>("recent");
  const [heldNotice, setHeldNotice] = createSignal(false);
  function refreshHeldNotice() {
    if (!scope() || typeof window === "undefined") { setHeldNotice(false); return; }
    const s = current();
    if (!s?.binding || !s.station) return;
    // Keep the dashboard concise without hiding a persisted camera/lookup hold.
    // The explicit review action only opens recovery; it never resends arrival.
    try {
      const cameraScope = `${s.binding.id}:${s.binding.version}:${s.station.id}`;
      setHeldNotice(!!(cameraHeldReference(window.localStorage, cameraScope).read() || readLookupHold()));
    } catch { setHeldNotice(true); }
  }
  createEffect(scope, () => { refreshHeldNotice(); });
  const [eventLabel, setEventLabel] = createSignal("Choose an event");
  const [recoveryBusy, setRecoveryBusy] = createSignal(false);
  const [eventBusy, setEventBusy] = createSignal(false);
  const [pairBusy, setPairBusy] = createSignal(false);
  const [loggingOut, setLoggingOut] = createSignal(false);
  const busy = () => (!!scope() && (recoveryBusy() || eventBusy())) || pairBusy() || loggingOut();
  const [code, setCode] = createSignal("");
  const [preview, setPreview] = createSignal<{ code: string; value: CheckinPreviewDTO }>();
  const [message, setMessage] = createSignal("");
  let disposed = false, setupEpoch = 0, setupInFlight = false, statusInFlight = false;
  onCleanup(() => { disposed = true; setupEpoch++; });
  createEffect(() => `${actorKey()}:${scope()}:${current()?.station?.version}:${current()?.system.generation}:${unavailable()}`, () => {
    setupEpoch++; setPreview(undefined);
  });
  let previousActor = actorKey();
  createEffect(actorKey, actor => {
    if (previousActor !== undefined && actor !== previousActor) { setCode(""); setMessage(""); setEventBusy(false); }
    previousActor = actor;
  });
  async function refreshStatus(force = false) {
    if (!actorKey() || (!force && (statusInFlight || status.loading))) return;
    statusInFlight = true;
    try { await statusActions.refetch(); } catch { /* statusFailed keeps old data unavailable during retry */ }
    finally { statusInFlight = false; }
  }
  onSettled(() => {
    const fragment = window.location.hash;
    if (fragment) {
      window.history.replaceState(window.history.state, "", window.location.pathname);
      setView("phone");
      const match = /^#provision=([a-f0-9]{64})$/.exec(fragment);
      if (match) setCode(match[1]); else setMessage("Invalid provisioning link. Scan the current station QR again.");
    }
    const refresh = () => { if (!document.hidden) void refreshStatus(); };
    const leave = (event: BeforeUnloadEvent) => { if (busy()) { event.preventDefault(); event.returnValue = ""; } };
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    window.addEventListener("beforeunload", leave);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("beforeunload", leave); };
  });
  function changeView(next: View) { if (!busy()) { refreshHeldNotice(); setView(next); } }
  async function review(value: string) {
    if (busy() || setupInFlight || unavailable() || !actorKey()) return;
    if (!/^[a-f0-9]{64}$/.test(value)) { setMessage("Use the 64-character station provisioning code."); return; }
    const epoch = ++setupEpoch, actor = actorKey();
    setupInFlight = true; setPairBusy(true); setPreview(undefined); setMessage("");
    const live = () => !disposed && epoch === setupEpoch && actor === actorKey();
    try { const result = await previewCheckinStation(value); if (live()) setPreview({ code: value, value: result }); }
    catch { if (live()) setMessage("Couldn't read that station. Check the code and try again."); }
    finally { setupInFlight = false; if (!disposed) setPairBusy(false); }
  }
  async function confirm() {
    const chosen = preview();
    if (!chosen || !chosen.value.canBind || busy() || setupInFlight || unavailable()) return;
    const epoch = setupEpoch, actor = actorKey();
    const live = () => !disposed && epoch === setupEpoch && actor === actorKey();
    setupInFlight = true; setPairBusy(true); setMessage("");
    try {
      await bindCheckinStation(chosen.code, chosen.value.confirmation);
      if (live()) { setPreview(undefined); setCode(""); await refreshStatus(true); }
    } catch {
      if (live()) { setPreview(undefined); setMessage("Binding not confirmed. Refresh station status, then review the station again."); await refreshStatus(true); }
    } finally { setupInFlight = false; if (!disposed) setPairBusy(false); }
  }
  async function logout() {
    if (busy()) return;
    setLoggingOut(true);
    try { await auth.logout(); if (!disposed) window.location.assign("/login"); }
    catch { if (!disposed) { setMessage("Couldn't log out. Try again."); setLoggingOut(false); } }
  }
  return <div class="wts-tools-screen">
    <Title>Tools | WTS Check-in</Title><Meta name="robots" content="noindex,nofollow" /><Meta name="referrer" content="no-referrer" />
    <header class="wts-tools-header"><h1>Tools</h1><a role="link" href={busy() ? undefined : "/checkin"} target="_self" class="btn btn-ghost" aria-disabled={busy() ? "true" : "false"} tabindex={busy() ? -1 : 0} onClick={event => { if (busy()) event.preventDefault(); }}>Back to scanner</a></header>
    <div class="wts-tools-context"><strong>{!unavailable() ? current()?.station?.label || "No station paired" : "Station unverified"}</strong><span>{!unavailable() && scope() ? eventLabel() : "Event unverified"}</span></div>
    <div class="wts-tools-status" role="status"><span>{readiness()}</span><Show when={unavailable()}><button type="button" class="btn btn-ghost" disabled={status.loading} onClick={() => void refreshStatus()}>Refresh station status</button></Show><Show when={!unavailable() && scope() && !agent()?.readyForAuthorization}><button type="button" class="btn btn-ghost" disabled={busy()} onClick={() => changeView("diagnostics")}>Details</button></Show></div>
    <nav class="wts-tools-views" aria-label="Tools views"><For each={views}>{item => <button type="button" aria-label={item.label} aria-pressed={view() === item.id ? "true" : "false"} aria-controls={`tools-${item.id}`} disabled={busy() || (item.id === "arrivals" && !scope())} onClick={() => changeView(item.id)}><Show when={item.id === "recent"} fallback={item.label}>Work</Show></button>}</For></nav>
    <main class="wts-tools-main">
      <Show when={!guard.authorized()}><p role="status">Checking sign-in…</p></Show>
      <Show when={message()}><p class="wts-tools-notice" role="alert">{message()}</p><button type="button" class="btn btn-ghost" disabled={pairBusy()} onClick={() => setMessage("")}>Dismiss message</button></Show>
      <Show when={recoveryBusy()}><p role="status" class="wts-tools-notice">Finish or retry the current recovery before leaving this view.</p></Show>
      <section id="tools-recent" hidden={view() !== "recent"} aria-label="Recent work">
        <Show when={!unavailable() && heldNotice()}><div class="wts-tools-held"><p>Review or finish your previous scan.</p><button type="button" class="btn btn-outline" disabled={busy()} onClick={() => changeView("arrivals")}>Review held scan</button></div></Show>
        <Show when={!scope()}><h2>Recent work</h2><p>Pair this phone to view station work.</p><button type="button" class="btn btn-outline" disabled={busy()} onClick={() => changeView("phone")}>Set up phone</button></Show>
        <CheckinOperatorRecovery compact scopeKey={scope()} unavailable={unavailable()} onBusyChange={value => { setRecoveryBusy(value); }} />
      </section>
      <div hidden={view() !== "phone" && view() !== "arrivals"}>
        <For each={actorKey() ? [actorKey()!] : []}>{actor => <CheckinEventSelector compact view={view() === "phone" ? "phone" : "arrivals"} status={current()} authorityKey={actor} verifying={unavailable()} disabled={recoveryBusy() || pairBusy() || loggingOut()} arrivalsActive={view() === "arrivals"} onEventLabelChange={value => { if (actor === actorKey()) setEventLabel(value); }} onBusyChange={value => { if (actor === actorKey()) setEventBusy(value); }} />}</For>
      </div>
      <section id="tools-phone" hidden={view() !== "phone"} aria-label="Pair this phone" class="wts-tools-pair">
        <h2>Pair this phone</h2><p>Scan a station QR, not an attendee ticket. Review the station before confirming.</p>
        <Show when={current()?.bindingState === "revoked"}><p role="alert">This browser binding was revoked. Ask an admin for help; logging in again does not restore it.</p></Show>
        <CheckinCameraScanner compact purpose="station" enabled={view() === "phone" && !busy() && !unavailable() && current()?.bindingState !== "revoked"} held={!!preview() || pairBusy()} scope={!unavailable() ? `${actorKey()}:${scope() ?? "unbound"}` : undefined} onDecode={value => {
          const provision = provisioningCameraCode(value, window.location.origin);
          if (!provision) { setMessage("Not a station provisioning QR for this site. Attendee QRs cannot bind a phone."); return false; }
          setCode(provision); void review(provision);
        }} />
        <details open={!!code()}><summary>Enter station code instead</summary><form onSubmit={event => { event.preventDefault(); void review(code()); }}>
          <label for="station-code">Station provisioning code<span aria-hidden="true"> *</span></label>
          <p id="station-code-help">64 characters: 0–9 and a–f, from the current station QR.</p>
          <input id="station-code" name="code" aria-label="Station provisioning code" class="input input-bordered" value={code()} disabled={busy() || unavailable()} onInput={event => { setCode(event.currentTarget.value); setPreview(undefined); }} required pattern="[a-f0-9]{64}" maxlength={64} autocomplete="off" spellcheck={false} aria-describedby="station-code-help" />
          <button type="submit" class="btn btn-primary" disabled={busy() || unavailable()}>Review station</button>
        </form></details>
        <Show when={preview()}>{chosen => <div class="wts-tools-confirm" aria-label="Confirm station"><h3>{chosen().value.station.label}</h3><p>{chosen().value.station.location || "Location not configured"} · Printer: {chosen().value.station.printerRef || "Not configured"}</p><p>Confirming replaces this phone's binding. Existing work stays at its original station.</p><button type="button" class="btn btn-primary" disabled={busy() || unavailable() || !chosen().value.canBind} onClick={() => void confirm()}>Confirm station binding</button><button type="button" class="btn btn-ghost" disabled={busy()} onClick={() => { setPreview(undefined); setCode(""); }}>Cancel</button></div>}</Show>
      </section>
      <section id="tools-diagnostics" hidden={view() !== "diagnostics"} aria-label="Diagnostics">
        <h2>Diagnostics</h2><p>Connection alone does not verify printer or media readiness.</p>
        <button type="button" class="btn btn-outline" disabled={status.loading || machine.loading} onClick={() => { void refreshStatus(); void refreshMachine(); }}>Refresh readiness</button>
        <details><summary>Agent details</summary><Show when={agent()} fallback={<p>Agent readiness could not be verified. Refresh before relying on previous state.</p>}>{station => <AgentReadiness station={station()} />}</Show></details>
        <details><summary>Station details</summary><Show when={!unavailable() && current()}>{s => <dl class="wts-tools-details"><dt>Binding</dt><dd>{s().bindingState}</dd><dt>Location</dt><dd>{s().station?.location || "Not configured"}</dd><dt>Printer</dt><dd>{s().station?.printerRef || "Not configured"}</dd><dt>Authorization generation</dt><dd>{s().station?.generation ?? "Unavailable"}</dd><dt>Recently active phones</dt><dd>{s().station?.activeBindingCount ?? 0} · authenticated contact in the last 5 minutes, not live connections</dd></dl>}</Show></details>
        <Show when={!unavailable() && current()?.station?.multiplePhonesWarning}><p role="status">More than two phones are active at this station. Check that each is intended.</p></Show>
      </section>
    </main>
    <footer class="wts-tools-footer">
      <Show when={guard.authorized() && guard.user()?.role === "admin"}><a role="link" href={busy() ? undefined : "/admin/checkin"} aria-disabled={busy() ? "true" : "false"} target="_self" class="btn btn-ghost" tabindex={busy() ? -1 : 0}>Station administration</a><a role="link" href={busy() ? undefined : "/admin/users"} aria-disabled={busy() ? "true" : "false"} target="_self" class="btn btn-ghost" tabindex={busy() ? -1 : 0}>User roles</a></Show>
      <button type="button" class="btn btn-ghost" disabled={busy() || !guard.authorized()} onClick={() => void logout()}>Log out</button>
    </footer>
  </div>;
}
