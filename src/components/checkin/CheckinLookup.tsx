import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { createAsyncResource } from "~/lib/async-resource";
import { CheckinLookupRequestError, confirmCheckinLookup, searchCheckinLookup, sameLookupContext, getCheckinLookupRecovery, recoverCheckinLookup } from "~/lib/checkin-lookup-client";
import { persistLookupHold, readLookupHold, releaseLookupHold, type LookupHeldRecovery } from "~/lib/checkin-lookup-held";
import type { CheckinLookupConfirmInput, CheckinLookupSearchInput, CheckinLookupSearchResult } from "~/lib/checkin-lookup-contract";
import type { CheckinArrivalResult } from "~/lib/checkin-arrival-contract";
import type { CheckinEventContext } from "~/lib/checkin-event-contract";

import type { CheckinLookupRecovery, CheckinLookupRecoverInput } from "~/lib/checkin-lookup-recovery-contract";

type Attendee = CheckinLookupSearchResult["items"][number];
export interface CheckinLookupProps {
  /** Primary manual mode: browse the roster and submit directly from a row. */
  manual?: boolean;
  visible?: boolean;
  /** An explicit parent action opens lookup without a second activation tap. */
  openRequest?: number;
  onClose?: () => void;
  context: CheckinEventContext | null;
  eventTitle: string;
  stationLabel: string;
  /** Stable verified human + binding identity, NOT the mutable event resource. */
  bindingScope?: string;
  /** Explicit false plus bindingScope permits exact retry while context is absent.
   * Omitted is conservative: current ready context is required. After access denial
   * the parent must complete a verifying true → false cycle before retry. */
  verifying?: boolean;
  ready: boolean;
  disabled?: boolean;
  onDecision(result: CheckinArrivalResult): void;
  /** Remains true across unknown outcomes/unmount: parent must gate all intake. */
  onBusy?(busy: boolean): void;
  /** Optional integration override. The default uses authenticated opaque server
   * recovery. Overrides must only reconcile authoritative final outcomes after
   * durable handoff, never failed-read choices or mere HTTP success. */
  onRecoverHeld?(operationId: string): Promise<LookupHeldRecovery>;
}
/** Private display/read state and the immutable sent intent have separate lives. */
export function CheckinLookup(props: CheckinLookupProps) {
  const [active, setActive] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [submitted, setSubmitted] = createSignal<CheckinLookupSearchInput>();
  const [selected, setSelected] = createSignal<Attendee>();
  const [pending, setPending] = createSignal(false);
  const [command, setCommand] = createSignal<CheckinLookupConfirmInput>();
  const [held, setHeld] = createSignal<string>();
  const [recovery, setRecovery] = createSignal<CheckinLookupRecovery>();
  const [recoveryCommand, setRecoveryCommand] = createSignal<{ input: CheckinLookupRecoverInput; context: CheckinEventContext }>();
  const [readState, setReadState] = createSignal<"needs_affiliation_choice" | "dependency_unavailable">();
  const [error, setError] = createSignal("");
  const [unknown, setUnknown] = createSignal(false);
  const [accessDenied, setAccessDenied] = createSignal(false);
  const [storageBlocked, setStorageBlocked] = createSignal(false);
  let epoch = 0;
  let authorityEpoch = 0;
  let destroyed = false;
  let sending = false;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  const [previousOffsets, setPreviousOffsets] = createSignal<number[]>([]);
  let scope = "";
  let verifyingSeen = false;
  let feedback: HTMLElement | undefined;
  const bindingKey = () => props.bindingScope || (props.context ? JSON.stringify([props.context.bindingId, props.context.bindingVersion, props.context.stationId]) : "");
  const verified = () => !props.verifying && !accessDenied() && !!bindingKey() && scope === bindingKey();
  // Browsing is a read: a transient printer heartbeat must not erase the
  // roster or cancel a name/email query. Physical readiness gates printing only.
  const authorized = () => active() && props.visible !== false && verified() && !!props.context && !props.disabled;
  const canPrint = () => authorized() && props.ready;
  const canReplay = () => active() && verified() && (props.verifying === false && !!props.bindingScope || !!props.context && props.ready && !props.disabled && !!command() && sameLookupContext(command()!.context, props.context));
  createEffect(() => JSON.stringify([bindingKey(), props.verifying]), () => { authorityEpoch++; });
  const currentAuthority = (generation: number, authority: string) => !destroyed && generation === authorityEpoch && !props.verifying && !accessDenied() && authority === bindingKey();
  const focusFeedback = () => { if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(() => { if (!destroyed) feedback?.focus(); }); };
  function clearPrivate() { setQuery(""); setSubmitted(undefined); setSelected(undefined); setPreviousOffsets([]); }
  function redact() { epoch++; clearPrivate(); }
  function classify(failure: unknown) {
    if (failure instanceof CheckinLookupRequestError && (failure.kind === "access" || failure.kind === "context")) {
      redact(); setRecovery(undefined);
      if (failure.kind === "access") setAccessDenied(true);
    }
    setError(failure instanceof CheckinLookupRequestError ? failure.message : "Lookup unavailable. Retry the same request.");
  }
  // Invalidation precedes resource initialization; edits do not issue searches.
  createEffect(() => JSON.stringify([bindingKey(), props.context, props.disabled, props.verifying]), () => {
    redact();
    if (props.verifying || scope && scope !== bindingKey()) setRecovery(undefined);
    if (props.verifying) verifyingSeen = true;
    else if (verifyingSeen) { verifyingSeen = false; setAccessDenied(false); }
    if (active() && !command() && !held() && scope !== bindingKey()) { setActive(false); props.onBusy?.(false); }
  });
  const [results] = createAsyncResource(() => authorized() && !command() ? submitted() : undefined, async input => {
    const generation = epoch;
    try {
      const outcome = await searchCheckinLookup(input);
      if (generation !== epoch || destroyed) return undefined;
      if (outcome.state !== "complete") throw new CheckinLookupRequestError("Lookup is incomplete or unavailable. No results can be selected. Retry your search.", false, "transport");
      if (!props.manual) focusFeedback();
      return outcome;
    } catch (failure) {
      if (generation === epoch && !destroyed) { classify(failure); focusFeedback(); }
      return undefined;
    }
  });
  createEffect(() => true, () => {
    try { const reference = readLookupHold(); if (reference) { setHeld(reference); setActive(true); props.onBusy?.(true); } }
    catch { setStorageBlocked(true); setActive(true); props.onBusy?.(true); setError("Held-operation storage is unavailable. Restore it before starting lookup."); }
  });
  onCleanup(() => {
    destroyed = true; epoch++;
    if (searchTimer) clearTimeout(searchTimer);
    // No signal/parent writes during Solid 2 disposal.
    const authority = bindingKey();
    if (!command() && !held() && !storageBlocked()) queueMicrotask(() => { if (authority === bindingKey()) props.onBusy?.(false); });
  });
  createEffect(() => props.openRequest, request => { if (request) open(); });
  createEffect(() => JSON.stringify([props.manual, props.visible, props.context, props.disabled, props.verifying, bindingKey(), accessDenied(), command(), held()]), () => {
    // Wait for the invalidation effect's transactional clears to commit before
    // inspecting submitted intent. Recheck live authority after the microtask.
    queueMicrotask(() => {
      if (destroyed || !props.manual || props.visible === false || !props.context || props.disabled || props.verifying || accessDenied() || storageBlocked() || command() || held()) return;
      scope = bindingKey(); setActive(true);
      if (!submitted()) setSubmitted({ context: structuredClone(props.context), query: "", offset: 0 });
    });
  });
  function exit() {
    if (command() || held() || pending() || storageBlocked()) return;
    redact(); setError(""); setActive(false); props.onBusy?.(false);
    props.onClose?.();
  }
  function open() {
    if (!props.context || props.disabled || props.verifying || accessDenied() || storageBlocked() || held()) return;
    scope = bindingKey(); setActive(true); if (!props.manual) props.onBusy?.(true);
  }
  function edit(value: string) {
    if (command() || held()) return;
    if (props.manual) { setQuery(value); setError(""); return; }
    redact(); setQuery(value); setError("");
  }
  createEffect(() => JSON.stringify([props.manual, query(), authorized(), results.loading, !!command(), !!held(), submitted()?.query]), () => {
    if (searchTimer) clearTimeout(searchTimer);
    if (!props.manual || !authorized() || results.loading || command() || held() || query().trim() === submitted()?.query) return;
    searchTimer = setTimeout(() => { if (!destroyed) search(0, query()); }, 350);
  });
  function search(offset = 0, text = query(), history: number[] = []) {
    const context = props.context;
    if (!authorized() || !context || command() || held() || results.loading || !props.manual && text.trim().length < 2) return;
    epoch++; setSelected(undefined); setError("");
    setPreviousOffsets(history);
    setSubmitted({ context: structuredClone(context), query: text, offset });
  }
  function select(item: Attendee) {
    if (!authorized() || results.loading || command() || !results()?.items.includes(item)) return;
    setSelected(item); setError(""); focusFeedback();
  }
  async function send(frozen: CheckinLookupConfirmInput, initial = false) {
    if (sending || pending() || !(initial ? canPrint() : canReplay())) return;
    try { persistLookupHold(frozen.operationId, frozen.priorOperationId); }
    catch { setError("Could not retain operation reference. Confirmation was not sent; restore browser storage and retry."); return; }
    const generation = epoch;
    sending = true; props.onBusy?.(true);
    setHeld(frozen.operationId); setCommand(frozen); setPending(true); setUnknown(true); setReadState(undefined); setError("");
    try {
      const outcome = await confirmCheckinLookup(frozen);
      // Context/authority loss may hide a valid reply but never forgets the intent.
      if (destroyed || generation !== epoch || !verified()) return;
      setUnknown(false); clearPrivate();
      if (outcome.state === "needs_affiliation_choice" || outcome.state === "dependency_unavailable") {
        setReadState(outcome.state); return;
      }
      props.onDecision(outcome); // Persist receiving queue before releasing this hold.
      releaseLookupHold(frozen.operationId);
      setHeld(undefined); setCommand(undefined); setActive(false); props.onBusy?.(false);
    } catch (failure) {
      if (destroyed) return;
      // Access errors redact even with unchanged props. Every failed confirmation
      // is ambiguous; a later rejection cannot disprove an earlier commit.
      setUnknown(true);
      if (scope === bindingKey()) classify(failure);
    } finally { sending = false; if (!destroyed) { setPending(false); focusFeedback(); } }
  }
  function confirm(person = selected()) {
    const context = props.context;
    if (!authorized() || !person || !context || sending || pending() || results.loading || command() || held() || !results()?.items.includes(person) || person.status === "CANCELLED" || person.status === "AWAITING_PAYMENT") return;
    const frozen = { operationId: crypto.randomUUID(), context: Object.freeze(structuredClone(context)), attendeeId: person.attendeeId, qrIdentity: person.publicId, affiliationChoice: "fetch" as const };
    void send(Object.freeze(frozen), true);
  }
  function continueRead(choice: "fetch" | "blank") {
    const prior = command();
    if (!prior || !readState() || unknown() || pending() || !canReplay() || choice === "blank" && readState() !== "needs_affiliation_choice") return;
    void send(Object.freeze({ ...prior, operationId: crypto.randomUUID(), priorOperationId: prior.operationId, affiliationChoice: choice }));
  }
  async function recoverHeld() {
    const reference = held();
    if (!reference || command() || pending() || accessDenied() || props.verifying !== false || !props.bindingScope) return;
    const authority = bindingKey(), generation = authorityEpoch; setPending(true); setError("");
    try {
      if (props.onRecoverHeld) {
        const outcome = await props.onRecoverHeld(reference);
        if (!currentAuthority(generation, authority)) return;
        if (outcome.state !== "reconciled" || outcome.operationId !== reference) { setError("Operation remains held. Complete authenticated recovery before new intake."); return; }
        releaseLookupHold(reference); setHeld(undefined); setActive(false); props.onBusy?.(false);
        return;
      }
      const descriptor = await getCheckinLookupRecovery(reference);
      if (!currentAuthority(generation, authority)) return;
      scope = authority; setRecovery(descriptor);
      if (descriptor.result) settleRecovery(descriptor.result);
    } catch (failure) { if (currentAuthority(generation, authority)) classify(failure); }
    finally { if (!destroyed) setPending(false); }
  }
  function settleRecovery(outcome: CheckinArrivalResult) {
    setUnknown(false);
    if (outcome.state === "needs_affiliation_choice" || outcome.state === "dependency_unavailable") return;
    props.onDecision(outcome);
    releaseLookupHold(outcome.operationId);
    setHeld(undefined); setRecovery(undefined); setRecoveryCommand(undefined); setActive(false); props.onBusy?.(false);
  }
  async function sendRecovery(frozen: { input: CheckinLookupRecoverInput; context: CheckinEventContext }) {
    if (pending() || !verified()) return;
    const nextId = frozen.input.action === "replay" ? frozen.input.operationId : frozen.input.nextOperationId;
    try { persistLookupHold(nextId, frozen.input.operationId); }
    catch { setError("Could not retain recovery reference. Nothing was sent."); return; }
    // Catalogue/readiness arrival after reload is not an authority change. The
    // opaque command already carries the server's immutable original context.
    const authority = bindingKey(), generation = authorityEpoch;
    setHeld(nextId); setRecoveryCommand(frozen); setRecovery(undefined); setPending(true); setUnknown(true); setError("");
    try {
      const outcome = await recoverCheckinLookup(frozen.input, frozen.context);
      if (!currentAuthority(generation, authority) || !verified()) return;
      settleRecovery(outcome);
      if (held()) {
        setRecoveryCommand(undefined);
        const descriptor = await getCheckinLookupRecovery(nextId);
        if (currentAuthority(generation, authority) && verified()) setRecovery(descriptor);
      }
    } catch (failure) { if (currentAuthority(generation, authority)) { setUnknown(true); classify(failure); } }
    finally { if (!destroyed) setPending(false); }
  }
  function continueOpaque(action: "replay" | "retry" | "blank") {
    const descriptor = recovery();
    if (!descriptor || descriptor.recovery !== "available" || !descriptor.actions.includes(action) || recoveryCommand()) return;
    const input: CheckinLookupRecoverInput = action === "replay" ? { operationId: descriptor.operationId, action } : { operationId: descriptor.operationId, action, nextOperationId: crypto.randomUUID() };
    void sendRecovery(Object.freeze({ input: Object.freeze(input), context: Object.freeze(structuredClone(descriptor.context)) }));
  }
  return <section aria-label="Find attendee" class="min-w-0 rounded-lg border border-base-content/20 bg-base-200 p-4 space-y-4 break-words">
    <h2 class="text-xl font-bold">{props.manual ? "Attendee list" : "Find attendee without a QR"}</h2>
    <Show when={!active() && !props.manual}><button type="button" class="btn btn-outline min-h-12" disabled={!props.context || props.disabled || props.verifying || accessDenied() || storageBlocked()} onClick={open}>Open attendee lookup</button></Show>
    <Show when={props.manual && !active()}><p role="status">Loading the selected event's attendee list…</p></Show>
    <Show when={active()}>
      <Show when={!props.manual}><button type="button" class="btn btn-outline min-h-12" disabled={!!command() || !!held() || pending() || storageBlocked()} onClick={exit}>{props.onClose ? "Back to scanner" : "Exit lookup and clear details"}</button></Show>
      <Show when={held()}>{reference => <p>Held lookup operation: <span class="break-all">{reference()}</span>. New intake is blocked until reconciled.</p>}</Show>
      <Show when={held() && !command()}>
        <p>Only the opaque reference survived reload. Read authenticated server recovery; no attendee details are stored here.</p>
        <button type="button" class="btn btn-outline min-h-12" disabled={accessDenied() || props.verifying !== false || !props.bindingScope || pending()} onClick={() => void recoverHeld()}>Recover held lookup</button>
      </Show>
      <Show when={!props.verifying && !accessDenied() && recovery()}>{descriptor => <div aria-label="Lookup recovery" class="space-y-3">
        <p>Saved lookup state: {descriptor().state}. Originating station {descriptor().context.stationId} · Event {descriptor().context.eventId}.</p>
        <Show when={descriptor().recovery === "context_changed"}><p role="alert">Recovery blocked: originating context changed. This work cannot be retargeted.</p></Show>
        <Show when={descriptor().recovery === "available"}><For each={descriptor().actions}>{action => <button type="button" class="btn btn-outline min-h-12" disabled={pending() || !verified() || !!recoveryCommand()} onClick={() => continueOpaque(action)}>{action === "blank" ? "Continue with blank affiliation" : action === "retry" ? "Retry preflight reads" : "Replay held lookup"}</button>}</For></Show>
      </div>}</Show>
      <Show when={recoveryCommand()}><button type="button" class="btn btn-warning min-h-12" disabled={pending() || !verified()} onClick={() => { const frozen = recoveryCommand(); if (frozen) void sendRecovery(frozen); }}>Retry same recovery</button></Show>
      <Show when={authorized() && !held()} fallback={<Show when={!authorized()}><p role="status">Lookup paused. Verify the current station, event and readiness. Any submitted command retains its original identity.</p></Show>}>
        <Show when={!props.manual}><p>Current event: {props.eventTitle} · Station: {props.stationLabel}</p></Show>
        <form method="post" action="/api/checkin-lookup" class="space-y-3" onSubmit={event => { event.preventDefault(); search(); }}>
          <label for="lookup-query" class="block font-medium">Attendee name or email</label>
          <input id="lookup-query" class="input input-bordered min-h-12 w-full min-w-0" type="text" autocomplete="off" autocapitalize="off" spellcheck={false} maxlength={254} value={query()} onInput={event => edit(event.currentTarget.value)} />
          <Show when={!props.manual}><p class="text-sm">Search is private and temporary. Searching and selecting do not check anyone in.</p></Show>
          <div class="flex flex-wrap gap-2">
            <button type="submit" class="btn btn-primary min-h-12" disabled={results.loading || !props.manual && query().trim().length < 2}>Search attendees</button>
            <Show when={props.manual}>
              <Show when={query() || submitted()?.query || submitted()?.offset}><button type="button" class="btn btn-outline min-h-12" disabled={results.loading} onClick={() => { setQuery(""); search(0, ""); }}>Show all attendees</button></Show>
              <button type="button" class="btn btn-outline min-h-12" disabled={results.loading} onClick={() => search(submitted()?.offset ?? 0, submitted()?.query ?? "", previousOffsets())}>Refresh list</button>
            </Show>
          </div>
        </form>
        <Show when={!results.loading && results()}>{result => <div class="space-y-3">
          <Show when={!props.manual} fallback={<p role="status">Showing {result().items.length ? (submitted()?.offset ?? 0) + 1 : 0}–{(submitted()?.offset ?? 0) + result().items.length}<Show when={result().totalCount !== undefined}> of {result().totalCount}</Show> attendees</p>}><p>Select the exact ticketed attendee. No match is selected automatically.</p></Show>
          <Show when={!result().items.length}><p role="status">No matching attendees in the active admission list.</p></Show>
          <Show when={props.manual}><div class="overflow-x-auto"><table class="table w-full" aria-label="Main-day attendees">
            <thead><tr><th>Attendee</th><th>Status</th><th>Print</th></tr></thead>
            <tbody><For each={result().items}>{item => <tr>
              <td class="min-w-0"><strong class="break-words">{item.name}</strong><br/><span class="text-xs break-all">{item.email}</span></td>
              <td>{item.status === "CANCELLED" ? "Cancelled" : item.status === "AWAITING_PAYMENT" ? "Awaiting payment" : item.checkedIn ? "Checked in" : "Not checked in"}</td>
              <td><button type="button" class="btn btn-primary min-h-12" disabled={!canPrint() || results.loading || pending() || !!command() || query().trim() !== submitted()?.query || item.status === "CANCELLED" || item.status === "AWAITING_PAYMENT"} onClick={() => confirm(item)}>{item.checkedIn ? "Reprint" : "Check in & print"}<span class="sr-only"> {item.name}</span></button></td>
            </tr>}</For></tbody>
          </table></div></Show>
          <Show when={!props.manual}><ul class="space-y-3"><For each={result().items}>{item => <li class="min-w-0 border border-base-content/20 rounded p-3 space-y-2">
            <p class="font-bold break-all">{item.name}</p><p class="break-all">{item.email}</p><Show when={!props.manual}><p>Ticket {item.publicId}</p></Show>
            <Show when={props.manual} fallback={<button type="button" class="btn btn-outline min-h-12" disabled={results.loading} onClick={() => select(item)}>Select {item.name}</button>}>
              <Show when={item.status && item.status !== "ACTIVE"}><p>{item.status === "CANCELLED" ? "Cancelled ticket" : "Awaiting payment"}</p></Show>
              <Show when={item.checkedIn}><p>Already checked in</p></Show>
              <button type="button" class="btn btn-primary min-h-12" disabled={results.loading || pending() || !!command() || item.status === "CANCELLED" || item.status === "AWAITING_PAYMENT"} onClick={() => confirm(item)}>{item.checkedIn ? "Reprint" : "Check in & print"}<span class="sr-only"> {item.name}</span></button>
            </Show>
          </li>}</For></ul></Show>
          <nav aria-label="Attendee pages" class="flex flex-wrap gap-2">
            <Show when={props.manual && previousOffsets().length}><button type="button" class="btn btn-outline min-h-12" disabled={results.loading} onClick={() => search(previousOffsets().at(-1) ?? 0, submitted()?.query ?? "", previousOffsets().slice(0, -1))}>Previous results</button></Show>
            <Show when={result().nextOffset !== null}><button type="button" class="btn btn-outline min-h-12" disabled={results.loading} onClick={() => search(result().nextOffset ?? 0, submitted()?.query ?? query(), [...previousOffsets(), submitted()?.offset ?? 0])}>Next results</button></Show>
          </nav>
        </div>}</Show>
      </Show>
      <section ref={element => { feedback = element; }} tabindex="-1" aria-label="Lookup confirmation" aria-live="polite" class="space-y-3 min-w-0">
        <Show when={authorized() && selected()}>{person => <div class="space-y-2 border border-warning rounded p-3">
          <h3 class="font-bold">Confirm selected attendee</h3><p class="break-all">{person().name}</p><p class="break-all">{person().email}</p>
          <p>Event: {props.eventTitle} · Station: {props.stationLabel}</p><p>Ticket {person().publicId}</p>
          <p>Only confirmation submits this attendee to the existing check-in workflow.</p>
          <Show when={!command()}><button type="button" class="btn btn-warning min-h-12" disabled={pending() || !canPrint()} onClick={() => confirm()}>Confirm check-in</button></Show>
        </div>}</Show>
        <Show when={pending() || results.loading}><p role="status">Request in progress…</p></Show>
        <Show when={error()}><p role="alert">{error()}</p></Show>
        <Show when={unknown()}><p>The saved outcome is unknown. Do not start another attempt; retry this exact confirmation or recover durable station work.</p></Show>
        <Show when={command() && !readState()}><button type="button" class="btn btn-warning min-h-12" disabled={pending() || !canReplay()} onClick={() => { const frozen = command(); if (frozen) void send(frozen); }}>Retry same confirmation</button></Show>
        <Show when={readState()}>
          <p>Preflight read failed. The selected attendee and original context remain frozen. Choose an explicit linked continuation.</p>
          <button type="button" class="btn btn-outline min-h-12" disabled={pending() || !canReplay()} onClick={() => continueRead("fetch")}>Retry preflight reads</button>
          <Show when={readState() === "needs_affiliation_choice"}><button type="button" class="btn btn-warning min-h-12" disabled={pending() || !canReplay()} onClick={() => continueRead("blank")}>Continue with blank affiliation</button></Show>
        </Show>
      </section>
    </Show>
  </section>;
}
