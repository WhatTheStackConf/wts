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
  let scope = "";
  let verifyingSeen = false;
  let feedback: HTMLElement | undefined;
  const bindingKey = () => props.bindingScope || (props.context ? JSON.stringify([props.context.bindingId, props.context.bindingVersion, props.context.stationId]) : "");
  const verified = () => !props.verifying && !accessDenied() && !!bindingKey() && scope === bindingKey();
  const authorized = () => active() && verified() && !!props.context && props.ready && !props.disabled;
  const canReplay = () => active() && verified() && (props.verifying === false && !!props.bindingScope || !!props.context && props.ready && !props.disabled && !!command() && sameLookupContext(command()!.context, props.context));
  createEffect(() => JSON.stringify([bindingKey(), props.verifying]), () => { authorityEpoch++; });
  const currentAuthority = (generation: number, authority: string) => !destroyed && generation === authorityEpoch && !props.verifying && !accessDenied() && authority === bindingKey();
  const focusFeedback = () => { if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(() => { if (!destroyed) feedback?.focus(); }); };
  function clearPrivate() { setQuery(""); setSubmitted(undefined); setSelected(undefined); }
  function redact() { epoch++; clearPrivate(); }
  function classify(failure: unknown) {
    if (failure instanceof CheckinLookupRequestError && (failure.kind === "access" || failure.kind === "context")) {
      redact(); setRecovery(undefined);
      if (failure.kind === "access") setAccessDenied(true);
    }
    setError(failure instanceof CheckinLookupRequestError ? failure.message : "Lookup unavailable. Retry the same request.");
  }
  // Invalidation precedes resource initialization; edits do not issue searches.
  createEffect(() => JSON.stringify([bindingKey(), props.context, props.ready, props.disabled, props.verifying]), () => {
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
      focusFeedback();
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
  onCleanup(() => { destroyed = true; epoch++; clearPrivate(); if (!command() && !held() && !storageBlocked()) props.onBusy?.(false); });
  createEffect(() => props.openRequest, request => { if (request) open(); });
  function exit() {
    if (command() || held() || pending() || storageBlocked()) return;
    redact(); setError(""); setActive(false); props.onBusy?.(false);
    props.onClose?.();
  }
  function open() {
    if (!props.context || !props.ready || props.disabled || props.verifying || accessDenied() || storageBlocked() || held()) return;
    scope = bindingKey(); setActive(true); props.onBusy?.(true);
  }
  function edit(value: string) {
    if (command() || held()) return;
    redact(); setQuery(value); setError("");
  }
  function search(offset = 0) {
    const context = props.context;
    if (!authorized() || !context || command() || held() || results.loading || query().trim().length < 2) return;
    epoch++; setSelected(undefined); setError("");
    setSubmitted({ context: structuredClone(context), query: query(), offset });
  }
  function select(item: Attendee) {
    if (!authorized() || results.loading || command() || !results()?.items.includes(item)) return;
    setSelected(item); setError(""); focusFeedback();
  }
  async function send(frozen: CheckinLookupConfirmInput, initial = false) {
    if (pending() || !(initial ? authorized() : canReplay())) return;
    try { persistLookupHold(frozen.operationId, frozen.priorOperationId); }
    catch { setError("Could not retain operation reference. Confirmation was not sent; restore browser storage and retry."); return; }
    const generation = epoch;
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
    } finally { if (!destroyed) { setPending(false); focusFeedback(); } }
  }
  function confirm() {
    const person = selected(); const context = props.context;
    if (!authorized() || !person || !context || pending() || command() || held()) return;
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
    <h2 class="text-xl font-bold">Find attendee without a QR</h2>
    <Show when={!active()}><button type="button" class="btn btn-outline min-h-12" disabled={!props.context || !props.ready || props.disabled || props.verifying || accessDenied() || storageBlocked()} onClick={open}>Open attendee lookup</button></Show>
    <Show when={active()}>
      <button type="button" class="btn btn-outline min-h-12" disabled={!!command() || !!held() || pending() || storageBlocked()} onClick={exit}>{props.onClose ? "Back to scanner" : "Exit lookup and clear details"}</button>
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
        <p>Current event: {props.eventTitle} · Station: {props.stationLabel}</p>
        <form method="post" action="/api/checkin-lookup" class="space-y-3" onSubmit={event => { event.preventDefault(); search(); }}>
          <label for="lookup-query" class="block font-medium">Attendee name or email</label>
          <input id="lookup-query" class="input input-bordered min-h-12 w-full min-w-0" type="text" autocomplete="off" autocapitalize="off" spellcheck={false} maxlength={254} value={query()} onInput={event => edit(event.currentTarget.value)} />
          <p class="text-sm">Search is private and temporary. Searching and selecting do not check anyone in.</p>
          <button type="submit" class="btn btn-primary min-h-12" disabled={results.loading || query().trim().length < 2}>Search attendees</button>
        </form>
        <Show when={!results.loading && results()}>{result => <div class="space-y-3">
          <p>Select the exact ticketed attendee. No match is selected automatically.</p>
          <Show when={!result().items.length}><p role="status">No matching attendees in the active admission list.</p></Show>
          <ul class="space-y-3"><For each={result().items}>{item => <li class="min-w-0 border border-base-content/20 rounded p-3 space-y-2">
            <p class="font-bold break-all">{item.name}</p><p class="break-all">{item.email}</p><p>Ticket {item.publicId}</p>
            <button type="button" class="btn btn-outline min-h-12" disabled={results.loading} onClick={() => select(item)}>Select {item.name}</button>
          </li>}</For></ul>
          <Show when={result().nextOffset !== null}><button type="button" class="btn btn-outline min-h-12" disabled={results.loading} onClick={() => search(result().nextOffset ?? 0)}>Next results</button></Show>
        </div>}</Show>
      </Show>
      <section ref={element => { feedback = element; }} tabindex="-1" aria-label="Lookup confirmation" aria-live="polite" class="space-y-3 min-w-0">
        <Show when={authorized() && selected()}>{person => <div class="space-y-2 border border-warning rounded p-3">
          <h3 class="font-bold">Confirm selected attendee</h3><p class="break-all">{person().name}</p><p class="break-all">{person().email}</p>
          <p>Event: {props.eventTitle} · Station: {props.stationLabel}</p><p>Ticket {person().publicId}</p>
          <p>Only confirmation submits this attendee to the existing check-in workflow.</p>
          <Show when={!command()}><button type="button" class="btn btn-warning min-h-12" disabled={pending()} onClick={confirm}>Confirm check-in</button></Show>
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
