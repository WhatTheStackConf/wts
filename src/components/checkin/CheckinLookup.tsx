import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { createAsyncResource } from "~/lib/async-resource";
import { CheckinLookupRequestError, confirmCheckinLookup, searchCheckinLookup, sameLookupContext, getCheckinLookupRecovery, recoverCheckinLookup } from "~/lib/checkin-lookup-client";
import { persistLookupHold, readLookupHold, releaseLookupHold, type LookupHeldRecovery } from "~/lib/checkin-lookup-held";
import type { CheckinLookupConfirmInput, CheckinLookupSearchInput, CheckinLookupSearchResult } from "~/lib/checkin-lookup-contract";
import type { CheckinArrivalResult } from "~/lib/checkin-arrival-contract";
import type { CheckinEventContext } from "~/lib/checkin-event-contract";
import { isFailedPreflightRead } from "~/components/checkin/arrival-gates";

import type { CheckinLookupRecovery, CheckinLookupRecoverInput } from "~/lib/checkin-lookup-recovery-contract";

type Attendee = CheckinLookupSearchResult["items"][number];
const recoveryOperationId = (input: CheckinLookupRecoverInput) => input.action === "replay" ? input.operationId : input.nextOperationId;
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
type FailedReadState = "needs_affiliation_choice" | "dependency_unavailable";
interface LookupSearchProps {
  authorized: boolean;
  held: string | undefined;
  eventTitle: string;
  stationLabel: string;
  query: string;
  edit(value: string): void;
  search(offset?: number): void;
  loading: boolean;
  results: CheckinLookupSearchResult | undefined;
  select(item: Attendee): void;
}
interface LookupConfirmationProps {
  setFeedback(element: HTMLElement): void;
  authorized: boolean;
  selected: Attendee | undefined;
  eventTitle: string;
  stationLabel: string;
  command: CheckinLookupConfirmInput | undefined;
  pending: boolean;
  loading: boolean;
  error: string;
  unknown: boolean;
  readState: FailedReadState | undefined;
  canReplay: boolean;
  confirm(): void;
  send(frozen: CheckinLookupConfirmInput): Promise<void>;
  continueRead(choice: "fetch" | "blank"): void;
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
  const [readState, setReadState] = createSignal<FailedReadState>();
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
  const currentConfirmation = (generation: number) => !destroyed && generation === epoch && verified();
  const currentRecovery = (generation: number, authority: string) => currentAuthority(generation, authority) && verified();
  const openBlocked = () => !props.context || !props.ready || props.disabled || props.verifying || accessDenied() || storageBlocked();
  const exitBlocked = () => !!command() || !!held() || pending() || storageBlocked();
  const recoveryLocked = () => accessDenied() || props.verifying !== false || !props.bindingScope;
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
  function observeVerifyingCycle() {
    if (props.verifying) verifyingSeen = true;
    else if (verifyingSeen) { verifyingSeen = false; setAccessDenied(false); }
  }
  // Invalidation precedes resource initialization; edits do not issue searches.
  createEffect(() => JSON.stringify([bindingKey(), props.context, props.ready, props.disabled, props.verifying]), () => {
    redact();
    if (props.verifying || scope && scope !== bindingKey()) setRecovery(undefined);
    observeVerifyingCycle();
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
    if (exitBlocked()) return;
    redact(); setError(""); setActive(false); props.onBusy?.(false);
    props.onClose?.();
  }
  function open() {
    if (openBlocked() || held()) return;
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
  function retainHold(operationId: string, priorOperationId: string | undefined, failure: string) {
    try { persistLookupHold(operationId, priorOperationId); return true; }
    catch { setError(failure); return false; }
  }
  function settleConfirmation(frozen: CheckinLookupConfirmInput, outcome: CheckinArrivalResult) {
    setUnknown(false); clearPrivate();
    if (isFailedPreflightRead(outcome)) {
      setReadState(outcome.state); return;
    }
    props.onDecision(outcome); // Persist receiving queue before releasing this hold.
    releaseLookupHold(frozen.operationId);
    setHeld(undefined); setCommand(undefined); setActive(false); props.onBusy?.(false);
  }
  async function send(frozen: CheckinLookupConfirmInput, initial = false) {
    if (pending() || !(initial ? authorized() : canReplay())) return;
    if (!retainHold(frozen.operationId, frozen.priorOperationId, "Could not retain operation reference. Confirmation was not sent; restore browser storage and retry.")) return;
    const generation = epoch;
    setHeld(frozen.operationId); setCommand(frozen); setPending(true); setUnknown(true); setReadState(undefined); setError("");
    try {
      const outcome = await confirmCheckinLookup(frozen);
      // Context/authority loss may hide a valid reply but never forgets the intent.
      if (!currentConfirmation(generation)) return;
      settleConfirmation(frozen, outcome);
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
  function settleOverrideRecovery(reference: string, outcome: LookupHeldRecovery, generation: number, authority: string) {
    if (!currentAuthority(generation, authority)) return;
    if (outcome.state !== "reconciled" || outcome.operationId !== reference) { setError("Operation remains held. Complete authenticated recovery before new intake."); return; }
    releaseLookupHold(reference); setHeld(undefined); setActive(false); props.onBusy?.(false);
  }
  function showServerRecovery(descriptor: CheckinLookupRecovery, generation: number, authority: string) {
    if (!currentAuthority(generation, authority)) return;
    scope = authority; setRecovery(descriptor);
    if (descriptor.result) settleRecovery(descriptor.result);
  }
  async function recoverHeld() {
    const reference = held();
    if (!reference || command() || pending() || recoveryLocked()) return;
    const authority = bindingKey(), generation = authorityEpoch; setPending(true); setError("");
    try {
      if (props.onRecoverHeld) settleOverrideRecovery(reference, await props.onRecoverHeld(reference), generation, authority);
      else showServerRecovery(await getCheckinLookupRecovery(reference), generation, authority);
    } catch (failure) { if (currentAuthority(generation, authority)) classify(failure); }
    finally { if (!destroyed) setPending(false); }
  }
  function settleRecovery(outcome: CheckinArrivalResult) {
    setUnknown(false);
    if (isFailedPreflightRead(outcome)) return;
    props.onDecision(outcome);
    releaseLookupHold(outcome.operationId);
    setHeld(undefined); setRecovery(undefined); setRecoveryCommand(undefined); setActive(false); props.onBusy?.(false);
  }
  async function sendRecovery(frozen: { input: CheckinLookupRecoverInput; context: CheckinEventContext }) {
    if (pending() || !verified()) return;
    const nextId = recoveryOperationId(frozen.input);
    if (!retainHold(nextId, frozen.input.operationId, "Could not retain recovery reference. Nothing was sent.")) return;
    // Catalogue/readiness arrival after reload is not an authority change. The
    // opaque command already carries the server's immutable original context.
    const authority = bindingKey(), generation = authorityEpoch;
    setHeld(nextId); setRecoveryCommand(frozen); setRecovery(undefined); setPending(true); setUnknown(true); setError("");
    try {
      const outcome = await recoverCheckinLookup(frozen.input, frozen.context);
      if (!currentRecovery(generation, authority)) return;
      settleRecovery(outcome);
      if (held()) {
        setRecoveryCommand(undefined);
        const descriptor = await getCheckinLookupRecovery(nextId);
        if (currentRecovery(generation, authority)) setRecovery(descriptor);
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
    <Show when={!active()}><button type="button" class="btn btn-outline min-h-12" disabled={openBlocked()} onClick={open}>Open attendee lookup</button></Show>
    <Show when={active()}>
      <button type="button" class="btn btn-outline min-h-12" disabled={exitBlocked()} onClick={exit}>{props.onClose ? "Back to scanner" : "Exit lookup and clear details"}</button>
      <Show when={held()}>{reference => <p>Held lookup operation: <span class="break-all">{reference()}</span>. New intake is blocked until reconciled.</p>}</Show>
      <Show when={held() && !command()}>
        <p>Only the opaque reference survived reload. Read authenticated server recovery; no attendee details are stored here.</p>
        <button type="button" class="btn btn-outline min-h-12" disabled={recoveryLocked() || pending()} onClick={() => void recoverHeld()}>Recover held lookup</button>
      </Show>
      <Show when={!props.verifying && !accessDenied() && recovery()}>{descriptor => <div aria-label="Lookup recovery" class="space-y-3">
        <p>Saved lookup state: {descriptor().state}. Originating station {descriptor().context.stationId} · Event {descriptor().context.eventId}.</p>
        <Show when={descriptor().recovery === "context_changed"}><p role="alert">Recovery blocked: originating context changed. This work cannot be retargeted.</p></Show>
        <Show when={descriptor().recovery === "available"}><For each={descriptor().actions}>{action => <button type="button" class="btn btn-outline min-h-12" disabled={pending() || !verified() || !!recoveryCommand()} onClick={() => continueOpaque(action)}>{action === "blank" ? "Continue with blank affiliation" : action === "retry" ? "Retry preflight reads" : "Replay held lookup"}</button>}</For></Show>
      </div>}</Show>
      <Show when={recoveryCommand()}><button type="button" class="btn btn-warning min-h-12" disabled={pending() || !verified()} onClick={() => { const frozen = recoveryCommand(); if (frozen) void sendRecovery(frozen); }}>Retry same recovery</button></Show>
      <LookupSearch authorized={authorized()} held={held()} eventTitle={props.eventTitle} stationLabel={props.stationLabel} query={query()} edit={edit} search={search} loading={results.loading} results={results()} select={select} />
      <LookupConfirmation setFeedback={element => { feedback = element; }} authorized={authorized()} selected={selected()} eventTitle={props.eventTitle} stationLabel={props.stationLabel} command={command()} pending={pending()} loading={results.loading} error={error()} unknown={unknown()} readState={readState()} canReplay={canReplay()} confirm={confirm} send={send} continueRead={continueRead} />
    </Show>
  </section>;
}

function LookupSearch(props: LookupSearchProps) {
  return <Show when={props.authorized && !props.held} fallback={<Show when={!props.authorized}><p role="status">Lookup paused. Verify the current station, event and readiness. Any submitted command retains its original identity.</p></Show>}>
    <p>Current event: {props.eventTitle} · Station: {props.stationLabel}</p>
    <form method="post" action="/api/checkin-lookup" class="space-y-3" onSubmit={event => { event.preventDefault(); props.search(); }}>
      <label for="lookup-query" class="block font-medium">Attendee name or email</label>
      <input id="lookup-query" class="input input-bordered min-h-12 w-full min-w-0" type="text" autocomplete="off" autocapitalize="off" spellcheck={false} maxlength={254} value={props.query} onInput={event => props.edit(event.currentTarget.value)} />
      <p class="text-sm">Search is private and temporary. Searching and selecting do not check anyone in.</p>
      <button type="submit" class="btn btn-primary min-h-12" disabled={props.loading || props.query.trim().length < 2}>Search attendees</button>
    </form>
    <Show when={!props.loading && props.results}>{result => <div class="space-y-3">
      <p>Select the exact ticketed attendee. No match is selected automatically.</p>
      <Show when={!result().items.length}><p role="status">No matching attendees in the active admission list.</p></Show>
      <ul class="space-y-3"><For each={result().items}>{item => <li class="min-w-0 border border-base-content/20 rounded p-3 space-y-2">
        <p class="font-bold break-all">{item.name}</p><p class="break-all">{item.email}</p><p>Ticket {item.publicId}</p>
        <button type="button" class="btn btn-outline min-h-12" disabled={props.loading} onClick={() => props.select(item)}>Select {item.name}</button>
      </li>}</For></ul>
      <Show when={result().nextOffset !== null}><button type="button" class="btn btn-outline min-h-12" disabled={props.loading} onClick={() => props.search(result().nextOffset ?? 0)}>Next results</button></Show>
    </div>}</Show>
  </Show>;
}
function LookupConfirmation(props: LookupConfirmationProps) {
  return <section ref={element => { props.setFeedback(element); }} tabindex="-1" aria-label="Lookup confirmation" aria-live="polite" class="space-y-3 min-w-0">
    <Show when={props.authorized && props.selected}>{person => <div class="space-y-2 border border-warning rounded p-3">
      <h3 class="font-bold">Confirm selected attendee</h3><p class="break-all">{person().name}</p><p class="break-all">{person().email}</p>
      <p>Event: {props.eventTitle} · Station: {props.stationLabel}</p><p>Ticket {person().publicId}</p>
      <p>Only confirmation submits this attendee to the existing check-in workflow.</p>
      <Show when={!props.command}><button type="button" class="btn btn-warning min-h-12" disabled={props.pending} onClick={props.confirm}>Confirm check-in</button></Show>
    </div>}</Show>
    <Show when={props.pending || props.loading}><p role="status">Request in progress…</p></Show>
    <Show when={props.error}><p role="alert">{props.error}</p></Show>
    <Show when={props.unknown}><p>The saved outcome is unknown. Do not start another attempt; retry this exact confirmation or recover durable station work.</p></Show>
    <Show when={props.command && !props.readState}><button type="button" class="btn btn-warning min-h-12" disabled={props.pending || !props.canReplay} onClick={() => { const frozen = props.command; if (frozen) void props.send(frozen); }}>Retry same confirmation</button></Show>
    <Show when={props.readState}>
      <p>Preflight read failed. The selected attendee and original context remain frozen. Choose an explicit linked continuation.</p>
      <button type="button" class="btn btn-outline min-h-12" disabled={props.pending || !props.canReplay} onClick={() => props.continueRead("fetch")}>Retry preflight reads</button>
      <Show when={props.readState === "needs_affiliation_choice"}><button type="button" class="btn btn-warning min-h-12" disabled={props.pending || !props.canReplay} onClick={() => props.continueRead("blank")}>Continue with blank affiliation</button></Show>
    </Show>
  </section>;
}
