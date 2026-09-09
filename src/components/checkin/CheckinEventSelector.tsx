import { For, Show, createSignal, onSettled } from "solid-js";
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
}

export function CheckinEventSelector(props: CheckinEventSelectorProps) {
  // Do not fan out full upstream discovery on every 5-second station heartbeat.
  // Refresh on binding/station fences, focus, explicit refresh and each selection.
  // The server always revalidates mappings and generations for new requests.
  const [catalogue, actions] = createAsyncResource(() => props.status?.bindingState === "bound" ? `${props.status?.binding?.id}:${props.status?.binding?.version}:${props.status?.station?.generation}:${props.status?.system.generation}` : undefined, checkinEventCatalogue);
  const [choice, setChoice] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");
  const [message, setMessage] = createSignal("");
  const verified = () => {
    const data = catalogue();
    return !!data && !catalogue.error && !catalogue.loading && !props.verifying && !pending()
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
    if (!verified() || !current || !target || target.availability !== "available") return;
    const selection = { eventId: target.id, eventGeneration: target.generation, ...current.fence };
    setPending(true); setError(""); setMessage("");
    try {
      await selectCheckinEvent(selection);
      setChoice("");
      setMessage("Event selection saved for this phone only. Other phones and existing work are unchanged.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Event selection could not be confirmed.");
      // Selection has no operation UUID: reconcile by reading, never replay
      // a stale selection fence automatically or optimistically show success.
      setChoice("");
    } finally {
      await refresh();
      setPending(false);
    }
  }

  return (
    <>
    <section aria-label="This phone's event" class="min-w-0 border-t border-base-content/20 pt-4 space-y-4 break-words">
      <h2 class="text-xl font-bold">Current event for this phone</h2>
      <p class="font-bold">Station: {props.status?.station?.label || "Unavailable"}</p>
      <div aria-live="polite" class="space-y-2">
        <Show when={catalogue.loading || props.verifying}><p role="status">Refreshing this phone's event context…</p></Show>
        <Show when={catalogue.error}><p role="alert" class="alert alert-error">Event catalogue unavailable. Any previously selected event below is unverified, not ready for new work.</p></Show>
        <Show when={error()}><p role="alert" class="alert alert-error">{error()} Refresh the catalogue and review the current event before choosing again.</p></Show>
        <Show when={message()}><p role="status">{message()}</p></Show>
        <Show when={catalogue()?.selected} fallback={<p class="text-lg font-bold">{!catalogue() || catalogue.error || catalogue.loading ? "Current event not yet verified" : "No event selected"}</p>}>{(selected) => (
          <div class="space-y-1">
            <p class="text-lg font-bold">Current event: {selected().title}</p>
            <p>Event ID {selected().id} · Configuration generation {selected().generation}</p>
            <p class="font-medium">{availabilityMessages[selected().availability]}</p>
          </div>
        )}</Show>
        <Show when={!contextAvailable()} fallback={<p>Event context verified for this phone. Admission and printing remain disabled.</p>}>
          <p role="status" class="alert alert-warning">Event context unavailable. A stale, disabled or unverified selection cannot authorize new work. Refresh and select an available event explicitly.</p>
        </Show>
      </div>
      <button type="button" class="btn btn-outline min-h-12" disabled={pending() || catalogue.loading} onClick={() => void refresh()}>Refresh event catalogue</button>
      <Show when={!catalogue.error && catalogue()}>{(data) => (
        <>
          <Show when={data().state !== "complete"}><p role="status" class="alert alert-warning">Event catalogue is {data().state}. Missing events are not an empty catalogue. Unverified entries cannot be selected.</p></Show>
          <Show when={data().state === "complete" && data().events.length === 0}><p>No WTS 2026 events are configured for this account. Ask an admin to confirm edition membership.</p></Show>
          <form method="post" action="/api/checkin-events" class="min-w-0 space-y-3" onSubmit={(event) => void select(event)}>
            <label for="phone-checkin-event" class="block font-medium">Event for this phone</label>
            <select id="phone-checkin-event" class="select select-bordered min-h-12 w-full min-w-0 max-w-full text-base" required disabled={!verified()} value={choice()} onChange={(event) => { setChoice(event.currentTarget.value); setMessage(""); }} aria-describedby="phone-event-help">
              <option value="">Choose an event explicitly</option>
              <For each={data().events}>{(entry) => <option value={entry.id} disabled={entry.availability !== "available"}>{entry.title} · ID {entry.id} · {availabilityMessages[entry.availability]}</option>}</For>
            </select>
            <p id="phone-event-help" class="text-sm">Changing this phone's event does not change another phone or retarget already accepted work. Unavailable events are listed with their reasons.</p>
            <Show when={chosen()}>{(event) => <p>Proposed event: {event().title} · ID {event().id} · {availabilityMessages[event().availability]}</p>}</Show>
            <button type="submit" class="btn btn-primary min-h-12" disabled={!verified() || chosen()?.availability !== "available"}>{pending() ? "Saving this phone's event…" : "Select event for this phone"}</button>
          </form>
        </>
      )}</Show>
      <p class="font-bold text-warning">Not ready for event use. No admission, scanning or printing is enabled.</p>
    </section>
    <CheckinArrivalPreflight context={contextAvailable() ? catalogue()?.context ?? null : null} eventTitle={catalogue()?.selected?.title ?? ""} stationLabel={props.status?.station?.label ?? ""} verifying={props.verifying} bindingScope={props.status?.bindingState === "bound" && props.status.binding && !props.status.binding.revoked ? `${props.status.binding.id}:${props.status.binding.version}:${props.status.station?.id}` : undefined} />
    <CheckinArrivalWork unavailable={props.verifying} stationKey={props.status?.bindingState === "bound" && props.status.binding && !props.status.binding.revoked ? `${props.status.binding.id}:${props.status.binding.version}` : undefined} />
    </>
  );
}
