import { For, Show, createEffect, createSignal, onCleanup, onSettled, type Accessor } from "solid-js";
import type { CheckinArrivalDecision, CheckinArrivalInput, CheckinArrivalResult, CheckinArrivalWorkflow } from "~/lib/checkin-arrival-contract";
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
import { isFailedPreflightRead, readinessAuthorizes } from "~/components/checkin/arrival-gates";

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

type HeldArrival = { operationId: string; scope: string };
type LastFeedback = { scope: string; decision?: CheckinArrivalDecision; error: string };
interface CameraArrivalView {
  stationLabel: Accessor<string>;
  eventTitle: Accessor<string>;
  verifying: Accessor<boolean>;
  bindingScope: Accessor<string | undefined>;
  held: Accessor<HeldArrival | undefined>;
  command: Accessor<CheckinArrivalInput | undefined>;
  decision: Accessor<CheckinArrivalDecision | undefined>;
  resume: Accessor<CheckinArrivalResume | undefined>;
  resumeCommand: Accessor<CheckinArrivalResumeInput | undefined>;
  recoveryQr: Accessor<string>;
  onRecoveryQrChange(value: string): void;
  reacquiring: Accessor<boolean>;
  pending: Accessor<boolean>;
  reading: Accessor<boolean>;
  error: Accessor<string>;
  invalid: Accessor<string>;
  dismissInvalid(): void;
  paused: Accessor<boolean>;
  togglePaused(): void;
  captureFlash: Accessor<boolean>;
  accessDenied: Accessor<boolean>;
  visible: Accessor<boolean>;
  heldWorkflow: Accessor<CheckinArrivalWorkflow | undefined>;
  visibleLastFeedback: Accessor<LastFeedback | undefined>;
  enabled: Accessor<boolean>;
  readinessLoading: Accessor<boolean>;
  recoveryAvailable: Accessor<boolean>;
  recoveryReadOnly: Accessor<boolean>;
  replayBlocked: Accessor<boolean>;
  recoveryActionBlocked: Accessor<boolean>;
  settled: Accessor<boolean>;
  contextChanged: Accessor<boolean | null | undefined>;
  scannerHeld: Accessor<boolean>;
  scannerScope: Accessor<string | undefined>;
  compactHasResult: Accessor<boolean>;
  safeNext: Accessor<boolean>;
  setFeedback(element: HTMLElement): void;
  refreshReadiness(): Promise<unknown>;
  refreshHeld(): Promise<void>;
  release(): void;
  scan(value: string): void;
  continueRecovery(action: "replay" | "retry" | "blank"): void;
  retryCommand(): void;
  retryResume(): void;
  startReacquire(): void;
  cancelReacquire(): void;
  unlockScanFeedback(): Promise<void>;
}
type HeldRecoveryView = Pick<CameraArrivalView, "command" | "resumeCommand" | "recoveryAvailable" | "startReacquire" | "recoveryQr" | "onRecoveryQrChange" | "cancelReacquire" | "resume" | "recoveryActionBlocked" | "continueRecovery">;
type HeldArrivalView = HeldRecoveryView & Pick<CameraArrivalView, "pending" | "error" | "decision" | "held" | "settled" | "contextChanged" | "heldWorkflow" | "reading" | "refreshHeld" | "replayBlocked" | "retryCommand" | "retryResume" | "release">;
type CompactRecoveryView = Pick<CameraArrivalView, "recoveryReadOnly" | "resume" | "command" | "resumeCommand" | "recoveryAvailable" | "startReacquire" | "recoveryQr" | "recoveryActionBlocked" | "continueRecovery" | "error" | "replayBlocked" | "accessDenied" | "retryCommand" | "retryResume" | "pending" | "reading" | "refreshHeld" | "release">;
type CompactHeldView = CompactRecoveryView & Pick<CameraArrivalView, "setFeedback" | "compactHasResult" | "reacquiring" | "decision" | "invalid" | "verifying" | "bindingScope" | "held" | "visible" | "dismissInvalid" | "safeNext">;
type CompactReadinessView = Pick<CameraArrivalView, "compactHasResult" | "verifying" | "enabled" | "readinessLoading" | "refreshReadiness">;
interface HeldRecoveryControlsProps { arrival: HeldRecoveryView }
interface HeldArrivalDetailsProps { arrival: HeldArrivalView }
interface FullCameraArrivalProps { arrival: HeldArrivalView & Pick<CameraArrivalView, "stationLabel" | "eventTitle" | "reacquiring" | "enabled" | "scannerHeld" | "scannerScope" | "scan" | "readinessLoading" | "refreshReadiness" | "setFeedback" | "invalid" | "dismissInvalid" | "visible" | "visibleLastFeedback" | "paused" | "togglePaused"> }
interface CompactRecoveryActionsProps { arrival: CompactRecoveryView }
interface CompactHeldResultProps { arrival: CompactHeldView }
interface CompactReadinessProps { arrival: CompactReadinessView }
interface CompactCameraArrivalProps { arrival: CompactHeldView & CompactReadinessView & Pick<CameraArrivalView, "scannerHeld" | "scannerScope" | "scan" | "unlockScanFeedback" | "captureFlash" | "cancelReacquire"> }
const deniedFailure = (failure: unknown) => failure instanceof CheckinArrivalRequestError && failure.denied;
// Observing an existing workflow needs station authority, not permission
// to reconstruct another phone's frozen preflight. Only failed/unknown
// preflight reads need the original-context continuation descriptor.
const needsResumeDescriptor = (outcome: CheckinArrivalDecision | null) => !outcome || isFailedPreflightRead(outcome);
const mismatchedOrigin = (outcome: CheckinArrivalDecision, input: CheckinArrivalInput) => "workflow" in outcome && (outcome.workflow.stationId !== input.context.stationId || outcome.workflow.eventId !== input.context.eventId);
const resumeOperationId = (input: CheckinArrivalResumeInput) => input.action === "replay" ? input.operationId : input.nextOperationId;

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
  let authorityScope: string | undefined;
  let authorityVerifying: boolean | undefined;
  createEffect(() => [props.bindingScope, props.verifying] as const, ([scope, verifying]) => {
    // Fresh status objects are not authority changes. Preserve recovery controls
    // on identical polls, but invalidate immediately on either actual fence.
    if (scope === authorityScope && verifying === authorityVerifying) return;
    authorityScope = scope; authorityVerifying = verifying;
    authorityEpoch++; setResume(undefined); setReacquiring(false);
  });
  const [decision, setDecision] = createSignal<CheckinArrivalDecision>();
  const [lastFeedback, setLastFeedback] = createSignal<LastFeedback>();
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
  const intakeOpen = () => storageReady() && !accessDenied() && !props.verifying && !props.manualHeld && !paused() && !!props.context && !!props.bindingScope;
  const stationReady = () => !readiness.error && !readiness.loading && readinessAuthorizes(readiness(), props.bindingScope, props.context?.stationId);
  const enabled = () => intakeOpen() && stationReady();
  const focus = () => requestAnimationFrame(() => { if (!disposed && visible()) feedback?.focus({ preventScroll: true }); });
  const identityKey = (input: CheckinArrivalInput) => `${input.context.bindingId}:${input.context.bindingVersion}:${input.context.eventId}:${input.qrIdentity}`;
  function cancelRelease() { if (releaseTimer !== undefined) window.clearTimeout(releaseTimer); releaseTimer = undefined; }
  const recoveryAvailable = () => visible() && storageReady() && !pending() && !reading() && resume()?.recovery === "available" && !!resume()?.actions.length;
  const recoveryReadOnly = () => resume()?.recovery === "context_changed" || resume()?.recovery === "read_only";
  const replayBlocked = () => pending() || props.verifying || recoveryReadOnly();
  const resumeSendable = () => visible() && !pending() && storageReady() && !recoveryReadOnly();
  const heldStill = (epoch: number, current: HeldArrival) => !disposed && epoch === authorityEpoch && current === held() && visible();
  const commandStill = (epoch: number, current: HeldArrival, scope: string) => !disposed && epoch === authorityEpoch && !props.verifying && current === held() && scope === props.bindingScope;
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
  const canReadHeld = () => visible() && !pending() && !statusInFlight && !document.hidden;
  function applyHeldOutcome(current: HeldArrival, outcome: CheckinArrivalDecision | null) {
    if (!outcome) { setDecision(undefined); setLastFeedback(undefined); cancelRelease(); setError("Held operation is not available. Its outcome remains unknown. Do not rescan or switch this attendee to native Hi.Events."); return; }
    const recoveredCommand = resumeCommand();
    if (recoveredCommand) setRecoveryQr(recoveredCommand.qrIdentity);
    setResumeCommand(undefined); retainedResume.delete(current.operationId);
    // Don't reset the short result timer on every identical status poll.
    if (JSON.stringify(outcome) !== JSON.stringify(decision()) || (!props.compact && cameraDecisionSettled(outcome) && releaseTimer === undefined)) update(outcome);
    else setError("");
  }
  function failHeldRead(failure: unknown) {
    if (deniedFailure(failure)) setAccessDenied(true);
    setDecision(undefined); setLastFeedback(undefined); setResume(undefined); cancelRelease(); setError("Cannot verify held work. Check your login, role and station, then refresh held arrival. The last result is unverified; do not retry admission elsewhere.");
  }
  async function refreshHeld() {
    const current = held();
    if (!current || !canReadHeld()) return;
    statusInFlight = true;
    // A same-authority observation must not disable or blur the settled retry
    // control. Failed/initial reads still block until a descriptor is verified.
    setReading(!resume() || !!error());
    const epoch = authorityEpoch;
    try {
      const status = await checkinArrivalStatus(current.operationId);
      if (!heldStill(epoch, current)) return;
      const outcome = status.result;
      const descriptor = needsResumeDescriptor(outcome) ? await getCheckinArrivalResume(current.operationId) : undefined;
      if (!heldStill(epoch, current)) return;
      setResume(descriptor);
      applyHeldOutcome(current, outcome);
    } catch (failure) {
      if (heldStill(epoch, current)) failHeldRead(failure);
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
  const resumeConflict = (operationId: string) => pending() || props.manualHeld || (held() && held()?.operationId !== operationId);
  createEffect(() => props.resumeRequest, (request) => {
    if (!request || props.verifying || request.scope !== props.bindingScope || !storageReady()) return;
    if (resumeConflict(request.operationId)) {
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

  function announceCapture(operationId: string) {
    if (props.compact) setLastFeedback(undefined);
    captured(operationId); focus();
  }
  function acceptCommandOutcome(outcome: CheckinArrivalResult, frozen: CheckinArrivalInput) {
    if (mismatchedOrigin(outcome, frozen)) throw new Error("Mismatched origin");
    update(outcome);
  }
  function redactDenied(failure: unknown) {
    if (deniedFailure(failure)) { setAccessDenied(true); setDecision(undefined); setLastFeedback(undefined); }
  }
  function failCommand(failure: unknown) {
    redactDenied(failure);
    setError(failure instanceof CheckinArrivalRequestError ? failure.message : "Arrival outcome unknown. Keep this attendee held and refresh station history or retry the exact command.");
    focus();
  }
  async function send(input: CheckinArrivalInput, scope: string, fromCamera = false) {
    // Fresh intake is gated in scan(); an exact frozen replay must not depend
    // on the mutable event catalogue. Human/binding verification still applies.
    if (replayBlocked() || scope !== props.bindingScope) return;
    const epoch = authorityEpoch;
    const frozen = structuredClone(input); Object.freeze(frozen.context); Object.freeze(frozen);
    try { cameraHeldReference(localStorage, scope).hold(frozen.operationId); }
    catch { setError("Could not retain this operation before sending. No arrival was submitted. Restore browser storage first."); setStorageReady(false); return; }
    const current = { scope, operationId: frozen.operationId };
    setHeld(current); setCommand(frozen); setResume(undefined); setResumeCommand(undefined); setRecoveryQr(""); setReacquiring(false); setPending(true); setDecision(undefined); setError("");
    retained.set(identityKey(frozen), frozen);
    // Hold is durable before the cue; the cue precedes the asynchronous POST.
    if (fromCamera) announceCapture(frozen.operationId);
    try {
      const outcome = await preflightCheckinArrival(frozen);
      if (!commandStill(epoch, current, scope)) return;
      acceptCommandOutcome(outcome, frozen);
    } catch (failure) {
      if (commandStill(epoch, current, scope)) failCommand(failure);
    } finally { if (!disposed) { setPending(false); void refreshHeld(); } }
  }
  function reacquire(value: string) {
    if (!reacquiring() || !recoveryAvailable()) return;
    if (!isCheckinArrivalQrIdentity(value)) { setError("Not an attendee QR. Reacquire the same attendee QR."); return; }
    setRecoveryQr(value); setReacquiring(false); captured(`${held()?.operationId}:reacquired`); focus();
  }
  function scan(value: string) {
    if (held()) { reacquire(value); return; }
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
  function failResume(failure: unknown) {
    redactDenied(failure);
    setError(failure instanceof Error ? failure.message : "Recovery outcome unknown. Retry the same recovery command."); focus();
  }
  async function sendResume(input: CheckinArrivalResumeInput) {
    const current = held(); const epoch = authorityEpoch;
    if (!current || !resumeSendable()) return;
    const frozen = Object.freeze(structuredClone(input));
    const nextId = resumeOperationId(frozen);
    try { cameraHeldReference(localStorage, current.scope).hold(nextId); }
    catch { setStorageReady(false); setError("Cannot retain recovery operation. Nothing was submitted."); return; }
    const next = { ...current, operationId: nextId };
    setHeld(next); setResumeCommand(frozen); retainedResume.set(nextId, frozen);
    setCommand(undefined); setResume(undefined); setReacquiring(false); setRecoveryQr(""); setPending(true); setError("");
    try {
      const result = await resumeCheckinArrival(frozen);
      if (heldStill(epoch, next)) { setResumeCommand(undefined); retainedResume.delete(nextId); setRecoveryQr(frozen.qrIdentity); update(result); }
    } catch (failure) {
      if (heldStill(epoch, next)) failResume(failure);
    } finally { if (!disposed) { setPending(false); void refreshHeld(); } }
  }
  function continueRecovery(action: "replay" | "retry" | "blank") {
    const descriptor = resume(); const qrIdentity = recoveryQrIdentity();
    if (!descriptor || !recoveryAvailable() || !descriptor.actions.includes(action) || !qrIdentity) return;
    void sendResume(action === "replay"
      ? { operationId: descriptor.operationId, action, qrIdentity }
      : { operationId: descriptor.operationId, action, nextOperationId: crypto.randomUUID(), qrIdentity });
  }
  const recoveryQrIdentity = () => recoveryQr() || command()?.qrIdentity;
  const recoveryActionBlocked = () => !recoveryAvailable() || !recoveryQrIdentity() || !!resumeCommand();
  const settled = () => cameraDecisionSettled(decision()) && !error();
  const contextChanged = () => resume()?.recovery === "context_changed" || (heldWorkflow() && props.context && heldWorkflow()!.eventId !== props.context.eventId);
  const scannerHeld = () => (!!held() && !reacquiring()) || !!invalid();
  const scannerScope = () => accessDenied() ? undefined : props.bindingScope;
  function retryCommand() { const input = command(); const scope = held()?.scope; if (input && scope) void send(input, scope); }
  function retryResume() { const input = resumeCommand(); if (input) void sendResume(input); }
  function startReacquire() { setRecoveryQr(""); setReacquiring(true); }
  function cancelReacquire() { setReacquiring(false); }
  function dismissInvalid() { setInvalid(""); }
  function togglePaused() { setPaused((value) => !value); }
  const compactHasResult = () => !!held() || !!invalid() || !!error();
  const safeNext = () => visible() && !pending() && !error() && cameraDecisionSettled(decision());
  const arrival: CameraArrivalView = {
    stationLabel: () => props.stationLabel, eventTitle: () => props.eventTitle, verifying: () => props.verifying, bindingScope: () => props.bindingScope,
    held, command, decision, resume, resumeCommand, recoveryQr, onRecoveryQrChange: setRecoveryQr, reacquiring, pending, reading, error, invalid, dismissInvalid,
    paused, togglePaused, captureFlash, accessDenied, visible, heldWorkflow, visibleLastFeedback, enabled, readinessLoading: () => readiness.loading,
    recoveryAvailable, recoveryReadOnly, replayBlocked, recoveryActionBlocked, settled, contextChanged, scannerHeld, scannerScope, compactHasResult, safeNext,
    setFeedback: (element) => { feedback = element; }, refreshReadiness, refreshHeld, release, scan, continueRecovery, retryCommand, retryResume, startReacquire, cancelReacquire,
    unlockScanFeedback: scanFeedback.unlock,
  };
  return <Show when={props.compact} fallback={<FullCameraArrival arrival={arrival} />}><CompactCameraArrival arrival={arrival} /></Show>;
}

function HeldRecoveryControls(props: HeldRecoveryControlsProps) {
  return <>
    <p>Recovery uses the frozen originating station and event, not this phone's current selection. Reacquire the same QR; the server verifies its identity.</p>
    <Show when={!props.arrival.command() && !props.arrival.resumeCommand()}>
      <button type="button" class="btn min-h-12" disabled={!props.arrival.recoveryAvailable()} onClick={props.arrival.startReacquire}>Reacquire held QR with camera</button>
      <label class="block">Held attendee QR (camera unavailable only)
        <input class="input input-bordered min-h-12 w-full min-w-0" autocomplete="off" autocapitalize="off" spellcheck={false} maxlength={2048} value={props.arrival.recoveryQr()} disabled={!props.arrival.recoveryAvailable()} onInput={(event) => { props.arrival.onRecoveryQrChange(event.currentTarget.value); props.arrival.cancelReacquire(); }} />
      </label>
    </Show>
    <Show when={props.arrival.recoveryQr()}><p role="status">QR reacquired in memory only. Choose the explicit recovery action below.</p></Show>
    <div class="flex flex-wrap gap-3"><For each={props.arrival.resume()?.actions}>{(action) => <button type="button" class="btn min-h-12 h-auto max-w-full whitespace-normal" disabled={props.arrival.recoveryActionBlocked()} onClick={() => props.arrival.continueRecovery(action)}>{action === "blank" ? "Use blank camera affiliation" : action === "retry" ? "Retry camera preflight reads" : "Replay held camera preflight"}</button>}</For></div>
  </>;
}
function HeldArrivalDetails(props: HeldArrivalDetailsProps) {
  return <>
    <p class="font-bold">Camera paused — attendee held</p>
    <Show when={props.arrival.pending()}><p>Submitting this exact arrival command…</p></Show>
    <Show when={!props.arrival.error() && props.arrival.decision()}>{(value) => <ArrivalDecision decision={value()} />}</Show>
    <p class="text-sm break-all">Operation {props.arrival.held()?.operationId}</p>
    <Show when={!props.arrival.command()}><p>Recovered through station history after navigation or login. QR text was not stored. A missing history result is still unknown, not permission to rescan.</p></Show>
    <Show when={props.arrival.settled()}><p role="status">Result complete. Scanning resumes shortly; remove the previous QR. Protocol completion does not prove label quality.</p></Show>
    <Show when={props.arrival.contextChanged()}><p role="alert">Recovery blocked: originating context changed. This work is read-only and cannot be retargeted to the current event. Do not start a new intake for this attendee.</p></Show>
    <Show when={props.arrival.resume()?.recovery === "read_only" || props.arrival.heldWorkflow()}><p>Recovery is read-only. No new admission or continuation is available; resolve existing work at its owning station.</p></Show>
    <Show when={props.arrival.resume()?.recovery === "available"}><HeldRecoveryControls arrival={props.arrival} /></Show>
    <div class="flex flex-wrap gap-3">
      <button type="button" class="btn btn-outline min-h-12" disabled={props.arrival.pending() || props.arrival.reading()} onClick={() => void props.arrival.refreshHeld()}>Refresh held arrival</button>
      <Show when={props.arrival.command() && props.arrival.error()}><button type="button" class="btn btn-warning min-h-12" disabled={props.arrival.replayBlocked()} onClick={props.arrival.retryCommand}>Retry same camera command</button></Show>
      <Show when={props.arrival.resumeCommand() && props.arrival.error()}><button type="button" class="btn btn-warning min-h-12" disabled={props.arrival.replayBlocked()} onClick={props.arrival.retryResume}>Retry same recovery command</button></Show>
      <button type="button" class="btn btn-warning min-h-12 h-auto max-w-full min-w-0 whitespace-normal py-3" disabled={props.arrival.pending()} onClick={props.arrival.release}>{props.arrival.settled() ? "Scan next attendee" : "Park exception and scan unrelated attendee"}</button>
    </div>
    <p>Parking only releases this phone. Admission uncertainty stays with an admin; physical output uncertainty still blocks the station printer. Parking never cancels, transfers, retries or prints this work.</p>
  </>;
}
function FullCameraArrival(props: FullCameraArrivalProps) {
  return <section aria-label="Camera arrival" class="space-y-4 border-b border-base-content/20 pb-5 min-w-0 break-words">
    <h3 class="text-lg font-bold">Scan attendee QR</h3>
    <p>Station: {props.arrival.stationLabel() || "Unverified"} · Event: {props.arrival.eventTitle() || "Unverified"}</p>
    <p>One scan starts the durable arrival flow without a preview-confirmation tap. Keep this attendee here until the print protocol completes or explicitly park the exception. Event-use approval remains disabled.</p>
    <CheckinCameraScanner enabled={props.arrival.held() ? props.arrival.reacquiring() && props.arrival.recoveryAvailable() : props.arrival.enabled()} held={props.arrival.scannerHeld()} scope={props.arrival.scannerScope()} onDecode={props.arrival.scan} />
    <Show when={!props.arrival.enabled()}><p role="status">New camera intake is paused: verify login, station, event and live printer/coordinator readiness. Held work is not cancelled.</p></Show>
    <button type="button" class="btn btn-outline min-h-12" disabled={props.arrival.readinessLoading()} onClick={() => void props.arrival.refreshReadiness()}>Refresh camera readiness</button>
    <section ref={(element) => { props.arrival.setFeedback(element); }} aria-label="Held camera arrival" tabindex="-1" aria-live="polite" class="space-y-3 focus-visible:outline focus-visible:outline-2">
      <Show when={props.arrival.invalid()}><p role="alert">{props.arrival.invalid()}</p><button type="button" class="btn min-h-12" onClick={() => props.arrival.dismissInvalid()}>Dismiss invalid QR</button></Show>
      <Show when={props.arrival.error()}><p role="alert">{props.arrival.error()}</p></Show>
      <Show when={props.arrival.held()}>
        <Show when={props.arrival.visible()} fallback={<p>Held work belongs to an unverified or previous binding. It is not shown or transferred here. Recover it through the owning station's history.</p>}>
          <HeldArrivalDetails arrival={props.arrival} />
        </Show>
      </Show>
    </section>
    <Show when={props.arrival.visibleLastFeedback()}>{(last) => <section aria-label="Last camera result" class="rounded-lg border border-base-content/20 p-3 space-y-2" aria-live="polite">
      <h4 class="font-bold">Last camera result</h4>
      <p>This feedback is from the previous held arrival. Releasing this phone did not cancel or resolve its work; station history is the live record.</p>
      <Show when={last().error}><p role="alert">{last().error}</p></Show>
      <Show when={!last().error && last().decision}>{(outcome) => <ArrivalDecision decision={outcome()} />}</Show>
    </section>}</Show>
    <button type="button" class="btn btn-outline min-h-12" onClick={() => props.arrival.togglePaused()}>{props.arrival.paused() ? "Resume WTS intake" : "Pause WTS intake"}</button>
    <p>Native Hi.Events scanning and handwritten fallback are for fresh attendees only. Never use them to retry or transfer an uncertain WTS admission. For accepted work, do not check in again; resolve queued or uncertain printing in station recovery before handwritten fulfillment.</p>
  </section>;
}
function CompactRecoveryActions(props: CompactRecoveryActionsProps) {
  return <>
    <Show when={props.arrival.recoveryReadOnly()}><p class="text-sm" role="alert">Recovery is read-only. Use the owning station’s Tools.</p></Show>
    <Show when={props.arrival.resume()?.recovery === "available"}>
      <Show when={!props.arrival.command() && !props.arrival.resumeCommand()}>
        <button type="button" class="btn btn-outline" disabled={!props.arrival.recoveryAvailable()} onClick={props.arrival.startReacquire}>Reacquire same QR</button>
      </Show>
      <Show when={props.arrival.recoveryQr()}><p role="status" class="text-sm">QR reacquired. Choose how to continue.</p></Show>
      <For each={props.arrival.resume()?.actions}>{(action) => <button type="button" class="btn btn-outline" disabled={props.arrival.recoveryActionBlocked()} onClick={() => props.arrival.continueRecovery(action)}>{action === "blank" ? "Use blank affiliation" : action === "retry" ? "Retry check" : "Replay same check"}</button>}</For>
    </Show>
    <Show when={props.arrival.command() && props.arrival.error()}><button type="button" class="btn btn-outline" disabled={props.arrival.replayBlocked() || props.arrival.accessDenied()} onClick={props.arrival.retryCommand}>Retry same arrival</button></Show>
    <Show when={props.arrival.resumeCommand() && props.arrival.error()}><button type="button" class="btn btn-outline" disabled={props.arrival.replayBlocked() || props.arrival.accessDenied()} onClick={props.arrival.retryResume}>Retry same recovery</button></Show>
    <Show when={props.arrival.error()}><button type="button" class="btn btn-outline" disabled={props.arrival.pending() || props.arrival.reading()} onClick={() => void props.arrival.refreshHeld()}>Refresh result</button></Show>
    <details class="checkin-compact-help"><summary>Need help?</summary>
      <a class="btn btn-outline" href="/checkin-tools" target="_self">Review in Tools</a>
      <button type="button" class="btn btn-outline" disabled={props.arrival.pending()} onClick={props.arrival.release}>Set aside for help</button>
      <p>Keep this attendee with a colleague. Their admission and label remain unresolved; this only frees your scanner.</p>
    </details>
  </>;
}
function CompactHeldResult(props: CompactHeldResultProps) {
  return <section ref={(element) => { props.arrival.setFeedback(element); }} aria-label="Held camera arrival" tabindex="-1" class="checkin-compact-held" hidden={!props.arrival.compactHasResult() || props.arrival.reacquiring()}>
    <CheckinCompactResult decision={props.arrival.decision()} pending={props.arrival.pending()} error={!!props.arrival.error()} invalid={!!props.arrival.invalid()} redacted={props.arrival.verifying() || !props.arrival.bindingScope() || (!!props.arrival.held() && !props.arrival.visible())} />
    <div class="checkin-compact-actions">
      <Show when={props.arrival.invalid() && !props.arrival.held()}><button type="button" class="btn btn-primary" disabled={props.arrival.verifying()} onClick={() => props.arrival.dismissInvalid()}>Try attendee QR</button></Show>
      <Show when={props.arrival.held() && props.arrival.visible()}>
        <Show when={props.arrival.safeNext()} fallback={<CompactRecoveryActions arrival={props.arrival} />}>
          <button type="button" class="btn btn-primary" onClick={() => { if (props.arrival.safeNext()) props.arrival.release(); }}>Scan next attendee</button>
        </Show>
      </Show>
      <Show when={!props.arrival.held() && !!props.arrival.error()}><a class="btn btn-outline" href="/checkin-tools">Open Tools</a></Show>
    </div>
  </section>;
}
function CompactReadiness(props: CompactReadinessProps) {
  return <div class="checkin-camera-readiness">
    <Show when={!props.arrival.compactHasResult()}><p role="status">{props.arrival.verifying() ? "Verifying station…" : props.arrival.enabled() ? "Remove the previous QR before scanning." : "Scanning paused."} <Show when={!props.arrival.enabled() && !props.arrival.verifying()}><button type="button" class="underline" disabled={props.arrival.readinessLoading()} onClick={() => void props.arrival.refreshReadiness()}>Check readiness</button></Show></p></Show>
  </div>;
}
function CompactCameraArrival(props: CompactCameraArrivalProps) {
  return <section aria-label="Camera arrival" class="checkin-camera-compact">
    <div class="checkin-camera-stage">
      {/* Hide, never unmount: routine verification and held results keep the
          same video element and stream. Scope loss still stops the scanner. */}
      <div class="checkin-scanner-slot" hidden={props.arrival.compactHasResult() && !props.arrival.reacquiring()}>
        <CheckinCameraScanner compact enabled={props.arrival.held() ? props.arrival.reacquiring() && props.arrival.recoveryAvailable() && !props.arrival.accessDenied() : props.arrival.enabled()} held={props.arrival.scannerHeld()} scope={props.arrival.scannerScope()} onDecode={props.arrival.scan} onActivate={props.arrival.unlockScanFeedback} />
      </div>
      <CompactHeldResult arrival={props.arrival} />
      <Show when={props.arrival.captureFlash() && !props.arrival.verifying() && !!props.arrival.bindingScope()}><span class="checkin-capture-flash" aria-hidden="true" /></Show>
    </div>
    <Show when={props.arrival.reacquiring()}><button type="button" class="btn btn-outline min-h-12" onClick={() => props.arrival.cancelReacquire()}>Cancel reacquire</button></Show>
    <CompactReadiness arrival={props.arrival} />
  </section>;
}
