import { Show, createSignal } from "solid-js";
import { CheckinArrivalRequestError, preflightCheckinArrival } from "~/lib/checkin-arrival-client";
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
  const work = () => { const current = props.decision; return current.state === "reserved" || current.state === "existing" ? current.workflow : undefined; };
  const reason = () => props.decision.state === "rejected" ? rejectionMessages[props.decision.reason] : "";
  return <div class="space-y-2 wts-name-label-text">
    <Show when={work()}>{(workflow) => <>
      <p class="font-bold">Not submitted to Hi.Events</p>
      <Show when={props.decision.state === "reserved"}><p>Arrival reserved. Admission and printing are intentionally disabled in this release.</p></Show>
      <Show when={props.decision.state === "existing"}><p>Existing arrival work reopened. No additional workflow was created.</p></Show>
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
    <p>No admission request or print intent was created by this preflight.</p>
  </div>;
}
interface CheckinArrivalPreflightProps {
  context: CheckinEventContext | null;
  eventTitle: string;
  stationLabel: string;
  bindingScope?: string;
  verifying: boolean;
}
/** Keep mounted through context refresh/error: frozen commands are not read state. */
export function CheckinArrivalPreflight(props: CheckinArrivalPreflightProps) {
  const [qr, setQr] = createSignal("");
  const [command, setCommand] = createSignal<CheckinArrivalInput>();
  const [origin, setOrigin] = createSignal<{ eventTitle: string; stationLabel: string }>();
  const [result, setResult] = createSignal<CheckinArrivalResult>();
  const [resultScope, setResultScope] = createSignal<string>();
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");
  const [ambiguous, setAmbiguous] = createSignal(false);
  let feedback: HTMLElement | undefined;
  let identityInput: HTMLInputElement | undefined;
  const visibleResult = (): CheckinArrivalDecision | undefined => {
    const current = result();
    if (!current) return undefined;
    return !props.bindingScope || resultScope() !== props.bindingScope ? { state: "already_handled" } : current;
  };
  function freeze(input: CheckinArrivalInput) {
    const copy = structuredClone(input);
    Object.freeze(copy.context);
    return Object.freeze(copy);
  }
  async function send(input: CheckinArrivalInput) {
    if (pending()) return;
    const frozen = freeze(input);
    const requestedScope = props.bindingScope;
    setCommand(frozen); setPending(true); setError(""); setResult(undefined);
    try {
      const outcome = await preflightCheckinArrival(frozen);
      // A delayed response must not publish attendee details into a new binding.
      setResult(!requestedScope || requestedScope !== props.bindingScope
        ? { state: "already_handled", operationId: outcome.operationId, replayed: outcome.replayed, operationsEnabled: false }
        : outcome);
      setResultScope(requestedScope);
      setAmbiguous(false);
    }
    catch (failure) {
      setError(failure instanceof CheckinArrivalRequestError ? failure.message : "Arrival preflight could not be confirmed. Retry the same preflight.");
      // A later stale-context/read error must not erase a previously unknown outcome.
      setAmbiguous((prior) => prior || !(failure instanceof CheckinArrivalRequestError) || failure.ambiguous);
    } finally {
      setPending(false);
      requestAnimationFrame(() => feedback?.focus());
    }
  }
  function submit(event: SubmitEvent) {
    event.preventDefault();
    const context = props.context;
    if (!context || pending() || command() || !qr()) return;
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
    setCommand(undefined); setOrigin(undefined); setResult(undefined); setResultScope(undefined); setError(""); setAmbiguous(false); setQr("");
    requestAnimationFrame(() => identityInput?.focus());
  }
  return <section aria-label="Arrival preflight" class="rounded-lg border border-base-content/20 bg-base-200 p-5 space-y-4 break-words">
    <h2 class="text-xl font-bold">Arrival preflight</h2>
    <p>Validate and reserve only. Paste the exact attendee QR text. Camera scanning, lookup, admission and Name Label printing remain disabled.</p>
    <p>Current station: {props.stationLabel || "Unverified"} · Current event: {props.eventTitle || "Unverified"}</p>
    <Show when={!props.context}><p role="status">Verify the current station and event before starting new arrival work. An existing frozen preflight can still be retried unchanged.</p></Show>
    <form method="post" action="/api/checkin-arrivals" class="space-y-3" onSubmit={submit}>
      <label for="attendee-qr-identity" class="block font-medium">Attendee QR identity</label>
      <input ref={(element) => { identityInput = element; }} id="attendee-qr-identity" name="qrIdentity" class="input input-bordered min-h-12 w-full text-base" autocomplete="off" autocapitalize="off" spellcheck={false} maxlength={2048} required value={qr()} readonly={!!command()} onInput={(event) => setQr(event.currentTarget.value)} aria-describedby="arrival-identity-help" />
      <p id="arrival-identity-help" class="text-sm">Exact QR identity only; it is not added to URLs or browser storage. Do not enter an email or name.</p>
      <Show when={command()}><p class="text-sm">This submitted identity is read-only. Use the result actions or choose New arrival.</p></Show>
      <button type="submit" class="btn btn-primary min-h-12" disabled={!props.context || pending() || !!command() || !qr()}>Validate arrival</button>
    </form>
    <section aria-label="Arrival result" ref={(element) => { feedback = element; }} tabindex="-1" aria-live="polite" class="space-y-3 focus-visible:outline focus-visible:outline-2">
      <Show when={origin()}>{(snapshot) => <p>Preflight recorded from {snapshot().stationLabel} · {snapshot().eventTitle} · Station {command()?.context.stationId} · Event ID {command()?.context.eventId}. This origin does not change with this phone's selection.</p>}</Show>
      <Show when={pending()}><p role="status">Validating arrival…</p></Show>
      <Show when={error()}><p role="alert" class="alert alert-error">{error()}</p></Show>
      <Show when={ambiguous()}><p>The outcome is unknown. Preserve the same preflight when retrying; starting a new arrival is an intentional new attempt, not a transport retry.</p></Show>
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
