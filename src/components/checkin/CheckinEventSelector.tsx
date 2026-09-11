import { For, Show, createEffect, createSignal, onCleanup, onSettled } from "solid-js";
import { createAsyncResource } from "~/lib/async-resource";
import type { CheckinStatusDTO } from "~/lib/checkin-contract";
import { checkinEventCatalogue, selectCheckinEvent } from "~/lib/checkin-event-client";
import { CheckinArrivalPreflight } from "~/components/checkin/CheckinArrivalPreflight";
import { CheckinArrivalWork } from "~/components/checkin/CheckinArrivalWork";
import type { CheckinEventAvailability } from "~/lib/checkin-event-contract";

const availabilityMessages: Record<CheckinEventAvailability, string> = {
  available: "Available for selection",
  unconfigured: "Unconfigured — ask an admin to map an admission list",
  disabled: "Disabled by an admin",
  stale: "Stale configuration — refresh and explicitly select again",
  upstream_unavailable: "Upstream unavailable — configuration cannot be verified",
};
interface CheckinEventSelectorProps {
  status: CheckinStatusDTO | undefined;
  verifying: boolean;
  compact?: boolean;
  view?: "phone" | "arrivals";
  authorityKey?: string;
  disabled?: boolean;
  arrivalsActive?: boolean;
  onEventLabelChange?: (label: string) => void;
  onBusyChange?: (busy: boolean) => void;
}

export function CheckinEventSelector(props: CheckinEventSelectorProps) {
  // Do not fan out full upstream discovery on every 5-second station heartbeat.
  // Refresh on binding/station fences, focus, explicit refresh and each selection.
  // The server always revalidates mappings and generations for new requests.
  const source = () => props.status?.bindingState === "bound" ? `${props.authorityKey ?? "legacy"}:${props.status?.binding?.id}:${props.status?.binding?.version}:${props.status?.station?.generation}:${props.status?.system.generation}` : undefined;
  const [catalogue, actions] = createAsyncResource(source, async fence => ({ ...(await checkinEventCatalogue()), verifiedFor: fence }));
  const [resumeRequest, setResumeRequest] = createSignal<{ operationId: string; scope: string }>();
  const bindingScope = () => props.status?.bindingState === "bound" && props.status.binding && !props.status.binding.revoked ? `${props.status.binding.id}:${props.status.binding.version}:${props.status.station?.id}` : undefined;
  const [choice, setChoice] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const [arrivalBusy, setArrivalBusy] = createSignal(false);
  const [arrivalsMounted, setArrivalsMounted] = createSignal(!props.compact);
  createEffect(() => props.arrivalsActive && !!bindingScope(), active => { if (active) setArrivalsMounted(true); });
  const [error, setError] = createSignal("");
  const [message, setMessage] = createSignal("");
  let disposed = false, epoch = 0, selecting = false;
  onCleanup(() => { disposed = true; epoch++; const notify = props.onBusyChange; queueMicrotask(() => notify?.(false)); });
  createEffect(source, () => { epoch++; setChoice(""); setError(""); setMessage(""); });
  createEffect(() => pending() || arrivalBusy(), value => { props.onBusyChange?.(value); });
  createEffect(() => props.verifying || catalogue.error || catalogue()?.verifiedFor !== source() ? "Event unverified" : catalogue()?.selected?.title || "Choose an event", label => { props.onEventLabelChange?.(label); });
  const verified = () => {
    const data = catalogue();
    return !!data && data.verifiedFor === source() && !catalogue.error && !catalogue.loading && !props.verifying && !pending()
      && props.status?.bindingState === "bound" && !!props.status?.binding && !props.status?.binding.revoked
      && props.status?.system.enabled && !!props.status?.station?.enabled
      && data.fence.bindingVersion === props.status?.binding.version
      && data.fence.stationGeneration === props.status?.station.generation
      && data.fence.systemGeneration === props.status?.system.generation;
  };
  const contextAvailable = () => {
    const data = catalogue();
    const context = data?.context;
    return verified() && data?.selected?.availability === "available" && !!context
      && context.eventId === data.selected.id && context.eventGeneration === data.selected.generation
      && context.bindingId === props.status?.binding?.id && context.stationId === props.status?.station?.id
      && context.bindingVersion === data.fence.bindingVersion && context.selectionVersion === data.fence.selectionVersion
      && context.stationGeneration === data.fence.stationGeneration && context.systemGeneration === data.fence.systemGeneration;
  };
  const chosen = () => catalogue()?.events.find((event) => event.id === choice());
  async function refresh() { await actions.refetch().catch(() => undefined); }
  onSettled(() => {
    const focus = () => { if (!pending()) void refresh(); };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  });
  async function select(event: SubmitEvent) {
    event.preventDefault();
    const current = catalogue();
    const target = chosen();
    if (!verified() || props.disabled || selecting || !current || !target || target.availability !== "available") return;
    const generation = epoch, fence = source();
    const live = () => !disposed && generation === epoch && fence === source();
    selecting = true;
    const selection = { eventId: target.id, eventGeneration: target.generation, ...current.fence };
    setPending(true); setError(""); setMessage("");
    try {
      await selectCheckinEvent(selection);
      if (!live()) return;
      setChoice("");
      setMessage("Event selection saved for this phone only. Other phones and existing work are unchanged.");
    } catch (failure) {
      if (!live()) return;
      setError(failure instanceof Error ? failure.message : "Event selection could not be confirmed.");
      // Selection has no operation UUID: reconcile by reading, never replay
      // a stale selection fence automatically or optimistically show success.
      setChoice("");
    } finally {
      if (live()) await refresh();
      selecting = false;
      if (!disposed) setPending(false);
    }
  }

  return (
    <>
    <section hidden={props.compact && props.view !== "phone"} aria-label="This phone's event" class={props.compact ? "wts-tools-event" : "min-w-0 border-t border-base-content/20 pt-4 space-y-4 break-words"}>
      <h2 class="text-xl font-bold">Current event for this phone</h2>
      <Show when={!props.compact}><p class="font-bold">Station: {props.status?.station?.label || "Unavailable"}</p></Show>
      <div aria-live="polite" class="space-y-2">
        <Show when={catalogue.loading || props.verifying}><p role="status">Refreshing this phone's event context…</p></Show>
        <Show when={catalogue.error}><p role="alert" class="alert alert-error">Event catalogue unavailable. Any previously selected event below is unverified, not ready for new work.</p></Show>
        <Show when={error()}><p role="alert" class="alert alert-error">{error()} Refresh the catalogue and review the current event before choosing again.</p></Show>
        <Show when={message()}><p role="status">{message()}</p></Show>
        <Show when={!props.verifying && !catalogue.error && catalogue()?.verifiedFor === source() && catalogue()?.selected} fallback={<p class="text-lg font-bold">{props.verifying || !catalogue() || catalogue.error || catalogue.loading ? "Current event not yet verified" : "No event selected"}</p>}>{(selected) => (
          <div class="space-y-1">
            <p class="text-lg font-bold">Current event: {selected().title}</p>
            <Show when={!props.compact}><p>Event ID {selected().id} · Configuration generation {selected().generation}</p></Show>
            <p class="font-medium">{availabilityMessages[selected().availability]}</p>
          </div>
        )}</Show>
        <Show when={!contextAvailable()} fallback={<Show when={!props.compact}><p>Event context verified for this phone. Supervised admission and printing require current station readiness.</p></Show>}>
          <p role="status">Choose an available event before starting new arrivals.</p>
        </Show>
      </div>
      <button type="button" class="btn btn-outline min-h-12" disabled={pending() || catalogue.loading} onClick={() => void refresh()}>Refresh event catalogue</button>
      <Show when={!props.verifying && !catalogue.error && catalogue()?.verifiedFor === source() && catalogue()}>{(data) => (
        <>
          <Show when={data().state !== "complete"}><p role="status" class="alert alert-warning">Event catalogue is {data().state}. Missing events are not an empty catalogue. Unverified entries cannot be selected.</p></Show>
          <Show when={data().state === "complete" && data().events.length === 0}><p>No WTS 2026 events are configured for this account. Ask an admin to confirm edition membership.</p></Show>
          <form method="post" action="/api/checkin-events" class="min-w-0 space-y-3" onSubmit={(event) => void select(event)}>
            <label for="phone-checkin-event" class="block font-medium">Event for this phone</label>
            <select id="phone-checkin-event" class="select select-bordered min-h-12 w-full min-w-0 max-w-full text-base" required disabled={!verified() || props.disabled} value={choice()} onChange={(event) => { setChoice(event.currentTarget.value); setMessage(""); }} aria-describedby="phone-event-help">
              <option value="">Choose an event explicitly</option>
              <For each={data().events}>{(entry) => <option value={entry.id} disabled={entry.availability !== "available"}>{entry.title}<Show when={!props.compact}> · ID {entry.id}</Show><Show when={!props.compact || entry.availability !== "available"}> · {availabilityMessages[entry.availability]}</Show></option>}</For>
            </select>
            <p id="phone-event-help" class="text-sm">Only this phone changes. Existing work keeps its original event.</p>
            <Show when={!props.compact && chosen()}>{(event) => <p>Proposed event: {event().title} · ID {event().id} · {availabilityMessages[event().availability]}</p>}</Show>
            <button type="submit" class="btn btn-primary min-h-12" disabled={!verified() || props.disabled || chosen()?.availability !== "available"}>{pending() ? "Saving this phone's event…" : "Select event for this phone"}</button>
          </form>
        </>
      )}</Show>
    </section>
    <div id={props.compact ? "tools-arrivals" : undefined} hidden={props.compact && props.view !== "arrivals"} class={props.compact ? "wts-tools-arrivals" : undefined}>
    <Show when={arrivalsMounted()}>
    <CheckinArrivalPreflight onBusyChange={value => { setArrivalBusy(value); }} resumeRequest={resumeRequest()} context={contextAvailable() && !props.disabled && (!props.compact || props.arrivalsActive) ? catalogue()?.context ?? null : null} eventTitle={!props.verifying && !catalogue.error && catalogue()?.verifiedFor === source() ? catalogue()?.selected?.title ?? "" : ""} stationLabel={!props.verifying ? props.status?.station?.label ?? "" : ""} verifying={props.verifying || !!props.disabled || (!!props.compact && !props.arrivalsActive)} bindingScope={bindingScope()} />
    <CheckinArrivalWork compact={props.compact} onResume={(operationId) => { const scope = bindingScope(); if (scope && !props.verifying && !props.disabled) setResumeRequest({ operationId, scope }); }} unavailable={props.verifying || props.disabled} stationKey={props.status?.bindingState === "bound" && props.status.binding && !props.status.binding.revoked ? `${props.authorityKey ?? "legacy"}:${props.status.binding.id}:${props.status.binding.version}` : undefined} />
    </Show>
    </div>
    </>
  );
}
