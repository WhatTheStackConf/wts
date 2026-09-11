import { For, Show, createSignal, onSettled } from "solid-js";
import { createAsyncResource } from "~/lib/async-resource";
import { CHECKIN_NOTE_MAX_LENGTH, CHECKIN_REASON_CODES, type CheckinReasonCode } from "~/lib/checkin-contract";
import { CheckinEventRequestError, checkinAdminEventCatalogue, checkinAdminEventOptions, configureCheckinEvent } from "~/lib/checkin-event-client";
import type { CheckinConfigureEvent } from "~/lib/checkin-event-contract";

type EventDraft = Omit<CheckinConfigureEvent, "operationId" | "reason" | "note">;

export function CheckinEventAdmin() {
  const [catalogue, catalogueActions] = createAsyncResource(checkinAdminEventCatalogue);
  const [draft, setDraft] = createSignal<EventDraft>();
  const [options, optionActions] = createAsyncResource(() => draft()?.upstreamEventId || undefined, async (id) => ({ id, data: await checkinAdminEventOptions(id) }));
  const [reviewing, setReviewing] = createSignal(false);
  const [reason, setReason] = createSignal<CheckinReasonCode | "">("");
  const [note, setNote] = createSignal("");
  const [frozen, setFrozen] = createSignal<CheckinConfigureEvent>();
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");
  const [message, setMessage] = createSignal("");
  let reasonInput: HTMLSelectElement | undefined;
  const availableOptions = () => !options.error && !options.loading && options()?.id === draft()?.upstreamEventId ? options()?.data : undefined;
  const sourceAvailable = () => !catalogue.error && !catalogue.loading && !catalogue()?.sourceMismatch && catalogue()?.events.some((entry) => entry.upstreamEventId === draft()?.upstreamEventId && entry.upstreamAvailable);
  const selectedQuestion = () => availableOptions()?.questions.find((question) => question.id === draft()?.affiliation?.questionId);
  const productApplies = (id: string) => {
    const question = selectedQuestion();
    return !!question && (question.productIds.length === 0 || question.productIds.includes(id));
  };
  const canReview = () => {
    const current = draft();
    const loaded = availableOptions();
    if (!sourceAvailable() || !current || loaded?.state !== "complete") return false;
    if (current.enabled && (!current.member || !current.listId)) return false;
    if (current.listId && !loaded.lists.some((list) => list.id === current.listId)) return false;
    return !current.affiliation || (!!selectedQuestion() && current.affiliation.productIds.every((id) => productApplies(id) && loaded.products.some((product) => product.id === id)));
  };

  function choose(id: string) {
    if (frozen() || pending()) return;
    const entry = catalogue()?.events.find((event) => event.upstreamEventId === id);
    const config = entry?.configuration;
    setDraft(entry ? {
      upstreamEventId: entry.upstreamEventId,
      expectedGeneration: config?.generation ?? 0,
      member: config?.member ?? false,
      enabled: config?.enabled ?? false,
      listId: config?.listId ?? "",
      affiliation: config?.affiliation ? { questionId: config.affiliation.questionId, productIds: [...config.affiliation.productIds] } : null,
    } : undefined);
    setReviewing(false); setReason(""); setNote(""); setError(""); setMessage("");
  }
  function update(change: Partial<EventDraft>) {
    if (!frozen() && !reviewing()) setDraft((current) => current ? { ...current, ...change } : undefined);
  }
  async function refresh() {
    await catalogueActions.refetch().catch(() => undefined);
    if (draft()) await optionActions.refetch().catch(() => undefined);
  }
  onSettled(() => {
    const focus = () => { if (!pending()) void refresh(); };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  });
  async function confirm(event: SubmitEvent) {
    event.preventDefault();
    if (pending()) return;
    const current = draft();
    const selectedReason = reason();
    if (!frozen() && (!current || !selectedReason || !canReview())) return;
    const command = frozen() ?? { ...current!, operationId: crypto.randomUUID(), reason: selectedReason as CheckinReasonCode, note: note() };
    // Retain the exact payload, including the reason/note and UUID, until an
    // authoritative response resolves it. A retry is never a new intention.
    setFrozen(command); setPending(true); setError(""); setMessage("");
    try {
      const result = await configureCheckinEvent(command);
      setFrozen(undefined); setReviewing(false); setDraft(undefined);
      setMessage(result.replayed ? "This event configuration was already saved; no action was repeated." : "Event configuration saved. Supervised admission and printing require current station readiness.");
      await catalogueActions.refetch().catch(() => undefined);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to confirm event configuration.");
      if (failure instanceof CheckinEventRequestError && !failure.ambiguous) {
        setFrozen(undefined); setReviewing(false);
        // Do not silently adopt a newer generation into the rejected draft.
        // Reloading the event explicitly is required before a new intention.
        setDraft(undefined);
        await catalogueActions.refetch().catch(() => undefined);
      }
    } finally { setPending(false); }
  }

  return (
    <section aria-label="Event configuration" class="min-w-0 rounded-lg border border-base-content/20 bg-base-200 p-5 space-y-4 break-words">
      <h2 class="text-2xl font-bold">WTS 2026 event configuration</h2>
      <p>Discover events from the authorized Hi.Events account. Explicitly mark edition membership and select an exact admission list; titles never determine membership. Selection later belongs to each phone, not its station.</p>
      <div aria-live="polite" class="space-y-2">
        <Show when={catalogue.loading}><p role="status">Loading event catalogue…</p></Show>
        <Show when={catalogue.error}><p role="alert" class="alert alert-error">Event catalogue unavailable. Previously displayed events are not verified; this is not an empty catalogue.</p></Show>
        <Show when={error()}><p role="alert" class="alert alert-error">{error()}</p></Show>
        <Show when={message()}><p role="status" class="alert alert-success">{message()}</p></Show>
      </div>
      <button type="button" class="btn btn-outline min-h-12" disabled={pending() || catalogue.loading || options.loading} onClick={() => void refresh()}>Refresh event catalogue</button>
      <Show when={!catalogue.error && catalogue()}>{(data) => (
        <>
          <Show when={data().state !== "complete"}><p role="status" class="alert alert-warning">Event discovery is {data().state}. Missing events are not evidence of an empty account. Retry the event catalogue.</p></Show>
          <Show when={data().sourceMismatch}><p role="alert" class="alert alert-error">The configured Hi.Events source changed or is absent. Existing event references cannot be retargeted. Ask an administrator to restore the expected source.</p></Show>
          <Show when={data().state === "complete" && data().events.length === 0}><p>No events were found in the authorized Hi.Events account.</p></Show>
          <label for="admin-checkin-event" class="block font-medium">Hi.Events event</label>
          <select id="admin-checkin-event" class="select select-bordered min-h-12 w-full min-w-0 max-w-full text-base" value={draft()?.upstreamEventId ?? ""} disabled={pending() || !!frozen() || catalogue.loading || data().sourceMismatch} onChange={(event) => choose(event.currentTarget.value)}>
            <option value="">Choose an event to configure</option>
            <For each={data().events}>{(entry) => <option value={entry.upstreamEventId}>{entry.title} · ID {entry.upstreamEventId}{entry.upstreamAvailable ? "" : " · upstream unavailable"}</option>}</For>
          </select>
        </>
      )}</Show>
      <Show when={draft()}>{(current) => (
        <>
          <p class="font-bold">Event ID: {current().upstreamEventId} · Expected configuration generation: {current().expectedGeneration}</p>
          <Show when={!sourceAvailable()}><p role="status" class="alert alert-warning">This event's upstream source is not currently verified. Configuration cannot be changed until it is available.</p></Show>
          <Show when={options.loading}><p role="status">Loading admission lists, affiliation questions and products…</p></Show>
          <Show when={options.error}><p role="alert" class="alert alert-error">Event options unavailable. This does not mean the event has no lists, questions or products.</p></Show>
          <Show when={options.error || availableOptions()?.state !== "complete"}>
            <button type="button" class="btn btn-outline min-h-12" disabled={pending() || options.loading} onClick={() => void optionActions.refetch().catch(() => undefined)}>Retry event options</button>
          </Show>
          <Show when={availableOptions()}>{(loaded) => (
            <>
              <Show when={loaded().state !== "complete"}><p class="alert alert-warning" role="status">Event options are {loaded().state}. Saving is unavailable until the full list, question and product catalogue is verified.</p></Show>
              <form method="post" action="/api/checkin-events" class="space-y-4" onSubmit={(event) => { event.preventDefault(); if (!canReview()) return; setReviewing(true); setError(""); requestAnimationFrame(() => { reasonInput?.focus(); reasonInput?.scrollIntoView({ block: "center" }); }); }}>
                <fieldset class="min-w-0 space-y-4" disabled={pending() || reviewing() || !!frozen() || !sourceAvailable() || loaded().state !== "complete"}>
                  <legend class="font-bold">Edition membership and admission mapping</legend>
                  <label class="flex items-start gap-3"><input type="checkbox" class="checkbox" checked={current().member} onChange={(event) => update({ member: event.currentTarget.checked })} /><span>This event belongs to WTS 2026</span></label>
                  <label for="checkin-event-list" class="block font-medium">Admission list (required when enabled)</label>
                  <select id="checkin-event-list" class="select select-bordered min-h-12 w-full min-w-0 max-w-full text-base" required={current().enabled} value={current().listId} onChange={(event) => update({ listId: event.currentTarget.value })}>
                    <option value="">No admission list — event remains unconfigured</option>
                    <Show when={current().listId && !loaded().lists.some((list) => list.id === current().listId)}><option value={current().listId} disabled>Unavailable list · ID {current().listId}</option></Show>
                    <For each={loaded().lists}>{(list) => <option value={list.id}>{list.title} · ID {list.id}</option>}</For>
                  </select>
                  <Show when={loaded().state === "complete" && loaded().lists.length === 0}><p>No admission lists exist for this event. Configure one upstream and retry.</p></Show>
                  <label for="checkin-event-question" class="block font-medium">Affiliation question (optional)</label>
                  <select id="checkin-event-question" class="select select-bordered min-h-12 w-full min-w-0 max-w-full text-base" value={current().affiliation?.questionId ?? ""} onChange={(event) => update({ affiliation: event.currentTarget.value ? { questionId: event.currentTarget.value, productIds: [] } : null })}>
                    <option value="">No affiliation mapping — leave row two blank</option>
                    <Show when={current().affiliation && !loaded().questions.some((question) => question.id === current().affiliation?.questionId)}><option value={current().affiliation?.questionId} disabled>Unavailable question · ID {current().affiliation?.questionId}</option></Show>
                    <For each={loaded().questions}>{(question) => <option value={question.id}>{question.title} · ID {question.id}</option>}</For>
                  </select>
                  <Show when={current().affiliation}>
                    <fieldset class="min-w-0 space-y-3">
                      <legend class="font-medium">Affiliation product scope (optional)</legend>
                      <p class="text-sm">No products selected means no additional product restriction. Products outside this question's scope are unavailable.</p>
                      <For each={loaded().products}>{(product) => (
                        <label class="flex items-start gap-3"><input type="checkbox" class="checkbox" disabled={!productApplies(product.id)} checked={current().affiliation?.productIds.includes(product.id) ?? false} onChange={(event) => {
                          const affiliation = current().affiliation;
                          if (affiliation) update({ affiliation: { ...affiliation, productIds: event.currentTarget.checked ? [...affiliation.productIds, product.id] : affiliation.productIds.filter((id) => id !== product.id) } });
                        }} /><span>{product.title} · ID {product.id}{productApplies(product.id) ? "" : " · Not in this question's scope"}</span></label>
                      )}</For>
                      <For each={current().affiliation?.productIds.filter((id) => !loaded().products.some((product) => product.id === id))}>{(id) => <p class="text-warning">Unavailable configured product · ID {id}. Choose the affiliation question again to reset its scope.</p>}</For>
                    </fieldset>
                  </Show>
                  <label class="flex items-start gap-3"><input type="checkbox" class="checkbox" checked={current().enabled} onChange={(event) => update({ enabled: event.currentTarget.checked })} /><span>Enable this event configuration</span></label>
                  <p class="text-sm">This does not enable admission or printing. Existing work retains its original event/list snapshot.</p>
                  <Show when={!canReview()}><p role="status" class="text-warning">Review unavailable: an enabled event requires WTS 2026 membership and an available admission list. Any configured question and product IDs must also be available. You can save membership without a list by leaving the event disabled.</p></Show>
                  <button type="submit" class="btn btn-outline min-h-12" disabled={!canReview()}>Review event configuration</button>
                </fieldset>
              </form>
            </>
          )}</Show>
          <Show when={reviewing()}>
            <form method="post" action="/api/checkin-events" aria-label="Confirm event configuration" class="min-w-0 rounded-lg border-2 border-warning p-4 space-y-4" onSubmit={(event) => void confirm(event)}>
              <h3 class="text-xl font-bold">Confirm event configuration</h3>
              <p>Event ID {current().upstreamEventId} · List ID {current().listId || "None (unconfigured)"} · WTS 2026 member: {current().member ? "yes" : "no"} · Enabled: {current().enabled ? "yes" : "no"} · Expected generation {current().expectedGeneration}</p>
              <p>Affiliation question: {current().affiliation?.questionId || "None"} · Product scope: {current().affiliation?.productIds.join(", ") || "No additional restriction"}</p>
              <label for="event-control-reason" class="block font-medium">Reason (required)</label>
              <select ref={(element) => { reasonInput = element; }} id="event-control-reason" class="select select-bordered min-h-12 w-full min-w-0 text-base" required disabled={pending() || !!frozen()} value={reason()} onChange={(event) => setReason(event.currentTarget.value as CheckinReasonCode | "")}>
                <option value="">Choose a reason</option>
                <For each={CHECKIN_REASON_CODES}>{(value) => <option value={value}>{value.replaceAll("_", " ")}</option>}</For>
              </select>
              <label for="event-control-note" class="block font-medium">Note (optional)</label>
              <textarea id="event-control-note" class="textarea textarea-bordered w-full text-base" maxlength={CHECKIN_NOTE_MAX_LENGTH} disabled={pending() || !!frozen()} value={note()} onInput={(event) => setNote(event.currentTarget.value)} aria-describedby="event-note-help" />
              <p id="event-note-help" class="text-sm">Up to 240 characters. No personal data, email, QR codes, credentials, URLs or raw diagnostics.</p>
              <Show when={frozen()}><p class="alert alert-warning" role="status">This submitted command is frozen. If the response was lost, retry the same action to resolve its outcome; do not submit a replacement.</p></Show>
              <div class="flex flex-wrap gap-3">
                <button type="submit" class="btn btn-warning min-h-12" disabled={pending() || (!frozen() && !canReview())}>{pending() ? "Saving event configuration…" : frozen() ? "Retry same event configuration" : "Confirm event configuration"}</button>
                <button type="button" class="btn btn-ghost min-h-12" disabled={pending() || !!frozen()} onClick={() => setReviewing(false)}>Cancel event change</button>
              </div>
            </form>
          </Show>
        </>
      )}</Show>
    </section>
  );
}
