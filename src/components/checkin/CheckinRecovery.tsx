import { For, Show, createEffect, createSignal, onCleanup, onSettled, type Accessor } from "solid-js";
import type { RecoveryCommand, RecoveryWorkflow, RecoveryReadResult } from "~/lib/checkin-recovery-contract";
import type { RecoveryHistory, RecoveryPreview } from "~/lib/checkin-recovery-client-contract";
import { RecoveryRequestError, createRecoveryCommandSlot, getRecovery, recoveryHistory, reconcileRecovery, previewRecovery } from "~/lib/checkin-recovery-client";

import { CheckinRecoveryAttemptHistory } from "./CheckinRecoveryAttemptHistory";

type Action = RecoveryCommand extends infer C ? C extends RecoveryCommand ? Omit<C, "operationId" | "workflowId" | "expectedVersion"> : never : never;
export interface CheckinRecoveryProps {
  /** Authenticated user + binding/version identity, never a token. Change on login,
   * role or binding changes. Undefined/unavailable immediately redacts all data. */
  scopeKey?: string;
  unavailable?: boolean;
  workflowId?: string;
  compact?: boolean;
  onBusyChange?: (busy: boolean) => void;
}
export function CheckinOperatorRecovery(props: CheckinRecoveryProps) {
  return <For each={props.scopeKey && (props.compact || !props.unavailable) ? [props.scopeKey] : []}>{scope => <RecoveryPanel workflowId={props.workflowId} admin={false} compact={props.compact} unavailable={props.unavailable} onBusyChange={busy => { if (!props.scopeKey || props.scopeKey === scope) props.onBusyChange?.(busy); }} />}</For>;
}
export function CheckinAdminRecovery(props: CheckinRecoveryProps) {
  return <For each={props.scopeKey && !props.unavailable ? [props.scopeKey] : []}>{() => <RecoveryPanel workflowId={props.workflowId} admin={true} />}</For>;
}
type Attempt = RecoveryWorkflow["attempts"][number];
type TruthOperation = "authorize_initial" | "deny" | "cancel" | "continue" | "reset";
const workLabels: Record<string, string> = { not_submitted: "Waiting", protocol_complete: "Printer finished", handwrite_complete: "Handwritten", admission_uncertain: "Check admission", existing_unattributed: "Needs review", uncertain: "Check output", admission_pending: "Checking in", accepted: "Admitted", rejected: "Not admitted" };
const outputSettled = (attempt: Attempt) => ["completed", "uncertain"].includes(attempt.state);
function attemptLabel(latest?: Attempt) {
  if (latest?.state === "uncertain") return "Check output";
  if (latest?.cancellation === "pending") return "Cancellation pending";
  if (latest?.state === "queued") return "Label queued";
  if (latest?.state === "dispatched") return "Printing";
  return undefined;
}
function workLabel(item: RecoveryWorkflow) {
  if (item.isolated) return "Printer isolated";
  const state = item.fulfillment || item.admissionState;
  return attemptLabel(item.attempts.at(-1)) ?? workLabels[state] ?? state.replaceAll("_", " ").replace(/^\w/, first => first.toUpperCase());
}
type RecoveryReason = "incident" | "erroneous_checkin" | "duplicate" | "wrong_attendee";
interface RecoveryPanelView {
  compact: Accessor<boolean | undefined>;
  admin: Accessor<boolean>;
  unavailable: Accessor<boolean | undefined>;
  title: Accessor<string>;
  work: Accessor<RecoveryWorkflow | undefined>;
  history: Accessor<RecoveryHistory | undefined>;
  historyPages: Accessor<number[]>;
  popHistoryPage(): void;
  pushHistoryPage(): void;
  latest: Accessor<Attempt | undefined>;
  read: Accessor<RecoveryReadResult | undefined>;
  reading: Accessor<boolean>;
  accessible: Accessor<boolean>;
  locked: Accessor<boolean>;
  blocked: Accessor<boolean>;
  admissionRetryConfirmed: Accessor<boolean>;
  onAdmissionRetryConfirmedChange(value: boolean): void;
  reason: Accessor<RecoveryReason>;
  onReasonChange(value: RecoveryReason): void;
  note: Accessor<string>;
  onNoteChange(value: string): void;
  checkinId: Accessor<string>;
  onCheckinIdChange(value: string): void;
  quiescent: Accessor<boolean>;
  onQuiescentChange(value: boolean): void;
  confirmed: Accessor<boolean>;
  onConfirmedChange(value: boolean): void;
  existingRead: Accessor<boolean>;
  resetReady: Accessor<boolean>;
  name: Accessor<string>;
  onNameChange(value: string): void;
  affiliation: Accessor<string>;
  onAffiliationChange(value: string): void;
  fontReady: Accessor<boolean>;
  preview: Accessor<RecoveryPreview | undefined>;
  previewError: Accessor<string>;
  isolated: Accessor<boolean>;
  onIsolatedChange(value: boolean): void;
  handwritten: Accessor<boolean>;
  onHandwrittenChange(value: boolean): void;
  load(id?: string, offset?: number): Promise<void>;
  backToList(): void;
  submit(action?: Action): Promise<void>;
  reconcile(): Promise<void>;
  truth(operation: TruthOperation): void;
  renderPreview(): Promise<void>;
  clearDraft(): void;
  redact(): void;
  replaceableAttempt: Accessor<Attempt | undefined>;
  draftChanged(w: RecoveryWorkflow): boolean;
}
type AdminEvidenceView = Pick<RecoveryPanelView, "blocked" | "reading" | "reconcile" | "read" | "reason" | "onReasonChange" | "note" | "onNoteChange" | "existingRead" | "truth" | "checkinId" | "onCheckinIdChange" | "quiescent" | "onQuiescentChange" | "confirmed" | "onConfirmedChange" | "resetReady">;
type HandwriteView = Pick<RecoveryPanelView, "compact" | "isolated" | "onIsolatedChange" | "handwritten" | "onHandwrittenChange" | "blocked" | "submit">;
type OperatorRecoveryView = HandwriteView & Pick<RecoveryPanelView, "latest" | "name" | "onNameChange" | "affiliation" | "onAffiliationChange" | "clearDraft" | "fontReady" | "renderPreview" | "previewError" | "preview" | "replaceableAttempt" | "draftChanged">;
interface RecoveryHeaderProps { panel: Pick<RecoveryPanelView, "title" | "compact" | "work" | "accessible" | "locked" | "load" | "backToList" | "unavailable"> }
interface RecoveryHistoryListProps { panel: Pick<RecoveryPanelView, "accessible" | "compact" | "work" | "reading" | "history" | "locked" | "load" | "historyPages" | "popHistoryPage" | "pushHistoryPage"> }
interface WorkflowDetailProps {
  panel: AdminEvidenceView & OperatorRecoveryView & Pick<RecoveryPanelView, "admissionRetryConfirmed" | "onAdmissionRetryConfirmedChange" | "admin" | "redact">;
  workflow: RecoveryWorkflow;
}
interface AdminEvidenceProps { panel: AdminEvidenceView; workflow: RecoveryWorkflow }
interface OperatorRecoveryProps { panel: OperatorRecoveryView; workflow: RecoveryWorkflow }
interface HandwriteFulfillmentProps { panel: HandwriteView; workflow: RecoveryWorkflow }
const commandFor = (action?: Action, w?: RecoveryWorkflow) => action && w ? { ...action, operationId: crypto.randomUUID(), workflowId: w.workflowId, expectedVersion: w.version } as RecoveryCommand : undefined;
function RecoveryPanel(props: { workflowId?: string; admin: boolean; compact?: boolean; unavailable?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const slot = createRecoveryCommandSlot();
  let live = true, readGeneration = 0, previewGeneration = 0, authorityGeneration = 0;
  const [denied, setDenied] = createSignal(!!props.unavailable);
  onCleanup(() => { live = false; readGeneration++; previewGeneration++; slot.reset(); const notify = props.onBusyChange; queueMicrotask(() => notify?.(false)); });
  const [history, setHistory] = createSignal<RecoveryHistory>();
  const [historyOffset, setHistoryOffset] = createSignal(0);
  const [historyPages, setHistoryPages] = createSignal<number[]>([]);
  const [work, setWork] = createSignal<RecoveryWorkflow>();
  const [readError, setReadError] = createSignal("");
  const [commandError, setCommandError] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const [retry, setRetry] = createSignal(false);
  const [reading, setReading] = createSignal(false);
  const [read, setRead] = createSignal<RecoveryReadResult>();
  const [name, setName] = createSignal(""); const [affiliation, setAffiliation] = createSignal("");
  const [preview, setPreview] = createSignal<RecoveryPreview>(); const [previewError, setPreviewError] = createSignal("");
  const [fontReady, setFontReady] = createSignal(false);
  const [isolated, setIsolated] = createSignal(false);
  const [handwritten, setHandwritten] = createSignal(false);
  const [admissionRetryConfirmed, setAdmissionRetryConfirmed] = createSignal(false);
  const [confirmed, setConfirmed] = createSignal(false); const [quiescent, setQuiescent] = createSignal(false);
  const [checkinId, setCheckinId] = createSignal("");
  const [reason, setReason] = createSignal<RecoveryReason>("incident");
  const [note, setNote] = createSignal("");
  const latest = () => work()?.attempts.at(-1);
  const blocked = () => !!props.unavailable || denied() || pending() || retry() || !work();
  const accessible = () => !props.unavailable && !denied();
  const busy = () => pending() || retry();
  const locked = () => busy() || reading();
  const currentRead = (generation: number) => live && generation === readGeneration;
  const currentPreview = (generation: number) => live && generation === previewGeneration;
  const currentAuthority = (authority: number) => live && authority === authorityGeneration;
  const isDenial = (error: unknown) => live && error instanceof RecoveryRequestError && error.denied;
  createEffect(busy, value => { props.onBusyChange?.(value); });
  createEffect(() => !!props.unavailable, unavailable => { if (unavailable) redact(); });
  function redact() {
    authorityGeneration++; readGeneration++; previewGeneration++;
    setDenied(true); setHistory(undefined); setWork(undefined); setRead(undefined);
    setName(""); setAffiliation(""); setNote(""); setCheckinId("");
    setAdmissionRetryConfirmed(false); setConfirmed(false); setQuiescent(false); setIsolated(false); setHandwritten(false);
    setPreview(undefined); setPreviewError(""); setReadError(""); setReading(false);
    setCommandError("Recovery access denied. Private evidence cleared. Reverify access before retrying the saved command.");
  }

  function beginRead() { const generation = ++readGeneration; setReading(true); return generation; }
  function endRead(generation: number) { if (currentRead(generation)) setReading(false); }
  async function reverify() {
    if (props.unavailable) return;
    const generation = beginRead();
    try {
      // A fresh authenticated, binding-checked read proves access to the frozen target.
      const id = slot.pending()?.workflowId ?? props.workflowId;
      if (id) await getRecovery(id); else await recoveryHistory();
      if (currentRead(generation)) { setDenied(false); setCommandError(""); }
    } catch { if (currentRead(generation)) redact(); }
    finally { endRead(generation); }
  }
  function clearDraft() { previewGeneration++; setPreview(undefined); setPreviewError(""); }
  function accept(value: RecoveryWorkflow) { setAdmissionRetryConfirmed(false); setWork(value); setName(value.name); setAffiliation(value.affiliation); clearDraft(); setRead(undefined); setConfirmed(false); setQuiescent(false); setCheckinId(""); setIsolated(false); setHandwritten(false); }
  function failLoad(error: unknown, generation: number) {
    if (isDenial(error)) { redact(); return; }
    if (currentRead(generation)) { setReadError(props.compact ? "Couldn't load this page. Refresh to retry; this is not an empty page." : "Recovery evidence unavailable. Refresh explicitly; this is not an empty queue. Saved command retry is unchanged."); setHistory(undefined); setWork(undefined); clearDraft(); }
  }
  async function load(id?: string, offset = historyOffset()) {
    if (!accessible() || busy()) return;
    if (!id) setHistoryOffset(offset);
    const generation = beginRead(); setReadError("");
    try {
      if (id) { const value = await getRecovery(id); if (currentRead(generation)) accept(value); }
      else { const value = await recoveryHistory(offset); if (currentRead(generation)) setHistory(value); }
    } catch (error) { failLoad(error, generation); }
    finally { endRead(generation); }
  }
  /** A new action needs selected work and no saved retry; a bare call retries the saved command. */
  function actionAllowed(action: Action | undefined, w: RecoveryWorkflow | undefined) {
    if (!action) return true;
    if (!w || retry()) return false;
    return action.operation !== "retry_admission_reads" || (w.admissionReadRetryEligible && admissionRetryConfirmed());
  }
  function failCommand(error: unknown, authority: number) {
    if (isDenial(error)) redact();
    else if (currentAuthority(authority)) setCommandError(slot.pending() ? "Command not confirmed. Its saved identity and payload are retained. Retry this exact command; do not create another." : "Command rejected without a confirmed change. Refresh evidence before a new decision.");
  }
  async function submit(action?: Action) {
    if (pending() || !accessible()) return;
    const w = work(); if (!actionAllowed(action, w)) return;
    setAdmissionRetryConfirmed(false);
    setPending(true); setCommandError(""); readGeneration++;
    const authority = authorityGeneration;
    try {
      const result = await slot.submit(commandFor(action, w));
      if (currentAuthority(authority) && !denied() && result) accept(result.workflow);
    } catch (error) { failCommand(error, authority); }
    finally { if (live) { setPending(false); setRetry(!!slot.pending()); setReading(false); } }
  }
  async function renderPreview() {
    const w = work(); if (!w || !fontReady() || blocked()) return;
    const generation = ++previewGeneration; setPreview(undefined); setPreviewError("");
    try { const value = await previewRecovery(w.workflowId, name(), affiliation()); if (currentPreview(generation)) setPreview(value); }
    catch (error) { if (isDenial(error)) redact(); else if (currentPreview(generation)) setPreviewError("Preview unavailable. No label was printed. Check label-only text and retry."); }
  }
  async function reconcile() {
    const w = work(); if (!w || blocked()) return;
    const generation = beginRead(); setRead(undefined); setReadError("");
    try { const value = await reconcileRecovery(w.workflowId); if (currentRead(generation)) setRead(value); }
    catch (error) { if (isDenial(error)) redact(); else if (currentRead(generation)) setReadError("Exact-list reconciliation unavailable. This is not evidence of absence."); }
    finally { endRead(generation); }
  }
  onSettled(() => {
    void load(props.workflowId);
    void Promise.all([400, 700].map(weight => document.fonts.load(`${weight} 16px "WTS Name Label"`, "Ѓорѓи Ќќ Žé gjpq"))).then(faces => { if (live) setFontReady(faces.every(group => group.length > 0 && group.every(face => face.status === "loaded"))); }).catch(() => { if (live) setFontReady(false); });
  });
  const existingRead = () => read()?.state === "existing";
  const resetReady = () => existingRead() && confirmed() && quiescent() && checkinId() === read()!.checkinId && reason() !== "incident";
  function truthCommand(operation: TruthOperation, common: { reason: RecoveryReason; note: string }): Action | undefined {
    if (operation === "authorize_initial") return existingRead() ? { operation, ...common, readId: read()!.id } : undefined;
    if (operation === "reset") return resetReady() ? { operation, ...common, readId: read()!.id, checkinId: checkinId(), confirmed: true, producersQuiescent: true } : undefined;
    return { operation, ...common };
  }
  const truth = (operation: TruthOperation) => {
    const command = truthCommand(operation, { reason: reason(), note: note() });
    if (command) void submit(command);
  };
  /** Only completed or uncertain output can be replaced; uncertain output needs an observation first. */
  const replaceableAttempt = () => { const p = latest(); return p && outputSettled(p) && !(p.state === "uncertain" && !p.observation) ? p : undefined; };
  const draftChanged = (w: RecoveryWorkflow) => name() !== w.name || affiliation() !== w.affiliation;
  const title = () => props.compact ? work() ? "Label recovery" : "Recent work" : props.admin ? "Admission evidence and recovery" : "Recover a label at this station";
  function backToList() {
    if (locked()) return;
    readGeneration++; setWork(undefined); setRead(undefined); setName(""); setAffiliation(""); clearDraft();
    if (!history()) void load();
  }
  const popHistoryPage = () => setHistoryPages(pages => pages.slice(0, -1));
  const pushHistoryPage = () => setHistoryPages(pages => [...pages, historyOffset()]);
  const panel: RecoveryPanelView = {
    compact: () => props.compact, admin: () => props.admin, unavailable: () => props.unavailable, title,
    work, history, historyPages, popHistoryPage, pushHistoryPage, latest, read, reading, accessible, locked, blocked,
    admissionRetryConfirmed, onAdmissionRetryConfirmedChange: setAdmissionRetryConfirmed, reason, onReasonChange: setReason, note, onNoteChange: setNote, checkinId, onCheckinIdChange: setCheckinId,
    quiescent, onQuiescentChange: setQuiescent, confirmed, onConfirmedChange: setConfirmed, existingRead, resetReady,
    name, onNameChange: setName, affiliation, onAffiliationChange: setAffiliation, fontReady, preview, previewError, isolated, onIsolatedChange: setIsolated, handwritten, onHandwrittenChange: setHandwritten,
    load, backToList, submit, reconcile, truth, renderPreview, clearDraft, redact, replaceableAttempt, draftChanged,
  };
  return <section aria-label={props.admin ? "Admin recovery" : "Station label recovery"} class={props.compact ? "recovery-compact min-w-0 space-y-4 break-words" : "wts-name-label-text min-w-0 space-y-4 rounded-lg border border-base-content/20 p-4 break-words"}>
    <RecoveryHeader panel={panel} />
    <Show when={reading()}><p role="status">{props.compact && !work() ? "Loading recent work…" : "Loading recovery evidence…"}</p></Show>
    <Show when={readError()}><p role="alert">{readError()}</p></Show>
    <Show when={commandError()}><p role="alert">{commandError()}</p></Show>
    <Show when={retry()}><button class="btn btn-warning min-h-12" disabled={denied() || pending()} onClick={() => void submit()}>Retry exact saved recovery command</button></Show>
    <Show when={denied()}><button class="btn min-h-12" disabled={props.unavailable || reading() || pending()} onClick={() => void reverify()}>Reverify recovery access</button></Show>
    <Show when={retry()}><p>Saved recovery command: <output aria-label="Saved recovery command ID">{slot.pending()?.operationId}</output></p></Show>
    <RecoveryHistoryList panel={panel} />
    <Show when={accessible() && work()}>{w => <WorkflowDetail panel={panel} workflow={w()} />}</Show>
  </section>;
}

function RecoveryHeader(props: RecoveryHeaderProps) {
  return <>
    <div class="recovery-heading">
      <h2 tabindex="-1" class="text-xl font-bold">{props.panel.title()}</h2>
      <Show when={!props.panel.compact() || !props.panel.work()}><button aria-label="Refresh recovery history" class="btn btn-ghost min-h-12" disabled={!props.panel.accessible() || props.panel.locked()} onClick={() => void props.panel.load()}>{props.panel.compact() ? "Refresh" : "Refresh recovery history"}</button></Show>
    </div>
    <Show when={!props.panel.compact()}><p>Work stays at its original station and event. Parking does not make uncertain printing safe. No action here repeats a possibly-sent admission. A confirmed safe-read retry only renews pre-send work; normal readiness and send fences still apply.</p></Show>
    <Show when={!props.panel.compact() || props.panel.work()}><div class="flex flex-wrap gap-2"><Show when={props.panel.compact()}><button class="btn btn-ghost min-h-12" disabled={props.panel.locked()} onClick={props.panel.backToList}>Back to recent work</button></Show><button class="btn btn-outline min-h-12" disabled={!props.panel.work() || props.panel.unavailable() || props.panel.locked()} onClick={() => void props.panel.load(props.panel.work()?.workflowId)}>Refresh selected evidence</button></div></Show>
  </>;
}
function RecoveryHistoryList(props: RecoveryHistoryListProps) {
  return <Show when={props.panel.accessible() && (!props.panel.compact() || (!props.panel.work() && !props.panel.reading())) && props.panel.history()}>{data => <div>
    <p class="recovery-caption">{props.panel.compact() ? "Unresolved work and today's completed labels." : "Unresolved work and current-day completed history (Europe/Skopje)."}</p>
    <ul class="recovery-list"><For each={data().items}>{item => <li><button class={props.panel.compact() ? "recovery-list-row" : "btn btn-ghost min-h-12 max-w-full h-auto whitespace-normal"} disabled={props.panel.locked()} onClick={() => void props.panel.load(item.workflowId)}><Show when={props.panel.compact()} fallback={<>{item.name} · {item.eventTitle} · {item.stationId} · {item.fulfillment || item.admissionState}{item.parked ? " · parked" : ""}</>}><span><strong>{item.name || "Unnamed attendee"}</strong><small>{item.eventTitle}</small></span><span>{workLabel(item)}<Show when={item.parked}> · Set aside</Show></span></Show></button></li>}</For></ul>
    <Show when={!data().items.length}><p>No work on this page.</p></Show>
    <Show when={props.panel.historyPages().length || data().nextOffset !== null || !props.panel.compact()}><div class="flex flex-wrap gap-2"><Show when={props.panel.historyPages().length}><button class="btn btn-outline min-h-12" disabled={props.panel.locked()} onClick={() => { const previous = props.panel.historyPages().at(-1); if (previous !== undefined) { props.panel.popHistoryPage(); void props.panel.load(undefined, previous); } }}>Previous recovery page</button></Show><button class="btn btn-outline min-h-12" disabled={data().nextOffset === null || props.panel.locked()} onClick={() => { const next = data().nextOffset; if (next !== null) { props.panel.pushHistoryPage(); void props.panel.load(undefined, next); } }}>Next recovery page</button></div></Show>
  </div>}</Show>;
}
function WorkflowDetail(props: WorkflowDetailProps) {
  return <div class="space-y-4">
    <h3 class="font-bold">{props.workflow.name}<Show when={!props.panel.compact()}> · {props.workflow.eventTitle} · {props.workflow.stationId}</Show></h3>
    <Show when={props.panel.compact()} fallback={<p>Admission: {props.workflow.admissionState} · Decision: {props.workflow.decision || "none"} · Fulfillment: {props.workflow.fulfillment || "not resolved"}</p>}><p>{props.workflow.eventTitle} · {workLabel(props.workflow)}</p></Show>
    <Show when={props.workflow.admissionReadRetryEligible}>
      <fieldset class="space-y-2 border p-3"><legend>Admission safe-read budget exhausted</legend>
        <p>Admission has not been sent. Automatic safe reads stopped after the bounded retry budget was exhausted. This request allows up to three more safe-read attempts on the same workflow. The coordinator may then submit admission once only if its normal checks pass. This button does not itself send admission or print.</p>
        <label class="block"><input type="checkbox" checked={props.panel.admissionRetryConfirmed()} disabled={props.panel.blocked()} onChange={e => props.panel.onAdmissionRetryConfirmedChange(e.currentTarget.checked)} /> I confirm a new bounded admission safe-read retry for this attendee.</label>
        <button class="btn btn-warning min-h-12" disabled={props.panel.blocked() || props.panel.reading() || !props.panel.admissionRetryConfirmed()} onClick={() => void props.panel.submit({ operation: "retry_admission_reads" })}>Retry admission safe reads</button>
      </fieldset>
    </Show>
    <Show when={props.workflow.isolated}><p role="status" class="alert alert-warning">Station physically isolated. Keep the printer disconnected until queued output is acknowledged safe and isolation is explicitly released.</p></Show>
    <Show when={!props.panel.admin()} fallback={<AdminEvidence panel={props.panel} workflow={props.workflow} />}>
      <OperatorRecovery panel={props.panel} workflow={props.workflow} />
    </Show>
    <details><summary class="min-h-12 cursor-pointer">Immutable label attempt history</summary><p>{props.workflow.attemptsTruncated === true ? "Showing only the latest 25 attempts; older attempts are available in pages below." : props.workflow.attemptsTruncated === false ? "Latest attempt window (all attempts at this read)." : "Latest attempt window; completeness is not reported by this server."}</p><ol><For each={props.workflow.attempts}>{a => <li class="py-2">{a.purpose} · {a.state} · {a.name} / {a.affiliation || "blank affiliation"} · {a.observation || "no observation"} · predecessor {a.predecessorId || "none"}</li>}</For></ol><For each={[props.workflow.workflowId]}>{id => <CheckinRecoveryAttemptHistory workflowId={id} onDenied={props.panel.redact} />}</For></details>
  </div>;
}
function AdminEvidence(props: AdminEvidenceProps) {
  return <div class="space-y-3">
    <p>Evidence is bounded to 20 reads, admission attempts and resets. Existing is not attributable; absent after possibly-sent never permits a new admission POST.</p>
    <ul><For each={props.workflow.admissionAttempts}>{a => <li>Attempt {a.id}: {a.state} · exact list {a.listId} · attendee {a.attendeeId} · send boundary {a.sendBoundaryAt || "not crossed"}</li>}</For></ul>
    <ul><For each={props.workflow.reads}>{r => <li>Read {r.createdAt}: {r.state} · check-in {r.checkinId || "none"}</li>}</For></ul>
    <ul><For each={props.workflow.resets}>{r => <li>Reset {r.id}: {r.state} · check-in {r.checkinId}</li>}</For></ul>
    <button class="btn min-h-12" disabled={props.panel.blocked() || props.panel.reading()} onClick={() => void props.panel.reconcile()}>Reconcile original exact list</button>
    <Show when={props.panel.read()}>{r => <p role="status">Latest reconciliation: {r().state} · exact check-in {r().checkinId || "none"}</p>}</Show>
    <label class="block">Decision reason<select class="select min-h-12 w-full" value={props.panel.reason()} onChange={e => props.panel.onReasonChange(e.currentTarget.value as RecoveryReason)}><option value="incident">Incident investigation</option><option value="erroneous_checkin">Erroneous check-in</option><option value="duplicate">Duplicate</option><option value="wrong_attendee">Wrong attendee</option></select></label>
    <label class="block">Optional bounded note (no email, QR or credentials)<input class="input min-h-12 w-full" maxlength={200} autocomplete="off" value={props.panel.note()} onInput={e => props.panel.onNoteChange(e.currentTarget.value)} /></label>
    <div class="flex flex-wrap gap-2"><button class="btn min-h-12" disabled={props.panel.blocked() || !props.panel.existingRead() || !!props.workflow.attempts.length} onClick={() => props.panel.truth("authorize_initial")}>Authorize one initial label for existing check-in</button><button class="btn min-h-12" disabled={props.panel.blocked()} onClick={() => props.panel.truth("deny")}>Deny fulfillment</button><button class="btn min-h-12" disabled={props.panel.blocked()} onClick={() => props.panel.truth("continue")}>Continue investigation</button><button class="btn min-h-12" disabled={props.panel.blocked()} onClick={() => props.panel.truth("cancel")}>Request safe cancellation</button></div>
    <fieldset class="space-y-2 border p-3"><legend>Guarded erroneous-check-in reset</legend><p>Stop the system and quiesce every admission producer first. Queued or active output must be neutralized. A reset never grants fresh initial-label eligibility.</p><label class="block">Retype exact upstream check-in ID<input class="input min-h-12 w-full" inputmode="numeric" autocomplete="off" value={props.panel.checkinId()} onInput={e => props.panel.onCheckinIdChange(e.currentTarget.value)} /></label><label class="block"><input type="checkbox" checked={props.panel.quiescent()} onChange={e => props.panel.onQuiescentChange(e.currentTarget.checked)} /> I verified producers are stopped and quiescent.</label><label class="block"><input type="checkbox" checked={props.panel.confirmed()} onChange={e => props.panel.onConfirmedChange(e.currentTarget.checked)} /> I confirm this exact check-in is erroneous and request reset.</label><button class="btn btn-warning min-h-12" disabled={props.panel.blocked() || !props.panel.resetReady() || !props.panel.checkinId()} onClick={() => props.panel.truth("reset")}>Request guarded reset</button></fieldset>
  </div>;
}
function OperatorRecovery(props: OperatorRecoveryProps) {
  return <div class="space-y-3">
    <Show when={props.panel.latest()}>{p => <><p>Latest output: {p().state} · observation: {p().observation || "none"} · cancellation: {p().cancellation || "none"}</p><div class="flex flex-wrap gap-2"><button class="btn min-h-12" disabled={props.panel.blocked() || !outputSettled(p()) || !!p().observation} onClick={() => void props.panel.submit({ operation: "observe", printId: p().id, outcome: "printed" })}>I observed printed output</button><button class="btn min-h-12" disabled={props.panel.blocked() || !outputSettled(p()) || !!p().observation} onClick={() => void props.panel.submit({ operation: "observe", printId: p().id, outcome: "not_printed" })}>I observed no usable output</button></div><p>Observation never automatically prints. Missing or damaged output needs a separate replacement request.</p></>}</Show>
    <details open={!props.panel.compact()} class="recovery-edit"><summary hidden={!props.panel.compact()}>Edit label text</summary><div class="space-y-3">
    <label class="block">Label-only name<input class="input min-h-12 w-full" autocomplete="off" maxlength={200} value={props.panel.name()} onInput={e => { props.panel.clearDraft(); props.panel.onNameChange(e.currentTarget.value); }} /></label><label class="block">Label-only affiliation (blank is allowed)<input class="input min-h-12 w-full" autocomplete="off" maxlength={200} value={props.panel.affiliation()} onInput={e => { props.panel.clearDraft(); props.panel.onAffiliationChange(e.currentTarget.value); }} /></label>
    <p>Corrections never edit Hi.Events. Active output keeps its frozen text; this draft is used only by an explicit later replacement.</p>
    <Show when={!props.panel.fontReady()}><p role="status">Pinned Cyrillic display fonts are not ready. Restore bundled Noto Sans fonts if loading fails.</p></Show>
    <button class="btn min-h-12" disabled={!props.panel.fontReady() || props.panel.blocked()} onClick={() => void props.panel.renderPreview()}>Preview exact label PNG</button><button class="btn min-h-12" disabled={props.panel.blocked() || !props.panel.name().trim()} onClick={() => void props.panel.submit({ operation: "correct", name: props.panel.name(), affiliation: props.panel.affiliation() })}>Save label-only draft</button>
    <Show when={props.panel.previewError()}><p role="alert">{props.panel.previewError()}</p></Show><Show when={props.panel.preview()}>{p => <figure><img class="max-w-full h-auto" src={`data:image/png;base64,${p().pngBase64}`} width={p().width} height={p().height} alt="Exact server-rendered label preview" /><figcaption>Preview from the frozen workflow profile and pinned renderer/font. {p().rows.some(row => row.shortened) ? "Text was visibly shortened to fit." : "No shortening."}</figcaption></figure>}</Show>
    </div></details>
    <Show when={props.workflow.attempts.length >= 2}><p class="alert alert-warning">Two or more label attempts: inspect printer, media and physical output before another replacement. There is no hard replacement cap.</p></Show>
    <button class="btn btn-warning min-h-12" disabled={props.panel.blocked() || props.workflow.isolated || !props.panel.replaceableAttempt() || props.panel.draftChanged(props.workflow)} onClick={() => void props.panel.submit({ operation: "replace", printId: props.panel.latest()!.id })}>Request a new replacement label</button>
    <HandwriteFulfillment panel={props.panel} workflow={props.workflow} />
    <button class="btn btn-ghost min-h-12" disabled={props.panel.blocked()} onClick={() => void props.panel.submit({ operation: props.workflow.parked ? "resume" : "park" })}>{props.workflow.parked ? "Resume this work" : "Park this work"}</button>
    <Show when={props.panel.compact()}><p>Parking sets work aside; it does not cancel printing.</p></Show>
  </div>;
}
function HandwriteFulfillment(props: HandwriteFulfillmentProps) {
  return <details open={!props.panel.compact() || props.workflow.isolated} class="recovery-handwrite"><summary hidden={!props.panel.compact()}><Show when={props.workflow.isolated} fallback="Handwrite instead">Finish handwriting &amp; reconnect</Show></summary>
      <fieldset class="border p-3 space-y-2"><legend>Handwritten fulfillment</legend><p>First request cancellation of queued printing. Pending acknowledgement is not cancelled: wait and refresh, then explicitly finish handwriting. If disconnected or physically uncertain, physically isolate the printer before confirming; leave it disconnected until safe queue acknowledgement and release. Never assume a browser action instantly stops USB output.</p><label class="block"><input type="checkbox" checked={props.panel.isolated()} onChange={e => props.panel.onIsolatedChange(e.currentTarget.checked)} /> I physically isolated the printer and will keep it isolated until safe release.</label><label class="block"><input type="checkbox" checked={props.panel.handwritten()} onChange={e => props.panel.onHandwrittenChange(e.currentTarget.checked)} /> I confirm I have physically handwritten the label. Agent cancellation acknowledgement alone does not mean handwriting is complete.</label><button class="btn min-h-12" disabled={props.panel.blocked() || !props.panel.handwritten()} onClick={() => void props.panel.submit({ operation: "handwrite", physicallyIsolated: props.panel.isolated() })}>{props.workflow.fulfillment === "handwrite_pending" ? "Confirm label was handwritten" : "Request safe handwritten fulfillment"}</button><Show when={props.workflow.isolated}><button class="btn min-h-12" disabled={props.panel.blocked() || props.workflow.attempts.some(a => a.cancellation === "pending")} onClick={() => void props.panel.submit({ operation: "release_isolation", confirmed: true })}>Confirm safe queue and release isolation</button></Show></fieldset>
  </details>;
}
