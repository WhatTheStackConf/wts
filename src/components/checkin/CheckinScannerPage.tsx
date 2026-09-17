import { For, Show, createEffect, createMemo, createSignal, onCleanup, onSettled } from "solid-js";
import { Meta, Title } from "@solidjs/meta";
import { useAuth } from "~/lib/auth-context";
import { useRequireCheckinOperator } from "~/lib/route-guards";
import { createCheckinPollingResource } from "./checkin-polling-resource";
import { listenForProvisioningFragment } from "./provisioning-fragment";
import { bindCheckinStation, checkinStatus, previewCheckinStation } from "~/lib/checkin-client";
import { checkinEventCatalogue, selectCheckinEvent } from "~/lib/checkin-event-client";
import { agentStatus } from "~/lib/checkin-agent-client";
import type { CheckinPreviewDTO } from "~/lib/checkin-contract";
import type { CheckinArrivalResult } from "~/lib/checkin-arrival-contract";
import { provisioningCameraCode } from "~/lib/checkin-camera";
import { cameraHeldReference } from "~/lib/checkin-camera-recovery";
import { CheckinCameraScanner } from "~/components/checkin/checkin-camera-scanner";
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
  const [pairCode, setPairCode] = createSignal("");
  const [preview, setPreview] = createSignal<{ code: string; value: CheckinPreviewDTO }>();
  const [pairBusy, setPairBusy] = createSignal(false);
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
  let confirmationPanel: HTMLDivElement | undefined;
  let disposed = false;
  let pairingEpoch = 0;
  let pairingDraftVersion = 0;
  let pairingInFlight = false;
  const [pairRequested, setPairRequested] = createSignal(false);
  const workHeld = () => cameraBusy() || lookupBusy() || eventBusy();
  const pairUnavailable = () => !actorKey() || !status() || status()?.verifiedFor !== actorKey() || !!status.error || status()?.bindingState === "revoked";
  function stagePair(code: string) {
    pairingDraftVersion++; pairingEpoch++; setPreview(undefined); setPairCode(code); setPairRequested(true); setMessage("");
  }
  function cancelPair() {
    if (pairingInFlight) return;
    pairingDraftVersion++; pairingEpoch++; setPreview(undefined); setPairCode(""); setPairRequested(false); setMessage("");
  }
  // A routine status refresh is not a new user/permission boundary. Keep the
  // verified surface stable until its response changes a fence or denies access.
  // Every mutation remains server-authorized; actor changes still invalidate now.
  const verifying = () => !status() || status()?.verifiedFor !== actorKey() || !!status.error || events.loading || !!events.error || eventBusy();
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
  const stationLabel = () => !status.error ? status()?.station?.label || "Pair a station" : "Connection unavailable";
  const eventLabel = () => events.error ? "Event unavailable" : events()?.selected?.title || "Choose an event";
  async function refreshStatus(force = false) {
    if (!guard.authorized() || (!force && status.refreshing)) return;
    await (force ? statusActions.refetch() : statusActions.poll()).catch(() => undefined);
  }
  onSettled(() => {
    const stopProvisioning = listenForProvisioningFragment(code => {
      stagePair(code ?? "");
      if (!code) setMessage("That station link is invalid. Scan the station QR again.");
    });
    const tick = () => { if (!document.hidden) { void refreshStatus(); if (!machine.refreshing) void machineActions.poll().catch(() => undefined); } };
    const timer = window.setInterval(tick, 5000);
    // Held work uses its frozen context, not a newly fetched catalogue. Keep
    // station/permission checks running; source-fence changes still refetch and
    // redact. Defer optional focus refresh until no arrival/lookup is held.
    const focus = () => { tick(); if (!eventBusy() && !cameraBusy() && !lookupBusy()) void eventActions.poll().catch(() => undefined); };
    window.addEventListener("focus", focus);
    return () => { stopProvisioning(); window.clearInterval(timer); window.removeEventListener("focus", focus); };
  });
  onCleanup(() => { disposed = true; });
  createEffect(preview, chosen => {
    if (!chosen || typeof window === "undefined") return;
    const frame = window.requestAnimationFrame(() => {
      if (disposed || preview() !== chosen || !confirmationPanel?.isConnected) return;
      confirmationPanel.focus({ preventScroll: true });
      confirmationPanel.scrollIntoView({ block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  });
  createEffect(() => `${actorKey()}:${scope()}`, () => { setLookupOutcome(undefined); queuedResume = undefined; });
  createEffect(() => `${actorKey()}:${scope()}:${status()?.station?.version}:${status()?.system.generation}:${pairUnavailable()}`, () => { pairingEpoch++; setPreview(undefined); });
  let previousActor = actorKey();
  createEffect(actorKey, actor => {
    if (previousActor !== undefined && actor !== previousActor) { pairingDraftVersion++; setPairCode(""); setPairRequested(false); setMessage(""); }
    previousActor = actor;
  });
  async function review(code: string) {
    if (pairingInFlight || pairUnavailable() || workHeld()) return;
    const epoch = ++pairingEpoch, actor = actorKey();
    pairingInFlight = true; setPairBusy(true); setMessage(""); setPreview(undefined);
    try { const value = await previewCheckinStation(code); if (!disposed && epoch === pairingEpoch && actor === actorKey()) setPreview({ code, value }); }
    catch { if (!disposed && epoch === pairingEpoch && actor === actorKey()) setMessage("Couldn't read that station. Check the code and try again."); }
    finally { pairingInFlight = false; if (!disposed) setPairBusy(false); }
  }
  async function confirmPair() {
    const current = preview();
    if (!current || current.code !== pairCode() || pairingInFlight || pairUnavailable() || workHeld() || !current.value.canBind) return;
    const epoch = pairingEpoch, draft = pairingDraftVersion, actor = actorKey();
    pairingInFlight = true; setPairBusy(true); setMessage("");
    try {
      await bindCheckinStation(current.code, current.value.confirmation);
      // A poll can observe this successful bind before its response arrives.
      // Clear only the acknowledged draft, never a newer incoming station link.
      if (!disposed && draft === pairingDraftVersion && actor === actorKey()) { setPreview(undefined); setPairCode(""); setPairRequested(false); }
    } catch { if (!disposed && epoch === pairingEpoch && actor === actorKey()) { setPreview(undefined); setMessage("Pairing wasn't confirmed. Review the station again."); } }
    finally {
      // A lost response or a newer link may still follow a committed binding.
      if (!disposed && actor === actorKey()) await refreshStatus(true);
      pairingInFlight = false; if (!disposed) setPairBusy(false);
    }
  }
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
            if (current?.selected?.id === target.id && current.selected.generation === target.generation) { setChoice(""); setMessage(""); setPane("scan"); }
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
    } else if (result.state === "rejected" || result.state === "already_handled") {
      setLookupOutcome({ result, scope: binding, actor: actorKey() }); setPane("lookup-result");
    } else throw new Error("This lookup still needs an explicit recovery action");
  }
  function lookupChanged(busy: boolean) {
    setLookupBusy(busy);
    if (busy) setPane("lookup");
    if (!busy && queuedResume) { setResumeRequest(queuedResume); queuedResume = undefined; setPane("scan"); }
  }
  function closeMenu() { dialog?.close(); setMenuOpen(false); menuButton?.focus({ preventScroll: true }); }
  async function logout() {
    if (loggingOut()) return; setLoggingOut(true);
    try { await auth.logout(); window.location.assign("/login"); }
    catch { setMessage("Couldn't log out. Try again."); setLoggingOut(false); }
  }
  return <div class="wts-operator-screen">
    <Title>Scan attendees | WTS 2026</Title><Meta name="robots" content="noindex,nofollow" /><Meta name="referrer" content="no-referrer" />
    <header class="wts-operator-header"><h1>WTS <span>Check-in</span></h1><button ref={element => { menuButton = element; }} type="button" class="btn btn-ghost" aria-haspopup="dialog" onClick={() => { setMenuOpen(true); dialog?.showModal(); }}>Tools</button></header>
    <Show when={guard.authorized()} fallback={<main class="wts-operator-step"><p role="status">Checking sign-in…</p></main>}>
      <div class="wts-operator-context"><strong title={stationLabel()}>{stationLabel()}</strong><span title={eventLabel()}>{eventLabel()}</span></div>
      <div class="wts-operator-status" aria-live="polite"><Show when={status.error || events.error} fallback={<Show when={verifying()} fallback={<Show when={bound()} fallback="Step 1 · Pair this phone"><Show when={context()} fallback="Step 2 · Choose your event"><Show when={machineReady()} fallback="Printer unavailable · see Tools">Connected</Show></Show></Show>}>Checking connection…</Show>}>Connection lost · intake paused <button type="button" onClick={() => { void refreshStatus(true); void eventActions.refetch().catch(() => undefined); }}>Retry</button></Show></div>
      <main class="wts-operator-main">
        <Show when={!bound() || pairRequested()}><section class="wts-operator-step" aria-label="Pair station">
          <h2>Pair your station</h2><p>Scan the station QR—not an attendee ticket.</p>
          <Show when={bound()}><p>Confirming replaces this phone's binding. Existing work stays at its original station.</p><button type="button" class="btn btn-ghost" disabled={pairBusy()} onClick={cancelPair}>Cancel station change</button></Show>
          <Show when={workHeld()}><p role="status">Finish or recover the current work before changing stations.</p></Show>
          <Show when={status()?.bindingState !== "revoked"} fallback={<p role="alert">This phone was revoked. Ask an admin to restore access.</p>}>
            <Show when={!preview()} fallback={<div ref={element => { confirmationPanel = element; }} role="region" aria-label="Confirm station" tabindex="-1" class="wts-pair-confirm"><h3>{preview()?.value.station.label}</h3><p>{preview()?.value.station.location}</p><button class="btn btn-primary" type="button" disabled={pairBusy() || pairUnavailable() || workHeld() || !preview()?.value.canBind} onClick={() => void confirmPair()}>Confirm station</button><button class="btn btn-ghost" type="button" disabled={pairBusy()} onClick={cancelPair}>Scan a different station</button></div>}>
              <Show when={!pairCode()}><CheckinCameraScanner compact purpose="station" enabled={!pairBusy() && !pairUnavailable() && !workHeld()} held={pairBusy()} scope={guard.authorized() ? "station-setup" : undefined} onDecode={value => { const code = provisioningCameraCode(value, window.location.origin); if (!code) { setMessage("That's not a station QR."); return false; } stagePair(code); void review(code); }} /></Show>
              <details open={!!pairCode()}><summary>Enter station code instead</summary><form onSubmit={e => { e.preventDefault(); void review(pairCode()); }}><label for="pair-code">Station code</label><input disabled={pairBusy() || pairUnavailable() || workHeld()} id="pair-code" class="input input-bordered" autocomplete="off" spellcheck={false} maxlength={64} pattern="[a-f0-9]{64}" required value={pairCode()} onInput={e => stagePair(e.currentTarget.value)} /><button class="btn btn-primary" disabled={pairBusy() || pairUnavailable() || workHeld()} type="submit">Review station</button></form></details>
            </Show>
          </Show>
        </section></Show>
        {/* Pairing never unmounts arrival/lookup: their frozen commands must survive. */}
        <Show when={bound()}>
          <div hidden={pairRequested() && !workHeld()}>
          <section class="wts-operator-step" hidden={!eventPicker()} aria-label="Choose event"><h2>Which event?</h2><p>This choice applies to this phone.</p><form onSubmit={e => void chooseEvent(e)}><label for="scan-event">Event</label><select id="scan-event" class="select select-bordered" value={choice()} required disabled={verifying() || cameraBusy() || lookupBusy()} onChange={e => setChoice(e.currentTarget.value)}><option value="">Choose an event</option><For each={events()?.events}>{event => <option value={event.id} disabled={event.availability !== "available"}>{event.title}<Show when={event.availability !== "available"}> · Unavailable</Show></option>}</For></select><button class="btn btn-primary" type="submit" disabled={!choice() || verifying() || cameraBusy() || lookupBusy()}>Use event</button></form><Show when={events()?.selected}><button class="btn btn-ghost" type="button" onClick={() => setPane("scan")}>Back to scanner</button></Show></section>
          <div class="wts-operator-workspace" hidden={eventPicker() || pane() !== "scan"}><CheckinCameraArrival compact context={context()} bindingScope={scope()} verifying={verifying()} eventTitle={eventLabel()} stationLabel={stationLabel()} resumeRequest={resumeRequest()} manualHeld={pairRequested() || pairBusy() || lookupBusy() || menuOpen() || pane() !== "scan" || eventPicker()} onHeld={value => { setCameraBusy(value); }} /></div>
          <section class="checkin-compact-held wts-operator-workspace" hidden={pane() !== "lookup-result"} aria-label="Lookup result">
            <CheckinCompactResult decision={lookupOutcome()?.result} redacted={verifying() || lookupOutcome()?.scope !== scope() || lookupOutcome()?.actor !== actorKey()} />
            <button class="btn btn-primary min-h-12" type="button" onClick={() => { setLookupOutcome(undefined); setPane("scan"); }}>Back to scanner</button>
          </section>
          <section class="wts-operator-lookup" hidden={pane() !== "lookup"} aria-label="Attendee lookup"><CheckinLookup openRequest={openLookup()} context={context()} eventTitle={eventLabel()} stationLabel={stationLabel()} bindingScope={scope()} verifying={verifying()} ready={machineReady()} disabled={(pairRequested() || pairBusy() || cameraBusy()) && !lookupBusy()} onClose={() => setPane("scan")} onBusy={lookupChanged} onDecision={lookupDecision} /></section>
          </div>
        </Show>
      </main>
      <footer class="wts-operator-footer"><Show when={message()}><p role="alert">{message()}</p></Show><Show when={bound() && !pairRequested() && !pairBusy() && !eventPicker() && pane() === "scan" && !cameraBusy()}><button type="button" class="btn btn-outline" disabled={verifying() || !machineReady()} onClick={() => { setPane("lookup"); setOpenLookup(value => value + 1); }}>Find attendee</button></Show></footer>
    </Show>
    <dialog ref={element => { dialog = element; }} class="wts-operator-menu" aria-labelledby="scanner-tools-title" onClose={() => setMenuOpen(false)}><h2 id="scanner-tools-title">Station tools</h2><button class="btn btn-ghost" type="button" onClick={closeMenu}>Close</button><a href="/checkin-tools" target="_self" class="btn btn-outline">History & recovery</a><button class="btn btn-outline" type="button" disabled={!bound() || cameraBusy() || lookupBusy()} onClick={() => { closeMenu(); setPane("event"); }}>Change event</button><a href="/checkin-tools" target="_self" class="btn btn-ghost">Station setup & diagnostics</a><Show when={guard.user()?.role === "admin"}><a class="btn btn-ghost" href="/admin/checkin" target="_self">Administration</a></Show><button class="btn btn-ghost" type="button" disabled={loggingOut()} onClick={() => void logout()}>Log out</button></dialog>
  </div>;
}
