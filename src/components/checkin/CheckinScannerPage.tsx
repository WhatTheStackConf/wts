import { For, Show, createEffect, createMemo, createSignal, onCleanup, onSettled } from "solid-js";
import { Meta, Title } from "@solidjs/meta";
import { useAuth } from "~/lib/auth-context";
import { useRequireCheckinOperator } from "~/lib/route-guards";
import { createCheckinPollingResource } from "./checkin-polling-resource";
import { CheckinPrinterSelector } from "./CheckinPrinterSelector";
import { checkinStatus } from "~/lib/checkin-client";
import { checkinEventCatalogue, selectCheckinEvent } from "~/lib/checkin-event-client";
import { agentStatus } from "~/lib/checkin-agent-client";
import type { CheckinArrivalResult } from "~/lib/checkin-arrival-contract";
import { cameraHeldReference } from "~/lib/checkin-camera-recovery";
import { readLookupHold } from "~/lib/checkin-lookup-held";
import { CheckinCameraArrival } from "~/components/checkin/checkin-camera-arrival";
import { CheckinLookup } from "~/components/checkin/CheckinLookup";
import { CheckinCompactResult } from "~/components/checkin/CheckinCompactResult";
import "./checkin-operator.css";

/** Operator task shell. Tools retain the full recovery and diagnostic surfaces. */
export default function CheckinScannerPage() {
  const guard = useRequireCheckinOperator();
  const auth = useAuth();
  const actorKey = createMemo(() => guard.authorized() ? `${guard.user()?.id}:${guard.user()?.role}` : undefined);
  const [status, statusActions] = createCheckinPollingResource(actorKey, async key => ({ ...(await checkinStatus()), verifiedFor: key }));
  const bound = () => status()?.bindingState === "bound" && !!status()?.binding && !status()?.binding?.revoked;
  const scope = createMemo(() => !status.error && status()?.verifiedFor === actorKey() && bound() ? `${status()!.binding!.id}:${status()!.binding!.version}:${status()?.station?.id}` : undefined);
  const eventSource = createMemo(() => scope() ? `${scope()}:${status()?.station?.generation}:${status()?.system.generation}` : undefined);
  const [events, eventActions] = createCheckinPollingResource(eventSource, checkinEventCatalogue);
  const [machine, machineActions] = createCheckinPollingResource(scope, async binding => ({ binding, ...(await agentStatus()) }));
  const [pane, setPane] = createSignal<"scan" | "event" | "lookup" | "lookup-result">("scan");
  const [mode, setMode] = createSignal<"scan" | "manual">("scan");
  const [printerBusy, setPrinterBusy] = createSignal(false);
  const [eventBusy, setEventBusy] = createSignal(false);
  const [choice, setChoice] = createSignal("");
  const [message, setMessage] = createSignal("");
  const [cameraBusy, setCameraBusy] = createSignal(false);
  const [lookupBusy, setLookupBusy] = createSignal(false);
  const [openLookup, setOpenLookup] = createSignal(0);
  const [lookupOutcome, setLookupOutcome] = createSignal<{ result: CheckinArrivalResult; scope: string; actor: string | undefined }>();
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [loggingOut, setLoggingOut] = createSignal(false);
  const [resumeRequest, setResumeRequest] = createSignal<{ operationId: string; scope: string }>();
  let queuedResume: { operationId: string; scope: string } | undefined;
  let dialog: HTMLDialogElement | undefined;
  let menuButton: HTMLButtonElement | undefined;
  let disposed = false;
  const workHeld = () => cameraBusy() || lookupBusy() || eventBusy();
  // Only a mode preference is stored per opaque authenticated actor ID. Never
  // persist the roster, search, attendee identities or print payloads.
  const modeKey = () => `wts.checkin.mode:${guard.user()?.id}`;
  createEffect(actorKey, actor => {
    if (!actor || typeof localStorage === "undefined") return;
    let preference: "scan" | "manual" = "scan";
    try { if (localStorage.getItem(modeKey()) === "manual") preference = "manual"; } catch { /* preference is optional */ }
    setMode(preference);
    if (!cameraBusy() && !lookupBusy()) setPane(preference === "manual" ? "lookup" : "scan");
  });
  function switchMode(next: "scan" | "manual") {
    if (!guard.authorized() || workHeld() || printerBusy() || loggingOut()) return;
    try {
      if (readLookupHold() || scope() && cameraHeldReference(localStorage, scope()!).read()) return;
    } catch { setMessage("Restore held-operation storage before changing modes."); return; }
    setMode(next); setPane(next === "manual" ? "lookup" : "scan");
    try { localStorage.setItem(modeKey(), next); } catch { /* preference is optional */ }
  }
  function returnToIntake() { setLookupOutcome(undefined); setPane(mode() === "manual" ? "lookup" : "scan"); }
  function cameraHeldChanged(value: boolean) {
    if (disposed) return;
    setCameraBusy(value);
  }
  function restoreHeldPanel() {
    // A persisted manual operation is recovered by the shared result panel.
    // Its acknowledgement/retry controls must win over the preferred intake mode.
    if (!disposed) setPane("scan");
  }
  // A routine status refresh is not a new user/permission boundary. Keep the
  // verified surface stable until its response changes a fence or denies access.
  // Every mutation remains server-authorized; actor changes still invalidate now.
  const verifying = () => !status() || status()?.verifiedFor !== actorKey() || !!status.error || events.loading || !!events.error || eventBusy() || printerBusy();
  // Keep the captured context mounted during background reads. Decoding and all
  // mutation handlers are separately gated by verifying; errors/fence changes
  // invalidate context rather than granting stale authority.
  const context = () => {
    const s = status(), e = events(), c = e?.context;
    if (status.error || events.error || !bound() || !s?.station?.enabled || !s.system.enabled || !c || !e?.selected || e.selected.availability !== "available") return null;
    return c.bindingId === s.binding!.id && c.bindingVersion === s.binding!.version && c.stationId === s.station.id
      && c.stationGeneration === s.station.generation && c.systemGeneration === s.system.generation
      && c.eventId === e.selected.id && c.eventGeneration === e.selected.generation
      && c.selectionVersion === e.fence.selectionVersion ? c : null;
  };
  const eventPicker = () => pane() === "event" || (!events.loading && !events.error && !events()?.selected && !cameraBusy() && !lookupBusy());
  const machineReady = () => !machine.error && machine()?.binding === scope() && machine()?.station?.readyForAuthorization === true;
  const stationLabel = () => !status.error ? status()?.station?.label || "Choose a printer" : "Connection unavailable";
  const eventLabel = () => events.error ? "Event unavailable" : events()?.selected?.title || "Choose an event";
  async function refreshStatus(force = false) {
    if (!guard.authorized() || (!force && status.refreshing)) return;
    await (force ? statusActions.refetch() : statusActions.poll()).catch(() => undefined);
  }
  onSettled(() => {
    const tick = () => { if (!document.hidden) { void refreshStatus(); if (!machine.refreshing) void machineActions.poll().catch(() => undefined); } };
    const timer = window.setInterval(tick, 5000);
    // Held work uses its frozen context, not a newly fetched catalogue. Keep
    // station/permission checks running; source-fence changes still refetch and
    // redact. Defer optional focus refresh until no arrival/lookup is held.
    const focus = () => { tick(); if (!eventBusy() && !cameraBusy() && !lookupBusy()) void eventActions.poll().catch(() => undefined); };
    window.addEventListener("focus", focus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", focus); };
  });
  onCleanup(() => { disposed = true; });
  createEffect(() => `${actorKey()}:${scope()}`, () => { setLookupOutcome(undefined); queuedResume = undefined; });
  async function chooseEvent(event: SubmitEvent) {
    event.preventDefault();
    const e = events(), target = e?.events.find(item => item.id === choice());
    if (verifying() || !e || !target || target.availability !== "available" || cameraBusy() || lookupBusy()) return;
    const actor = actorKey(), binding = scope();
    setEventBusy(true); setMessage("");
    try {
      await selectCheckinEvent({ eventId: target.id, eventGeneration: target.generation, ...e.fence });
    } catch { if (!disposed && actor === actorKey() && binding === scope()) setMessage("Checking whether the event changed…"); }
    finally {
      // The mutation may have committed even when its response was lost. Read
      // current selection before allowing intake; never blindly repeat selection.
      if (!disposed && actor === actorKey() && binding === scope()) {
        try {
          const current = await eventActions.refetch();
          if (!disposed && actor === actorKey() && binding === scope()) {
            if (current?.selected?.id === target.id && current.selected.generation === target.generation) { setChoice(""); setMessage(""); returnToIntake(); }
            else setMessage("Event wasn't changed. Review the selection and try again.");
          }
        } catch { if (!disposed && actor === actorKey() && binding === scope()) setMessage("Cannot verify the selected event. Refresh before scanning."); }
      }
      if (!disposed) setEventBusy(false);
    }
  }
  function lookupDecision(result: CheckinArrivalResult) {
    const binding = scope();
    if (!binding || verifying()) throw new Error("Verify station before handoff");
    if ("workflow" in result) {
      const reference = cameraHeldReference(localStorage, binding), existing = reference.read();
      if (existing && existing !== result.operationId) throw new Error("Another arrival is held");
      reference.hold(result.operationId); queuedResume = { operationId: result.operationId, scope: binding };
    } else if (result.state === "rejected" || result.state === "already_handled" || result.state === "print_blocked") {
      setLookupOutcome({ result, scope: binding, actor: actorKey() }); setPane("lookup-result");
    } else throw new Error("This lookup still needs an explicit recovery action");
  }
  function lookupChanged(busy: boolean) {
    if (disposed) return;
    setLookupBusy(busy);
    if (busy) setPane("lookup");
    if (!busy && queuedResume) { setResumeRequest(queuedResume); queuedResume = undefined; setPane("scan"); }
  }
  function closeMenu() { dialog?.close(); setMenuOpen(false); menuButton?.focus({ preventScroll: true }); }
  async function logout() {
    if (loggingOut() || printerBusy()) return; setLoggingOut(true);
    try { await auth.logout(); window.location.assign("/login"); }
    catch { setMessage("Couldn't log out. Try again."); setLoggingOut(false); }
  }
  return <div class="wts-operator-screen">
    <Title>Attendee check-in | WTS 2026</Title><Meta name="robots" content="noindex,nofollow" /><Meta name="referrer" content="no-referrer" />
    <header class="wts-operator-header"><h1>WTS <span>Check-in</span></h1><button ref={element => { menuButton = element; }} type="button" class="btn btn-ghost" aria-haspopup="dialog" onClick={() => { setMenuOpen(true); dialog?.showModal(); }}>Tools</button></header>
    <Show when={guard.authorized()} fallback={<main class="wts-operator-step"><p role="status">Checking sign-in…</p></main>}>
      <div class="wts-operator-context"><strong title={stationLabel()}>{stationLabel()}</strong><span title={eventLabel()}>{eventLabel()}</span></div>
      <div class="wts-operator-status" aria-live="polite"><Show when={status.error || events.error} fallback={<Show when={verifying()} fallback={<Show when={bound()} fallback="Step 1 · Choose a printer"><Show when={context()} fallback="Step 2 · Choose your event"><Show when={machineReady()} fallback="Printer unavailable · see Tools">Printer ready</Show></Show></Show>}>Checking connection…</Show>}>Connection lost · intake paused <button type="button" onClick={() => { void refreshStatus(true); void eventActions.refetch().catch(() => undefined); }}>Retry</button></Show></div>
      <main class="wts-operator-main">
        <section class="wts-operator-printer" aria-label="Printer selection">
          <CheckinPrinterSelector compact actorKey={actorKey()} status={!status.error && status()?.verifiedFor === actorKey() ? status() : undefined} disabled={workHeld() || loggingOut()} onBusyChange={value => { setPrinterBusy(value); }} refreshStatus={() => statusActions.refetch()} />
          <div class="wts-operator-modes" role="group" aria-label="Registration mode">
            <button type="button" class="btn" aria-pressed={mode() === "scan" ? "true" : "false"} disabled={workHeld() || printerBusy() || loggingOut()} onClick={() => switchMode("scan")}>Scan</button>
            <button type="button" class="btn" aria-pressed={mode() === "manual" ? "true" : "false"} disabled={workHeld() || printerBusy() || loggingOut()} onClick={() => switchMode("manual")}>Manual</button>
          </div>
        </section>
        {/* Keep arrival/lookup mounted while a printer selection is checked. */}
        <Show when={bound()}>
          <div class="wts-operator-content">
          <section class="wts-operator-step" hidden={!eventPicker()} aria-label="Choose event"><h2>Which event?</h2><p>This choice applies to this phone.</p><form onSubmit={e => void chooseEvent(e)}><label for="scan-event">Event</label><select id="scan-event" class="select select-bordered" value={choice()} required disabled={verifying() || cameraBusy() || lookupBusy()} onChange={e => setChoice(e.currentTarget.value)}><option value="">Choose an event</option><For each={events()?.events}>{event => <option value={event.id} disabled={event.availability !== "available"}>{event.title}<Show when={event.availability !== "available"}> · Unavailable</Show></option>}</For></select><button class="btn btn-primary" type="submit" disabled={!choice() || verifying() || cameraBusy() || lookupBusy()}>Use event</button></form><Show when={events()?.selected}><button class="btn btn-ghost" type="button" onClick={returnToIntake}>{mode() === "manual" ? "Back to attendee list" : "Back to scanner"}</button></Show></section>
          <div class="wts-operator-workspace" hidden={eventPicker() || pane() !== "scan"}><CheckinCameraArrival compact nextLabel={mode() === "manual" ? "Back to attendee list" : undefined} onNext={returnToIntake} onRestoreHeld={restoreHeldPanel} context={context()} bindingScope={scope()} verifying={verifying()} eventTitle={eventLabel()} stationLabel={stationLabel()} resumeRequest={resumeRequest()} manualHeld={printerBusy() || lookupBusy() || menuOpen() || pane() !== "scan" || eventPicker()} onHeld={cameraHeldChanged} /></div>
          <section class="checkin-compact-held wts-operator-workspace" hidden={pane() !== "lookup-result"} aria-label="Lookup result">
            <CheckinCompactResult decision={lookupOutcome()?.result} redacted={verifying() || lookupOutcome()?.scope !== scope() || lookupOutcome()?.actor !== actorKey()} />
            <button class="btn btn-primary min-h-12" type="button" onClick={returnToIntake}>{mode() === "manual" ? "Back to attendee list" : "Back to scanner"}</button>
          </section>
          <section class="wts-operator-lookup" hidden={pane() !== "lookup"} aria-label="Attendee lookup"><CheckinLookup manual={mode() === "manual"} visible={pane() === "lookup"} openRequest={openLookup()} context={context()} eventTitle={eventLabel()} stationLabel={stationLabel()} bindingScope={scope() ? `${actorKey()}:${scope()}` : undefined} verifying={verifying()} ready={machineReady()} disabled={(printerBusy() || cameraBusy()) && !lookupBusy()} onClose={returnToIntake} onBusy={lookupChanged} onDecision={lookupDecision} /></section>
          </div>
        </Show>
      </main>
      <footer class="wts-operator-footer"><Show when={message()}><p role="alert">{message()}</p></Show><Show when={bound() && !eventPicker() && mode() === "scan" && pane() === "scan" && !cameraBusy()}><button type="button" class="btn btn-outline" disabled={verifying() || !machineReady()} onClick={() => { setPane("lookup"); setOpenLookup(value => value + 1); }}>Find attendee</button></Show></footer>
    </Show>
    <dialog ref={element => { dialog = element; }} class="wts-operator-menu" aria-labelledby="scanner-tools-title" onClose={() => setMenuOpen(false)}><h2 id="scanner-tools-title">Station tools</h2><button class="btn btn-ghost" type="button" onClick={closeMenu}>Close</button><a href="/checkin-tools" target="_self" class="btn btn-outline">History & recovery</a><button class="btn btn-outline" type="button" disabled={!bound() || printerBusy() || cameraBusy() || lookupBusy()} onClick={() => { closeMenu(); setPane("event"); }}>Change event</button><a href="/checkin-tools" target="_self" class="btn btn-ghost">Station setup & diagnostics</a><Show when={guard.user()?.role === "admin"}><a class="btn btn-ghost" href="/admin/checkin" target="_self">Administration</a></Show><button class="btn btn-ghost" type="button" disabled={loggingOut() || printerBusy()} onClick={() => void logout()}>Log out</button></dialog>
  </div>;
}
