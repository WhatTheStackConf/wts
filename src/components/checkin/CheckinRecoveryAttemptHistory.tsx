import { For, Show, createSignal, onCleanup } from "solid-js";
import type { RecoveryAttemptHistory } from "~/lib/checkin-recovery-client-contract";
import { RecoveryRequestError, recoveryAttemptHistory } from "~/lib/checkin-recovery-client";

/** Mount keyed to workflow and authority scope. Reads never touch the mutation slot. */
export function CheckinRecoveryAttemptHistory(props: { workflowId: string; onDenied: () => void }) {
  const workflowId = props.workflowId;
  let live = true, generation = 0;
  const [page, setPage] = createSignal<RecoveryAttemptHistory>();
  const [offset, setOffset] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  onCleanup(() => { live = false; generation++; });
  async function load(next = 0) {
    const current = ++generation; setLoading(true); setError(""); setPage(undefined);
    try {
      const value = await recoveryAttemptHistory(workflowId, next);
      if (live && current === generation) { setPage(value); setOffset(next); }
    } catch (error) {
      if (!live) return;
      if (error instanceof RecoveryRequestError && error.denied) { generation++; setPage(undefined); props.onDenied(); }
      else if (current === generation) setError("Attempt history unavailable. This is not an empty history. Saved command retry is unchanged.");
    } finally { if (live && current === generation) setLoading(false); }
  }
  return <section aria-label="Paginated label attempt history">
    <p>Browse immutable label attempts from oldest to newest, at most 25 per page. This does not limit replacements.</p>
    <button class="btn min-h-12" disabled={loading()} onClick={() => void load()}>Load first attempt page</button>
    <Show when={loading()}><p role="status">Loading label attempts…</p></Show>
    <Show when={error()}><p role="alert">{error()}</p></Show>
    <Show when={page()}>{data => <>
      <p>Attempt page starting at {offset() + 1}. {data().nextOffset === null ? "End of history at this read." : "More attempts available."}</p>
      <ol start={offset() + 1}><For each={data().items}>{a => <li class="py-2">{a.id} · {a.purpose} · {a.state} · {a.name} / {a.affiliation || "blank affiliation"} · {a.observation || "no observation"} · predecessor {a.predecessorId || "none"}</li>}</For></ol>
      <Show when={!data().items.length}><p>No attempts on this page.</p></Show>
      <button class="btn min-h-12" disabled={loading() || offset() === 0} onClick={() => void load(Math.max(0, offset() - 25))}>Previous attempt page</button>
      <button class="btn min-h-12" disabled={loading() || data().nextOffset === null} onClick={() => void load(data().nextOffset!)}>Next attempt page</button>
    </>}</Show>
  </section>;
}
