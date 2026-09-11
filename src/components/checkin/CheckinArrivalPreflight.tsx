import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import { CheckinCameraArrival } from "~/components/checkin/checkin-camera-arrival";
import { CheckinArrivalRequestError, checkinArrivalStatus, preflightCheckinArrival } from "~/lib/checkin-arrival-client";
import type { CheckinArrivalDecision, CheckinArrivalInput, CheckinArrivalResult } from "~/lib/checkin-arrival-contract";
import type { CheckinEventContext } from "~/lib/checkin-event-contract";

const rejectionMessages = {
  invalid_identity: "Invalid QR identity. Paste the exact attendee QR text, not a name, email or URL.",
  not_in_list: "This attendee is unknown or is not in the selected admission list.",
  cancelled: "This attendee's ticket is cancelled.",
  awaiting_payment: "This attendee's ticket is awaiting payment.",
  unknown_eligibility: "Ticket eligibility could not be established. The arrival was rejected.",
  already_checked_in: "This attendee is already checked in upstream. No new admission or Name Label was authorized.",
};
export function ArrivalDecision(props: { decision: CheckinArrivalDecision }) {
  const work = () => { const current = props.decision; return "workflow" in current ? current.workflow : undefined; };
  const accepted = () => props.decision.state === "accepted" ? props.decision : undefined;
  const printStatus = () => {
    const state = work()?.printState;
    return state === "queued" ? "Name Label queued for the owning station agent."
      : state === "dispatched" ? "Name Label dispatch started. Wait for the protocol outcome."
      : state === "completed" ? "Printer protocol complete. The operator must still check physical label quality."
      : state === "uncertain" ? "Printer output is uncertain. The station remains unready; do not reprint automatically."
      : "";
  };
  const reason = () => props.decision.state === "rejected" ? rejectionMessages[props.decision.reason] : "";
  const heading = () => ({
    accepted: "Accepted by Hi.Events",
    reserved: "Arrival reserved",
    existing: "Existing arrival work",
    admission_pending: "Admission pending",
    existing_unattributed: "Existing upstream check-in",
    admission_uncertain: "Admission outcome uncertain",
    rejected: "Arrival rejected",
    already_handled: "Already handled at another station",
    dependency_unavailable: "Dependency unavailable",
    needs_affiliation_choice: "Affiliation choice required",
  }[props.decision.state] ?? "Arrival result");
  return <div class="space-y-2 wts-name-label-text">
    <Show when={work()}>{(workflow) => <>
      <p class="font-bold">{heading()}</p>
      <Show when={props.decision.state === "reserved"}><p>Arrival reserved. The supervised coordinator will submit admission; do not rescan.</p></Show>
      <Show when={props.decision.state === "existing"}><p>Existing arrival work reopened. No additional workflow was created.</p></Show>
      <Show when={props.decision.state === "admission_pending"}><p>Admission is in progress in the supervised coordinator. Do not rescan or submit another admission.</p></Show>
      <Show when={accepted()}>{(admission) => <>
        <Show when={admission().printIntentId !== null} fallback={<p>Admission recorded. No Name Label was queued: edition closure or restore reconciliation suppresses printing. Do not check this attendee in again.</p>}>
          <p>Admission accepted. Exactly one initial Name Label intent belongs to this station.</p>
          <Show when={printStatus()}>{(status) => <p role="status">{status()}</p>}</Show>
          <p>Print intent: <span class="break-all">{admission().printIntentId}</span></p>
        </Show>
      </>}</Show>
      <Show when={props.decision.state === "existing_unattributed"}><p>Hi.Events reports an existing check-in, but WTS cannot attribute it to this admission. An admin must decide; no label was authorized.</p></Show>
      <Show when={props.decision.state === "admission_uncertain"}><p>The admission outcome is uncertain. An admin must reconcile it; no label was authorized and no automatic retry will be made.</p></Show>
      <p>Owning station: {workflow().stationId} · Originating event: {workflow().eventTitle} · Event ID {workflow().eventId}</p>
      <p class="text-lg font-bold">{workflow().name}</p>
      <p>Affiliation: {workflow().affiliation || "Blank"}</p>
      <p class="text-sm">Work <span class="break-all">{workflow().id}</span></p>
      <p class="text-sm">Created <time datetime={workflow().createdAt}>{workflow().createdAt}</time></p>
    </>}</Show>
    <Show when={props.decision.state === "already_handled"}><p class="font-bold">Already handled at another station. No attendee details or history are available here. Work cannot be transferred.</p></Show>
    <Show when={reason()}><p class="font-bold">Arrival rejected. {reason()}</p></Show>
    <Show when={props.decision.state === "dependency_unavailable"}><p class="font-bold">Dependency unavailable. Validation could not be completed; this is not a missing attendee result.</p></Show>
    <Show when={props.decision.state === "needs_affiliation_choice"}><p class="font-bold">Affiliation read failed. Retry the read or explicitly choose a blank affiliation. Missing data has not been assumed.</p></Show>
    <Show when={!["accepted", "admission_pending", "existing_unattributed", "admission_uncertain"].includes(props.decision.state)}><p>No admission request or print intent was created by this preflight.</p></Show>
  </div>;
}
import { CheckinLookup } from "~/components/checkin/CheckinLookup";
import { cameraHeldReference } from "~/lib/checkin-camera-recovery";
import { createAgentReadinessResource } from "~/components/checkin/AgentReadiness";
import { agentStatus } from "~/lib/checkin-agent-client";

interface CheckinArrivalPreflightProps {
  resumeRequest?: { operationId: string; scope: string };
  context: CheckinEventContext | null;
  eventTitle: string;
  stationLabel: string;
  bindingScope?: string;
  verifying: boolean;
  onBusyChange?: (busy: boolean) => void;
}
/** Keep mounted through context refresh/error: frozen commands are not read state. */
export function CheckinArrivalPreflight(props: CheckinArrivalPreflightProps) {
  const [cameraHeld, setCameraHeld] = createSignal(false);
  const [lookupBusy, setLookupBusy] = createSignal(false);
  const [lookupResume, setLookupResume] = createSignal<{ operationId: string; scope: string }>();
  createEffect(() => props.resumeRequest, () => setLookupResume(undefined));
  let queuedLookupResume: { operationId: string; scope: string } | undefined;
  const { data: lookupReadiness, refresh: refreshLookupReadiness } = createAgentReadinessResource(() => props.bindingScope, async scope => {
    const status = await agentStatus();
    if (scope !== props.bindingScope) throw new Error("Binding changed");
    return { scope, station: status.station };
  });
  function lookupDecision(outcome: CheckinArrivalResult) {
    const scope = props.bindingScope;
    if (!scope || props.verifying) throw new Error("Verify the original binding before handoff.");
    if ("workflow" in outcome) {
      const reference = cameraHeldReference(localStorage, scope);
      const existing = reference.read();
      if (existing && existing !== outcome.operationId) throw new Error("Another camera operation remains held.");
      reference.hold(outcome.operationId);
      queuedLookupResume = { operationId: outcome.operationId, scope };
    } else { setResult(outcome); setResultScope(scope); }
  }
  function lookupBusyChanged(busy: boolean) {
    setLookupBusy(busy);
    if (!busy && queuedLookupResume) { setLookupResume(queuedLookupResume); queuedLookupResume = undefined; }
  }
  const [qr, setQr] = createSignal("");
  const [command, setCommand] = createSignal<CheckinArrivalInput>();
  const [origin, setOrigin] = createSignal<{ eventTitle: string; stationLabel: string }>();
  const [result, setResult] = createSignal<CheckinArrivalResult>();
  const [resultScope, setResultScope] = createSignal<string>();
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");
  const [ambiguous, setAmbiguous] = createSignal(false);
  createEffect(() => pending() || ambiguous() || (!!command() && !result()) || cameraHeld() || lookupBusy(), busy => { props.onBusyChange?.(busy); });
  const [privateDenied, setPrivateDenied] = createSignal(false);
  const [progressError, setProgressError] = createSignal("");
  let epoch = 0;
  let disposed = false;
  let readingStatus = false;
  let feedback: HTMLElement | undefined;
  let identityInput: HTMLInputElement | undefined;
  let printTimer: number | undefined;
  const visibleResult = (): CheckinArrivalDecision | undefined => {
    const current = result();
    if (!current || props.verifying || privateDenied()) return undefined;
    return !props.bindingScope || resultScope() !== props.bindingScope ? { state: "already_handled" } : current;
  };
  function stopPrintTracking() {
    if (printTimer !== undefined) { window.clearInterval(printTimer); printTimer = undefined; }
  }
  function trackPrint(operationId: string, scope: string | undefined) {
    stopPrintTracking();
    const generation = epoch;
    const current = () => !disposed && generation === epoch && scope === props.bindingScope && !props.verifying && result()?.operationId === operationId;
    const sync = async () => {
      if (!current() || readingStatus || document.hidden) return;
      readingStatus = true;
      try {
        const status = await checkinArrivalStatus(operationId);
        if (!current()) return;
        if (!status.result) { setPrivateDenied(true); setProgressError("Held operation is not available. Its outcome remains unknown; do not rescan or start a new intake for this attendee."); return; }
        setResult(previous => previous ? { ...status.result!, operationId: previous.operationId, replayed: previous.replayed, operationsEnabled: false } : previous);
        setPrivateDenied(false); setProgressError("");
      } catch (failure) {
        if (!current()) return;
        if (failure instanceof CheckinArrivalRequestError && failure.denied) setPrivateDenied(true);
        setProgressError("Cannot verify live arrival progress. The last result is unverified; do not retry admission elsewhere.");
      } finally { readingStatus = false; }
    };
    // Wait for Solid to publish the received result before polling it.
    printTimer = window.setInterval(() => void sync(), 2000);
  }
  createEffect(() => [props.bindingScope, props.verifying] as const, () => {
    epoch++; stopPrintTracking();
    if (command() && !result()) { setAmbiguous(true); setError("The arrival response is unverified. Preserve and retry the same frozen preflight after verifying the original binding."); }
    const latest = result();
    if (!props.verifying && latest && "workflow" in latest && resultScope() === props.bindingScope) trackPrint(latest.operationId, props.bindingScope);
  });
  onCleanup(() => { disposed = true; epoch++; stopPrintTracking(); });
  function freeze(input: CheckinArrivalInput) {
    const copy = structuredClone(input);
    Object.freeze(copy.context);
    return Object.freeze(copy);
  }
  async function send(input: CheckinArrivalInput) {
    if (pending() || props.verifying) return;
    stopPrintTracking();
    const generation = ++epoch;
    const frozen = freeze(input);
    const requestedScope = props.bindingScope;
    setCommand(frozen); setResultScope(requestedScope); setPending(true); setError(""); setResult(undefined);
    try {
      const outcome = await preflightCheckinArrival(frozen);
      if (disposed || generation !== epoch || props.verifying || requestedScope !== props.bindingScope) return;
      // A delayed response must not publish attendee details into a new binding.
      setResult(!requestedScope || requestedScope !== props.bindingScope
        ? { state: "already_handled", operationId: outcome.operationId, replayed: outcome.replayed, operationsEnabled: false }
        : outcome);
      setResultScope(requestedScope);
      setPrivateDenied(false); setProgressError("");
      if ("workflow" in outcome && requestedScope === props.bindingScope) trackPrint(outcome.operationId, requestedScope);
      setAmbiguous(false);
    }
    catch (failure) {
      if (disposed || generation !== epoch || props.verifying || requestedScope !== props.bindingScope) return;
      if (failure instanceof CheckinArrivalRequestError && failure.denied) setPrivateDenied(true);
      setError(failure instanceof CheckinArrivalRequestError ? failure.message : "Arrival preflight could not be confirmed. Retry the same preflight.");
      // A later stale-context/read error must not erase a previously unknown outcome.
      setAmbiguous((prior) => prior || !(failure instanceof CheckinArrivalRequestError) || failure.ambiguous);
    } finally {
      if (!disposed) { setPending(false); requestAnimationFrame(() => { if (generation === epoch) feedback?.focus(); }); }
    }
  }
  function submit(event: SubmitEvent) {
    event.preventDefault();
    const context = props.context;
    if (!context || props.verifying || privateDenied() || lookupBusy() || cameraHeld() || pending() || command() || !qr()) return;
    setOrigin({ eventTitle: props.eventTitle, stationLabel: props.stationLabel });
    void send({ operationId: crypto.randomUUID(), context, qrIdentity: qr(), affiliationChoice: "fetch" });
  }
  function continueRead(choice: "fetch" | "blank") {
    const prior = command();
    const state = result()?.state;
    if (!prior || pending() || !["needs_affiliation_choice", "dependency_unavailable"].includes(state ?? "")) return;
    // Explicit continuation is a NEW operation linked to the settled failed read,
    // never a changed payload under the previous UUID. Origin context stays fixed.
    void send({ ...prior, operationId: crypto.randomUUID(), priorOperationId: prior.operationId, affiliationChoice: choice });
  }
  function newArrival() {
    if (pending()) return;
    epoch++; setPrivateDenied(false); setProgressError("");
    stopPrintTracking();
    setCommand(undefined); setOrigin(undefined); setResult(undefined); setResultScope(undefined); setError(""); setAmbiguous(false); setQr("");
    requestAnimationFrame(() => identityInput?.focus());
  }
  return <section aria-label="Arrival preflight" class="rounded-lg border border-base-content/20 bg-base-200 p-5 space-y-4 break-words">
    <h2 class="text-xl font-bold">Arrival preflight</h2>
    <CheckinCameraArrival resumeRequest={lookupResume() ?? props.resumeRequest} context={props.context} bindingScope={props.bindingScope} verifying={props.verifying} eventTitle={props.eventTitle} stationLabel={props.stationLabel} manualHeld={!!command() || lookupBusy()} onHeld={setCameraHeld} />
    <CheckinLookup context={props.context} eventTitle={props.eventTitle} stationLabel={props.stationLabel} bindingScope={props.bindingScope} verifying={props.verifying}
      ready={!lookupReadiness.error && !!lookupReadiness()?.station?.readyForAuthorization && lookupReadiness()?.scope === props.bindingScope && lookupReadiness()?.station?.stationId === props.context?.stationId}
      disabled={cameraHeld() || !!command()} onBusy={lookupBusyChanged} onDecision={lookupDecision} />
    <button type="button" class="btn btn-outline min-h-12" disabled={lookupReadiness.loading} onClick={() => void refreshLookupReadiness()}>Refresh lookup readiness</button>
    <p>Exact QR text input is available when the camera is unavailable. This uses the same durable preflight boundary; never paste a held or uncertain attendee as a new attempt.</p>
    <p>Current station: {props.stationLabel || "Unverified"} · Current event: {props.eventTitle || "Unverified"}</p>
    <Show when={!props.context}><p role="status">Verify the current station and event before starting new arrival work. An existing frozen preflight can still be retried unchanged.</p></Show>
    <form method="post" action="/api/checkin-arrivals" class="space-y-3" onSubmit={submit}>
      <label for="attendee-qr-identity" class="block font-medium">Attendee QR identity</label>
      <input ref={(element) => { identityInput = element; }} id="attendee-qr-identity" name="qrIdentity" class="input input-bordered min-h-12 w-full text-base" autocomplete="off" autocapitalize="off" spellcheck={false} maxlength={2048} required value={props.verifying || privateDenied() || (!!command() && resultScope() !== props.bindingScope) ? "" : qr()} readonly={!!command()} onInput={(event) => setQr(event.currentTarget.value)} aria-describedby="arrival-identity-help" />
      <p id="arrival-identity-help" class="text-sm">Exact QR identity only; it is not added to URLs or browser storage. Do not enter an email or name.</p>
      <Show when={command()}><p class="text-sm">This submitted identity is read-only. Use the result actions or choose New arrival.</p></Show>
      <button type="submit" class="btn btn-primary min-h-12" disabled={!props.context || lookupBusy() || cameraHeld() || pending() || !!command() || !qr()}>Validate arrival</button>
    </form>
    <section aria-label="Arrival result" ref={(element) => { feedback = element; }} tabindex="-1" aria-live="polite" class="space-y-3 focus-visible:outline focus-visible:outline-2">
      <Show when={!props.verifying && !privateDenied() && resultScope() === props.bindingScope && origin()}>{(snapshot) => <p>Preflight recorded from {snapshot().stationLabel} · {snapshot().eventTitle} · Station {command()?.context.stationId} · Event ID {command()?.context.eventId}. This origin does not change with this phone's selection.</p>}</Show>
      <Show when={pending()}><p role="status">Validating arrival…</p></Show>
      <Show when={error()}><p role="alert" class="alert alert-error">{error()}</p></Show>
      <Show when={progressError()}><p role="alert">{progressError()}</p></Show>
      <Show when={ambiguous()}><p>The outcome is unknown. Preserve the same preflight when retrying; starting a new arrival is an intentional new attempt, not a transport retry.</p></Show>
      <Show when={command() && !props.verifying && resultScope() !== props.bindingScope}><p>This frozen preflight belongs to another station binding. Its outcome is unverified here; return to the original station rather than submitting it as new work.</p></Show>
      <Show when={!props.verifying} fallback={<p>Verify the current station binding before viewing arrival details.</p>}>
        <Show when={visibleResult()}>{(decision) => <ArrivalDecision decision={decision()} />}</Show>
      </Show>
      <Show when={command() && error()}><button type="button" class="btn btn-warning min-h-12" disabled={pending()} onClick={() => { const frozen = command(); if (frozen) void send(frozen); }}>Retry same preflight</button></Show>
      <Show when={result()?.state === "needs_affiliation_choice"}>
        <div class="flex flex-wrap gap-3">
          <button type="button" class="btn btn-outline min-h-12" disabled={pending()} onClick={() => continueRead("fetch")}>Retry affiliation read</button>
          <button type="button" class="btn btn-warning min-h-12" disabled={pending()} onClick={() => continueRead("blank")}>Continue with blank affiliation</button>
        </div>
      </Show>
      <Show when={result()?.state === "dependency_unavailable"}><button type="button" class="btn btn-outline min-h-12" disabled={pending()} onClick={() => continueRead("fetch")}>Retry preflight reads</button></Show>
      <Show when={command()}><button type="button" class="btn btn-outline min-h-12" disabled={pending()} onClick={newArrival}>New arrival</button></Show>
    </section>
  </section>;
}
