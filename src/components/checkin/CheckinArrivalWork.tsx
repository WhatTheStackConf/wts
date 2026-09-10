import { For, Show, createSignal } from "solid-js";
import { createAsyncResource } from "~/lib/async-resource";
import { checkinArrivalHistory } from "~/lib/checkin-arrival-client";
import { ArrivalDecision } from "~/components/checkin/CheckinArrivalPreflight";

interface CheckinArrivalWorkProps {
  /** Bound client identity/version, not the phone's mutable event selection. */
  stationKey?: string;
  allStations?: boolean;
  unavailable?: boolean;
}
export function CheckinArrivalWork(props: CheckinArrivalWorkProps) {
  const key = () => props.allStations ? "all" : props.stationKey;
  const [pagination, setPagination] = createSignal<{ key: string | undefined; pages: string[] }>({ key: undefined, pages: [] });
  const pages = () => pagination().key === key() ? pagination().pages : [];
  const setPages = (next: string[] | ((current: string[]) => string[])) => setPagination({ key: key(), pages: typeof next === "function" ? next(pages()) : next });
  const cursor = () => pages().at(-1);
  const [data, actions] = createAsyncResource(() => key() ? `${key()}:${cursor() ?? ""}` : undefined, () => checkinArrivalHistory({ scope: props.allStations ? "all" : "station", ...(cursor() ? { cursor: cursor() } : {}), limit: 30 }));
  // The server may return command history for multiple attempts at one workflow.
  // Render that work once per page without hiding non-workflow decisions.
  const items = () => {
    const seen = new Set<string>();
    return (data()?.items ?? []).filter((item) => {
      const decision = item.result;
      const id = "workflow" in decision ? `work:${decision.workflow.id}` : `command:${item.id}`;
      if (seen.has(id)) return false;
      seen.add(id); return true;
    });
  };
  function refresh() {
    if (pages().length) setPages([]);
    else void actions.refetch().catch(() => undefined);
  }
  return <section aria-label={props.allStations ? "All-station arrival work" : "Station arrival work"} class="rounded-lg border border-base-content/20 bg-base-200 p-5 space-y-4 break-words">
    <h2 class="text-xl font-bold">{props.allStations ? "All-station arrival work" : "Station arrival work"}</h2>
    <p>All unresolved work, including earlier days, and current-day completed history. Work stays at its originating station and event; changing this phone's event never retargets it.</p>
    <button type="button" class="btn btn-outline min-h-12" disabled={!key() || data.loading} onClick={refresh}>Refresh arrival work</button>
    <div aria-live="polite" class="space-y-3">
      <Show when={!key()}><p>Verify this phone's station binding to read its arrival work.</p></Show>
      <Show when={data.loading}><p role="status">Loading arrival work…</p></Show>
      <Show when={data.error}><p role="alert" class="alert alert-error">Arrival work is unavailable. Refresh explicitly; this is not an empty queue.</p></Show>
      <Show when={!!key() && !props.unavailable && !data.error && !data.loading && data()}>{(current) => <>
        <p>Completed-history day: {current().day} (Europe/Skopje). Unresolved work has no day cutoff.</p>
        <Show when={!items().length}><p>No arrival work on this page.</p></Show>
        <ul class="space-y-3"><For each={items()}>{(item) => <li class="border border-base-content/20 rounded-lg p-4 space-y-2">
          <p class="font-bold">Station {item.stationId} · Event ID {item.eventId}</p>
          <p>{item.completedAt ? `Completed ${item.completedAt}` : `Unresolved · Created ${item.createdAt}`}</p>
          <Show when={item.resolvedByOperationId} fallback={<ArrivalDecision decision={item.result} />}>{(operationId) => <>
            <p class="font-bold">Resolved preflight exception</p>
            <p>A later continuation completed this preflight. The earlier failed-read result is retained for audit, not waiting for another choice.</p>
            <p class="text-sm break-all">Continuation {operationId()}</p>
          </>}</Show>
        </li>}</For></ul>
      </>}</Show>
    </div>
    <div class="flex flex-wrap gap-3">
      <button type="button" class="btn btn-outline min-h-12" disabled={!pages().length || data.loading || !key()} onClick={() => setPages((current) => current.slice(0, -1))}>Previous arrival work</button>
      <button type="button" class="btn btn-outline min-h-12" disabled={!data()?.nextCursor || data.loading || !!data.error || !key()} onClick={() => { const next = data()?.nextCursor; if (next) setPages((current) => [...current, next]); }}>Next arrival work</button>
    </div>
  </section>;
}
