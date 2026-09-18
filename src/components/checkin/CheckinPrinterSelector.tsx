import { For, Show, createEffect, createMemo, createSignal, onCleanup, onSettled } from "solid-js";
import { checkinPrinters, selectCheckinPrinter } from "~/lib/checkin-client";
import type { CheckinStatusDTO } from "~/lib/checkin-contract";
import { cameraHeldReference } from "~/lib/checkin-camera-recovery";
import { readLookupHold } from "~/lib/checkin-lookup-held";
import { createCheckinPollingResource } from "./checkin-polling-resource";

interface CheckinPrinterSelectorProps {
  actorKey: string | undefined;
  /** Only a status verified for the current actor; undefined on failed reads. */
  status: CheckinStatusDTO | undefined;
  disabled?: boolean;
  compact?: boolean;
  onBusyChange: (busy: boolean) => void;
  /** Explicit authoritative read, superseding any pre-selection observation. */
  refreshStatus: () => Promise<CheckinStatusDTO | undefined>;
}

/** Selection is immediate; the binding and queue fences remain server-owned. */
export function CheckinPrinterSelector(props: CheckinPrinterSelectorProps) {
  const source = createMemo(() => props.actorKey && props.status
    ? `${props.actorKey}:${props.status.binding?.id}:${props.status.binding?.version}:${props.status.station?.version}:${props.status.system.generation}` : undefined);
  const [catalogue, catalogueActions] = createCheckinPollingResource(source, checkinPrinters);
  const [busy, setBusy] = createSignal(false);
  const [uncertain, setUncertain] = createSignal(false);
  const [held, setHeld] = createSignal(false);
  const [message, setMessage] = createSignal("");
  let disposed = false, epoch = 0, inFlight = false;
  let targetId: string | undefined;
  let selectionAbort: AbortController | undefined;
  const selected = () => props.status?.bindingState === "bound" && !props.status.binding?.revoked ? props.status.station?.id ?? "" : "";
  function notifyBusy(value: boolean) { setBusy(value); props.onBusyChange(value); }
  function readHeld() {
    try {
      const s = props.status;
      const cameraScope = s?.binding && s.station ? `${s.binding.id}:${s.binding.version}:${s.station.id}` : undefined;
      const value = typeof window !== "undefined" && (!!readLookupHold() || !!(cameraScope && cameraHeldReference(window.localStorage, cameraScope).read()));
      setHeld(value); return value;
    } catch { setHeld(true); return true; }
  }
  createEffect(source, () => { readHeld(); });
  createEffect(() => props.actorKey, () => {
    selectionAbort?.abort(); selectionAbort = undefined;
    epoch++; inFlight = false; targetId = undefined;
    setUncertain(false); setMessage(""); notifyBusy(false);
  });
  onCleanup(() => {
    selectionAbort?.abort();
    disposed = true; epoch++;
    // Solid 2 forbids writes during owned-scope disposal.
    const actor = props.actorKey;
    queueMicrotask(() => { if (actor === props.actorKey || !props.actorKey) props.onBusyChange(false); });
  });
  onSettled(() => {
    const refresh = () => {
      readHeld();
      if (!document.hidden && !inFlight && !catalogue.refreshing) void catalogueActions.poll().catch(() => undefined);
    };
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener("focus", refresh); window.addEventListener("storage", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener("storage", refresh); };
  });
  // A catalogue can establish the cookie before the first selection creates a
  // binding row. Status calls that identity "invalid"; only revocation denies
  // choosing a printer. The server rechecks the identity during selection.
  const unavailable = () => !source() || props.status?.bindingState === "revoked" || !catalogue() || !!catalogue.error;
  const disabled = () => busy() || props.disabled || held() || unavailable();

  async function reconcile(actor: string, requestEpoch: number) {
    const live = () => !disposed && actor === props.actorKey && requestEpoch === epoch;
    try {
      const current = await props.refreshStatus();
      if (!live()) return;
      if (!current) throw new Error("No verified status");
      setMessage(current.bindingState === "bound" && current.station?.id === targetId
        ? "" : "Printer wasn't changed. Check the current selection before choosing again.");
      targetId = undefined; setUncertain(false);
      // Confirmation fences can change even if the selected station did not.
      await catalogueActions.refetch().catch(() => undefined);
      if (live()) notifyBusy(false);
    } catch {
      if (live()) { setUncertain(true); setMessage("Cannot verify the selected printer. Check its status before scanning or choosing again."); }
    }
  }
  async function choose(id: string) {
    if (inFlight || disabled() || readHeld()) return;
    const target = catalogue()?.printers.find(item => item.station.id === id);
    if (!target?.canBind || id === selected() || !props.actorKey) return;
    const actor = props.actorKey, requestEpoch = epoch;
    const live = () => !disposed && actor === props.actorKey && requestEpoch === epoch;
    inFlight = true; targetId = id; notifyBusy(true); setMessage("");
    const cancellation = new AbortController(); selectionAbort = cancellation;
    try { await selectCheckinPrinter(target.confirmation, { expectedActorId: actor.split(":")[0], signal: cancellation.signal }); }
    catch { /* A failed response can follow a committed selection: read, never replay. */ }
    finally {
      if (selectionAbort === cancellation) selectionAbort = undefined;
      if (live()) {
        await reconcile(actor, requestEpoch);
        if (live()) inFlight = false;
      }
    }
  }
  async function checkSelection() {
    if (inFlight || !props.actorKey) return;
    const actor = props.actorKey, requestEpoch = epoch;
    inFlight = true;
    await reconcile(actor, requestEpoch);
    if (!disposed && actor === props.actorKey && requestEpoch === epoch) inFlight = false;
  }
  return <div class={props.compact ? "checkin-printer-compact" : "grid gap-2"}>
    <label for="checkin-printer">Printer</label>
    <select id="checkin-printer" class="select select-bordered w-full" aria-describedby="checkin-printer-help" value={selected()} disabled={disabled()} onChange={event => {
      const id = event.currentTarget.value;
      // Display only authoritative selection, not the browser's optimistic value.
      event.currentTarget.value = selected(); void choose(id);
    }}>
      <option value="">Choose a printer</option>
      <Show when={selected() && !catalogue()?.printers.some(item => item.station.id === selected())}>
        <option value={selected()} disabled>{props.status?.station?.label} · Selected</option>
      </Show>
      <For each={catalogue()?.printers}>{item => <option value={item.station.id} disabled={!item.canBind}>
        {item.station.label}<Show when={item.station.printerRef}> · {item.station.printerRef}</Show><Show when={!item.canBind}> · Unavailable</Show>
      </option>}</For>
    </select>
    <p id="checkin-printer-help" class={props.compact ? "sr-only" : "text-sm"}><Show when={selected()} fallback="Choose a printer to start. Nothing is selected automatically.">Selected · physical printer readiness is checked separately.</Show></p>
    <Show when={held() || props.disabled}><p role="status" class={props.compact ? "sr-only" : ""}>Finish or recover the current work before changing printers.</p></Show>
    <Show when={props.status?.bindingState === "revoked"}><p role="alert">This browser's printer access needs an admin's help.</p></Show>
    <Show when={busy() && !uncertain()}><p role="status">Checking printer selection…</p></Show>
    <Show when={message()}><p role="alert">{message()}</p></Show>
    <Show when={uncertain()}><button type="button" class="btn btn-outline" onClick={() => void checkSelection()}>Check selected printer</button></Show>
    <Show when={catalogue.error && !busy()}><p role="alert">Couldn't load printers.</p><button type="button" class="btn btn-outline" onClick={() => { void catalogueActions.refetch().catch(() => undefined); }}>Refresh printers</button></Show>
  </div>;
}
