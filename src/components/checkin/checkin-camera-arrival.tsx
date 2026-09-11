import { For, Show, createEffect, createSignal, onCleanup, onSettled } from "solid-js";
import type { CheckinArrivalDecision, CheckinArrivalInput } from "~/lib/checkin-arrival-contract";
import type { CheckinEventContext } from "~/lib/checkin-event-contract";
import { CheckinArrivalRequestError, checkinArrivalStatus, preflightCheckinArrival } from "~/lib/checkin-arrival-client";
import { isCheckinArrivalQrIdentity } from "~/lib/checkin-arrival-validation";
import { cameraDecisionSettled } from "~/lib/checkin-camera";
import { cameraHeldReference } from "~/lib/checkin-camera-recovery";
import { CheckinCameraScanner } from "~/components/checkin/checkin-camera-scanner";
import { CheckinCompactResult, compactArrivalPresentation } from "~/components/checkin/CheckinCompactResult";
import { createScanFeedback, type ScanFeedbackKind } from "~/lib/checkin-scan-feedback";
import { ArrivalDecision } from "~/components/checkin/CheckinArrivalPreflight";
import { createAgentReadinessResource } from "~/components/checkin/AgentReadiness";
import { agentStatus } from "~/lib/checkin-agent-client";

import { getCheckinArrivalResume, resumeCheckinArrival, type CheckinArrivalResume, type CheckinArrivalResumeInput } from "~/lib/checkin-arrival-resume-client";

interface CheckinCameraArrivalProps {
  compact?: boolean;
  resumeRequest?: { operationId: string; scope: string };
  context: CheckinEventContext | null;
  bindingScope?: string;
  verifying: boolean;
  eventTitle: string;
  stationLabel: string;
  manualHeld: boolean;
  onHeld: (held: boolean) => void;
}

export function CheckinCameraArrival(props: CheckinCameraArrivalProps) {
  const scanFeedback = createScanFeedback();
  let captureSequence = 0;
  const [captureFlash, setCaptureFlash] = createSignal(false);
  const [accessDenied, setAccessDenied] = createSignal(false);
  let flashTimer: number | undefined;
  let invalidSequence = 0;
  function notify(kind: ScanFeedbackKind, key: string) {
    if (!props.compact || props.verifying || disposed) return;
    const identity = `${props.bindingScope}:${kind}:${key}`;
    scanFeedback.notify(kind, identity);
  }
  function captured(operationId: string) {
    captureSequence++;
    notify("captured", `${operationId}:${captureSequence}`);
    if (!props.compact) return;
    setCaptureFlash(true);
    if (flashTimer !== undefined) window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => { setCaptureFlash(false); flashTimer = undefined; }, 350);
  }
  const [held, setHeld] = createSignal<{ operationId: string; scope: string }>();
  const [command, setCommand] = createSignal<CheckinArrivalInput>();
  const [resume, setResume] = createSignal<CheckinArrivalResume>();
  const [resumeCommand, setResumeCommand] = createSignal<CheckinArrivalResumeInput>();
  const [reacquiring, setReacquiring] = createSignal(false);
  const [recoveryQr, setRecoveryQr] = createSignal("");
  const retainedResume = new Map<string, CheckinArrivalResumeInput>();
  let authorityEpoch = 0;
  createEffect(() => [props.bindingScope, props.verifying] as const, () => { authorityEpoch++; setResume(undefined); setReacquiring(false); });
  const [decision, setDecision] = createSignal<CheckinArrivalDecision>();
  const [lastFeedback, setLastFeedback] = createSignal<{ scope: string; decision?: CheckinArrivalDecision; error: string }>();
  const [pending, setPending] = createSignal(false);
  const [reading, setReading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [invalid, setInvalid] = createSignal("");
  const [storageReady, setStorageReady] = createSignal(false);
  const [paused, setPaused] = createSignal(false);
  // Exact commands remain in memory across explicit parking. A presented retry
  // is never a new UUID. Reload recovery uses history, not persisted QR text.
  const retained = new Map<string, CheckinArrivalInput>();
  let feedback: HTMLElement | undefined;
  let timer: number | undefined;
  let releaseTimer: number | undefined;
  let disposed = false;
  let statusInFlight = false;
  let loadedScope: string | undefined;
  const { data: readiness, refresh: refreshReadiness } = createAgentReadinessResource(() => props.bindingScope, async (scope) => {
    const status = await agentStatus();
    if (scope !== props.bindingScope) throw new Error("Binding changed");
    return { scope, station: status.station };
  });
  const visible = () => !props.verifying && !!props.bindingScope && held()?.scope === props.bindingScope;
  const heldWorkflow = () => { const current = decision(); return current && "workflow" in current ? current.workflow : undefined; };
  const visibleLastFeedback = () => !props.verifying && lastFeedback()?.scope === props.bindingScope ? lastFeedback() : undefined;
  const enabled = () => storageReady() && !accessDenied() && !props.verifying && !props.manualHeld && !paused() && !!props.context && !!props.bindingScope
    && !readiness.error && !readiness.loading && readiness()?.scope === props.bindingScope
    && readiness()?.station?.stationId === props.context?.stationId && !!readiness()?.station?.readyForAuthorization;
  const focus = () => requestAnimationFrame(() => { if (!disposed && visible()) feedback?.focus({ preventScroll: true }); });
  const identityKey = (input: CheckinArrivalInput) => `${input.context.bindingId}:${input.context.bindingVersion}:${input.context.eventId}:${input.qrIdentity}`;
  function cancelRelease() { if (releaseTimer !== undefined) window.clearTimeout(releaseTimer); releaseTimer = undefined; }
  const recoveryAvailable = () => visible() && storageReady() && !pending() && !reading() && resume()?.recovery === "available" && !!resume()?.actions.length;
  function release() {
    const current = held();
    if (!current || !visible() || pending()) return;
    try { cameraHeldReference(localStorage, current.scope).clear(current.operationId); }
    catch { setError("Cannot save release of held work. Keep this attendee here and restore browser storage."); return; }
    setLastFeedback({ scope: current.scope, decision: decision(), error: error() });
    cancelRelease(); setHeld(undefined); setCommand(undefined); setResume(undefined); setResumeCommand(undefined); setRecoveryQr(""); setReacquiring(false); setDecision(undefined); setError("");
  }
  function update(outcome: CheckinArrivalDecision) {
    const changed = JSON.stringify(outcome) !== JSON.stringify(decision());
    setDecision(outcome); setError(""); setAccessDenied(false); cancelRelease();
    if (changed) focus();
    const current = held();
    if (current) {
      const presentation = compactArrivalPresentation(outcome);
      if (presentation.tone === "success" && cameraDecisionSettled(outcome)) notify("success", `${current.operationId}:${captureSequence}`);
      else if (presentation.tone === "error") notify("error", `${current.operationId}:${presentation.title}`);
    }
    if (!props.compact && cameraDecisionSettled(outcome)) {
      const current = held();
      releaseTimer = window.setTimeout(() => {
        releaseTimer = undefined;
        if (!document.hidden && !props.verifying && !error() && current === held() && cameraDecisionSettled(decision())) release();
      }, 2200);
    }
  }
  async function refreshHeld() {
    const current = held();
    if (!current || !visible() || pending() || statusInFlight || document.hidden) return;
    statusInFlight = true;
    setReading(true);
    const epoch = authorityEpoch;
    try {
      const status = await checkinArrivalStatus(current.operationId);
      if (disposed || epoch !== authorityEpoch || current !== held() || !visible()) return;
      const outcome = status.result;
      // Observing an existing workflow needs station authority, not permission
      // to reconstruct another phone's frozen preflight. Only failed/unknown
      // preflight reads need the original-context continuation descriptor.
      if (!outcome || outcome.state === "needs_affiliation_choice" || outcome.state === "dependency_unavailable") {
        const descriptor = await getCheckinArrivalResume(current.operationId);
        if (disposed || epoch !== authorityEpoch || current !== held() || !visible()) return;
        setResume(descriptor);
      } else setResume(undefined);
      if (!disposed && epoch === authorityEpoch && current === held() && visible()) {
        if (outcome) {
          const recoveredCommand = resumeCommand();
          if (recoveredCommand) setRecoveryQr(recoveredCommand.qrIdentity);
          setResumeCommand(undefined); retainedResume.delete(current.operationId);
          // Don't reset the short result timer on every identical status poll.
          if (JSON.stringify(outcome) !== JSON.stringify(decision()) || (!props.compact && cameraDecisionSettled(outcome) && releaseTimer === undefined)) update(outcome);
          else setError("");
        } else { setDecision(undefined); setLastFeedback(undefined); cancelRelease(); setError("Held operation is not available. Its outcome remains unknown. Do not rescan or switch this attendee to native Hi.Events."); }
      }
    } catch (failure) {
      if (!disposed && epoch === authorityEpoch && current === held() && visible()) { if (failure instanceof CheckinArrivalRequestError && failure.denied) setAccessDenied(true); setDecision(undefined); setLastFeedback(undefined); setResume(undefined); cancelRelease(); setError("Cannot verify held work. Check your login, role and station, then refresh held arrival. The last result is unverified; do not retry admission elsewhere."); }
    } finally { statusInFlight = false; if (!disposed) setReading(false); }
  }
  createEffect(() => ({ scope: props.bindingScope, verifying: props.verifying }), ({ scope, verifying }) => {
    if (verifying || !scope || scope === loadedScope) return;
    loadedScope = scope; cancelRelease(); retained.clear(); retainedResume.clear(); setResume(undefined); setResumeCommand(undefined); setRecoveryQr(""); setReacquiring(false); setLastFeedback(undefined); setDecision(undefined); setCommand(undefined); setError(""); setHeld(undefined); setStorageReady(false);
    setAccessDenied(false);
    try {
      const operationId = cameraHeldReference(localStorage, scope).read();
      setStorageReady(true);
      if (operationId) { setHeld({ scope, operationId }); void refreshHeld(); }
    } catch { setError("Browser storage is unavailable or held work is unreadable. All new intake is blocked. Restore storage and reload; consult station history before using a fallback."); }
  });
  createEffect(() => props.resumeRequest, (request) => {
    if (!request || props.verifying || request.scope !== props.bindingScope || !storageReady()) return;
    if (pending() || props.manualHeld || (held() && held()?.operationId !== request.operationId)) {
      setError("Resolve or park the current held arrival before resuming different history work."); focus(); return;
    }
    if (!held()) {
      try { cameraHeldReference(localStorage, request.scope).hold(request.operationId); }
      catch { setStorageReady(false); setError("Cannot retain history work. Restore browser storage first."); return; }
      setHeld({ scope: request.scope, operationId: request.operationId });
      setCommand(undefined); setDecision(undefined); setResume(undefined);
      setResumeCommand(retainedResume.get(request.operationId)); setRecoveryQr("");
    }
    void refreshHeld(); focus();
  });
  createEffect(() => !storageReady() || !!held() || !!invalid() || pending(), (value) => { props.onHeld(value); });
  createEffect(() => ({ error: error(), invalid: invalid(), operationId: held()?.operationId, verifying: props.verifying }), (value) => {
    if (!value.verifying && (value.error || value.invalid)) notify("error", `${value.operationId ?? `invalid-${invalidSequence}`}:${value.error || value.invalid}`);
  });
  onSettled(() => {
    const poll = () => { void refreshHeld(); };
    timer = window.setInterval(poll, 2000);
    const visibility = () => { if (document.hidden) cancelRelease(); else { void refreshHeld(); void refreshReadiness(); } };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", poll);
    return () => { document.removeEventListener("visibilitychange", visibility); window.removeEventListener("focus", poll); };
  });
  onCleanup(() => { disposed = true; if (timer !== undefined) window.clearInterval(timer); if (flashTimer !== undefined) window.clearTimeout(flashTimer); scanFeedback.dispose(); cancelRelease(); });

  async function send(input: CheckinArrivalInput, scope: string, fromCamera = false) {
    // Fresh intake is gated in scan(); an exact frozen replay must not depend
    // on the mutable event catalogue. Human/binding verification still applies.
    if (pending() || props.verifying || scope !== props.bindingScope || resume()?.recovery === "context_changed" || resume()?.recovery === "read_only") return;
    const epoch = authorityEpoch;
    const frozen = structuredClone(input); Object.freeze(frozen.context); Object.freeze(frozen);
    try { cameraHeldReference(localStorage, scope).hold(frozen.operationId); }
    catch { setError("Could not retain this operation before sending. No arrival was submitted. Restore browser storage first."); setStorageReady(false); return; }
    const current = { scope, operationId: frozen.operationId };
    setHeld(current); setCommand(frozen); setResume(undefined); setResumeCommand(undefined); setRecoveryQr(""); setReacquiring(false); setPending(true); setDecision(undefined); setError("");
    retained.set(identityKey(frozen), frozen);
    // Hold is durable before the cue; the cue precedes the asynchronous POST.
    if (fromCamera) { if (props.compact) setLastFeedback(undefined); captured(frozen.operationId); focus(); }
    try {
      const outcome = await preflightCheckinArrival(frozen);
      if (disposed || epoch !== authorityEpoch || props.verifying || current !== held() || scope !== props.bindingScope) return;
      if ("workflow" in outcome && (outcome.workflow.stationId !== frozen.context.stationId || outcome.workflow.eventId !== frozen.context.eventId)) throw new Error("Mismatched origin");
      update(outcome);
    } catch (failure) {
      if (!disposed && epoch === authorityEpoch && !props.verifying && current === held() && scope === props.bindingScope) {
        if (failure instanceof CheckinArrivalRequestError && failure.denied) { setAccessDenied(true); setDecision(undefined); setLastFeedback(undefined); }
        setError(failure instanceof CheckinArrivalRequestError ? failure.message : "Arrival outcome unknown. Keep this attendee held and refresh station history or retry the exact command.");
        focus();
      }
    } finally { if (!disposed) { setPending(false); void refreshHeld(); } }
  }
  function scan(value: string) {
    if (held()) {
      if (!reacquiring() || !recoveryAvailable()) return;
      if (!isCheckinArrivalQrIdentity(value)) { setError("Not an attendee QR. Reacquire the same attendee QR."); return; }
      setRecoveryQr(value); setReacquiring(false); captured(`${held()?.operationId}:reacquired`); focus(); return;
    }
    if (!enabled() || held() || pending() || invalid()) return;
    if (!isCheckinArrivalQrIdentity(value)) {
      setInvalid("Not an attendee QR. Use the exact Hi.Events attendee QR; station provisioning links cannot authorize admission.");
      invalidSequence++;
      requestAnimationFrame(() => { if (!disposed && !props.verifying) feedback?.focus({ preventScroll: true }); }); return;
    }
    const context = props.context; const scope = props.bindingScope;
    if (!context || !scope) return;
    const input = { operationId: crypto.randomUUID(), context, qrIdentity: value, affiliationChoice: "fetch" as const };
    void send(retained.get(identityKey(input)) ?? input, scope, true);
  }
  async function sendResume(input: CheckinArrivalResumeInput) {
    const current = held(); const epoch = authorityEpoch;
    if (!current || !visible() || pending() || !storageReady() || resume()?.recovery === "context_changed" || resume()?.recovery === "read_only") return;
    const frozen = Object.freeze(structuredClone(input));
    const nextId = frozen.action === "replay" ? frozen.operationId : frozen.nextOperationId;
    try { cameraHeldReference(localStorage, current.scope).hold(nextId); }
    catch { setStorageReady(false); setError("Cannot retain recovery operation. Nothing was submitted."); return; }
    const next = { ...current, operationId: nextId };
    setHeld(next); setResumeCommand(frozen); retainedResume.set(nextId, frozen);
    setCommand(undefined); setResume(undefined); setReacquiring(false); setRecoveryQr(""); setPending(true); setError("");
    try {
      const result = await resumeCheckinArrival(frozen);
      if (!disposed && epoch === authorityEpoch && next === held() && visible()) { setResumeCommand(undefined); retainedResume.delete(nextId); setRecoveryQr(frozen.qrIdentity); update(result); }
    } catch (failure) {
      if (!disposed && epoch === authorityEpoch && next === held() && visible()) {
        if (failure instanceof CheckinArrivalRequestError && failure.denied) { setAccessDenied(true); setDecision(undefined); setLastFeedback(undefined); }
        setError(failure instanceof Error ? failure.message : "Recovery outcome unknown. Retry the same recovery command."); focus();
      }
    } finally { if (!disposed) { setPending(false); void refreshHeld(); } }
  }
  function continueRecovery(action: "replay" | "retry" | "blank") {
    const descriptor = resume(); const qrIdentity = recoveryQr() || command()?.qrIdentity;
    if (!descriptor || !recoveryAvailable() || !descriptor.actions.includes(action) || !qrIdentity) return;
    void sendResume(action === "replay"
      ? { operationId: descriptor.operationId, action, qrIdentity }
      : { operationId: descriptor.operationId, action, nextOperationId: crypto.randomUUID(), qrIdentity });
  }
  const compactHasResult = () => !!held() || !!invalid() || !!error();
  const safeNext = () => visible() && !pending() && !error() && cameraDecisionSettled(decision());
  return <Show when={props.compact} fallback={<section aria-label="Camera arrival" class="space-y-4 border-b border-base-content/20 pb-5 min-w-0 break-words">
    <h3 class="text-lg font-bold">Scan attendee QR</h3>
    <p>Station: {props.stationLabel || "Unverified"} · Event: {props.eventTitle || "Unverified"}</p>
    <p>One scan starts the durable arrival flow without a preview-confirmation tap. Keep this attendee here until the print protocol completes or explicitly park the exception. Event-use approval remains disabled.</p>
    <CheckinCameraScanner purpose="attendee" enabled={held() ? reacquiring() && recoveryAvailable() : enabled()} held={(!!held() && !reacquiring()) || !!invalid()} scope={accessDenied() ? undefined : props.bindingScope} onDecode={scan} />
    <Show when={!enabled()}><p role="status">New camera intake is paused: verify login, station, event and live printer/coordinator readiness. Held work is not cancelled.</p></Show>
    <button type="button" class="btn btn-outline min-h-12" disabled={readiness.loading} onClick={() => void refreshReadiness()}>Refresh camera readiness</button>
    <section ref={(element) => { feedback = element; }} aria-label="Held camera arrival" tabindex="-1" aria-live="polite" class="space-y-3 focus-visible:outline focus-visible:outline-2">
      <Show when={invalid()}><p role="alert">{invalid()}</p><button type="button" class="btn min-h-12" onClick={() => setInvalid("")}>Dismiss invalid QR</button></Show>
      <Show when={error()}><p role="alert">{error()}</p></Show>
      <Show when={held()}>
        <Show when={visible()} fallback={<p>Held work belongs to an unverified or previous binding. It is not shown or transferred here. Recover it through the owning station's history.</p>}>
          <p class="font-bold">Camera paused — attendee held</p>
          <Show when={pending()}><p>Submitting this exact arrival command…</p></Show>
          <Show when={!error() && decision()}>{(value) => <ArrivalDecision decision={value()} />}</Show>
          <p class="text-sm break-all">Operation {held()?.operationId}</p>
          <Show when={!command()}><p>Recovered through station history after navigation or login. QR text was not stored. A missing history result is still unknown, not permission to rescan.</p></Show>
          <Show when={cameraDecisionSettled(decision()) && !error()}><p role="status">Result complete. Scanning resumes shortly; remove the previous QR. Protocol completion does not prove label quality.</p></Show>
          <Show when={resume()?.recovery === "context_changed" || (heldWorkflow() && props.context && heldWorkflow()!.eventId !== props.context.eventId)}><p role="alert">Recovery blocked: originating context changed. This work is read-only and cannot be retargeted to the current event. Do not start a new intake for this attendee.</p></Show>
          <Show when={resume()?.recovery === "read_only" || heldWorkflow()}><p>Recovery is read-only. No new admission or continuation is available; resolve existing work at its owning station.</p></Show>
          <Show when={resume()?.recovery === "available"}>
            <p>Recovery uses the frozen originating station and event, not this phone's current selection. Reacquire the same QR; the server verifies its identity.</p>
            <Show when={!command() && !resumeCommand()}>
              <button type="button" class="btn min-h-12" disabled={!recoveryAvailable()} onClick={() => { setRecoveryQr(""); setReacquiring(true); }}>Reacquire held QR with camera</button>
              <label class="block">Held attendee QR (camera unavailable only)
                <input class="input input-bordered min-h-12 w-full min-w-0" autocomplete="off" autocapitalize="off" spellcheck={false} maxlength={2048} value={recoveryQr()} disabled={!recoveryAvailable()} onInput={(event) => { setRecoveryQr(event.currentTarget.value); setReacquiring(false); }} />
              </label>
            </Show>
            <Show when={recoveryQr()}><p role="status">QR reacquired in memory only. Choose the explicit recovery action below.</p></Show>
            <div class="flex flex-wrap gap-3"><For each={resume()?.actions}>{(action) => <button type="button" class="btn min-h-12 h-auto max-w-full whitespace-normal" disabled={!recoveryAvailable() || !(recoveryQr() || command()?.qrIdentity) || !!resumeCommand()} onClick={() => continueRecovery(action)}>{action === "blank" ? "Use blank camera affiliation" : action === "retry" ? "Retry camera preflight reads" : "Replay held camera preflight"}</button>}</For></div>
          </Show>
          <div class="flex flex-wrap gap-3">
            <button type="button" class="btn btn-outline min-h-12" disabled={pending() || reading()} onClick={() => void refreshHeld()}>Refresh held arrival</button>
            <Show when={command() && error()}><button type="button" class="btn btn-warning min-h-12" disabled={pending() || props.verifying || resume()?.recovery === "context_changed" || resume()?.recovery === "read_only"} onClick={() => { const input = command(); const scope = held()?.scope; if (input && scope) void send(input, scope); }}>Retry same camera command</button></Show>
            <Show when={resumeCommand() && error()}><button type="button" class="btn btn-warning min-h-12" disabled={pending() || props.verifying || resume()?.recovery === "context_changed" || resume()?.recovery === "read_only"} onClick={() => { const input = resumeCommand(); if (input) void sendResume(input); }}>Retry same recovery command</button></Show>
            <button type="button" class="btn btn-warning min-h-12 h-auto max-w-full min-w-0 whitespace-normal py-3" disabled={pending()} onClick={release}>{cameraDecisionSettled(decision()) && !error() ? "Scan next attendee" : "Park exception and scan unrelated attendee"}</button>
          </div>
          <p>Parking only releases this phone. Admission uncertainty stays with an admin; physical output uncertainty still blocks the station printer. Parking never cancels, transfers, retries or prints this work.</p>
        </Show>
      </Show>
    </section>
    <Show when={visibleLastFeedback()}>{(last) => <section aria-label="Last camera result" class="rounded-lg border border-base-content/20 p-3 space-y-2" aria-live="polite">
      <h4 class="font-bold">Last camera result</h4>
      <p>This feedback is from the previous held arrival. Releasing this phone did not cancel or resolve its work; station history is the live record.</p>
      <Show when={last().error}><p role="alert">{last().error}</p></Show>
      <Show when={!last().error && last().decision}>{(outcome) => <ArrivalDecision decision={outcome()} />}</Show>
    </section>}</Show>
    <button type="button" class="btn btn-outline min-h-12" onClick={() => setPaused((value) => !value)}>{paused() ? "Resume WTS intake" : "Pause WTS intake"}</button>
    <p>Native Hi.Events scanning and handwritten fallback are for fresh attendees only. Never use them to retry or transfer an uncertain WTS admission. For accepted work, do not check in again; resolve queued or uncertain printing in station recovery before handwritten fulfillment.</p>
  </section>}>
    <section aria-label="Camera arrival" class="checkin-camera-compact">
      <div class="checkin-camera-stage">
        {/* Hide, never unmount: routine verification and held results keep the
            same video element and stream. Scope loss still stops the scanner. */}
        <div class="checkin-scanner-slot" hidden={compactHasResult() && !reacquiring()}>
          <CheckinCameraScanner compact purpose="attendee" enabled={held() ? reacquiring() && recoveryAvailable() && !accessDenied() : enabled()} held={(!!held() && !reacquiring()) || !!invalid()} scope={accessDenied() ? undefined : props.bindingScope} onDecode={scan} onActivate={scanFeedback.unlock} />
        </div>
        <section ref={(element) => { feedback = element; }} aria-label="Held camera arrival" tabindex="-1" class="checkin-compact-held" hidden={!compactHasResult() || reacquiring()}>
          <CheckinCompactResult decision={decision()} pending={pending()} error={!!error()} invalid={!!invalid()} redacted={props.verifying || !props.bindingScope || (!!held() && !visible())} />
          <div class="checkin-compact-actions">
            <Show when={invalid() && !held()}><button type="button" class="btn btn-primary" disabled={props.verifying} onClick={() => setInvalid("")}>Try attendee QR</button></Show>
            <Show when={held() && visible()}>
              <Show when={safeNext()} fallback={<>
                <Show when={resume()?.recovery === "context_changed" || resume()?.recovery === "read_only"}><p class="text-sm" role="alert">Recovery is read-only. Use the owning station’s Tools.</p></Show>
                <Show when={resume()?.recovery === "available"}>
                  <Show when={!command() && !resumeCommand()}>
                    <button type="button" class="btn btn-outline" disabled={!recoveryAvailable()} onClick={() => { setRecoveryQr(""); setReacquiring(true); }}>Reacquire same QR</button>
                  </Show>
                  <Show when={recoveryQr()}><p role="status" class="text-sm">QR reacquired. Choose how to continue.</p></Show>
                  <For each={resume()?.actions}>{(action) => <button type="button" class="btn btn-outline" disabled={!recoveryAvailable() || !(recoveryQr() || command()?.qrIdentity) || !!resumeCommand()} onClick={() => continueRecovery(action)}>{action === "blank" ? "Use blank affiliation" : action === "retry" ? "Retry check" : "Replay same check"}</button>}</For>
                </Show>
                <Show when={command() && error()}><button type="button" class="btn btn-outline" disabled={pending() || props.verifying || accessDenied() || resume()?.recovery === "context_changed" || resume()?.recovery === "read_only"} onClick={() => { const input = command(); const scope = held()?.scope; if (input && scope) void send(input, scope); }}>Retry same arrival</button></Show>
                <Show when={resumeCommand() && error()}><button type="button" class="btn btn-outline" disabled={pending() || props.verifying || accessDenied() || resume()?.recovery === "context_changed" || resume()?.recovery === "read_only"} onClick={() => { const input = resumeCommand(); if (input) void sendResume(input); }}>Retry same recovery</button></Show>
                <Show when={error()}><button type="button" class="btn btn-outline" disabled={pending() || reading()} onClick={() => void refreshHeld()}>Refresh result</button></Show>
                <details class="checkin-compact-help"><summary>Need help?</summary>
                  <a class="btn btn-outline" href="/checkin-tools" target="_self">Review in Tools</a>
                  <button type="button" class="btn btn-outline" disabled={pending()} onClick={release}>Set aside for help</button>
                  <p>Keep this attendee with a colleague. Their admission and label remain unresolved; this only frees your scanner.</p>
                </details>
              </>}>
                <button type="button" class="btn btn-primary" onClick={() => { if (safeNext()) release(); }}>Scan next attendee</button>
              </Show>
            </Show>
            <Show when={!held() && !!error()}><a class="btn btn-outline" href="/checkin-tools">Open Tools</a></Show>
          </div>
        </section>
        <Show when={captureFlash() && !props.verifying && !!props.bindingScope}><span class="checkin-capture-flash" aria-hidden="true" /></Show>
      </div>
      <Show when={reacquiring()}><button type="button" class="btn btn-outline min-h-12" onClick={() => setReacquiring(false)}>Cancel reacquire</button></Show>
      <div class="checkin-camera-readiness">
        <Show when={!compactHasResult()}><p role="status">{props.verifying ? "Verifying station…" : enabled() ? "Remove the previous QR before scanning." : "Scanning paused."} <Show when={!enabled() && !props.verifying}><button type="button" class="underline" disabled={readiness.loading} onClick={() => void refreshReadiness()}>Check readiness</button></Show></p></Show>
      </div>
    </section>
  </Show>;
}
