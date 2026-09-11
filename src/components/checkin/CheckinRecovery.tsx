import { For, Show, createEffect, createSignal, onCleanup, onSettled } from "solid-js";
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
  const [reason, setReason] = createSignal<"incident" | "erroneous_checkin" | "duplicate" | "wrong_attendee">("incident");
  const [note, setNote] = createSignal("");
  const latest = () => work()?.attempts.at(-1);
  const blocked = () => !!props.unavailable || denied() || pending() || retry() || !work();
  createEffect(() => pending() || retry(), busy => { props.onBusyChange?.(busy); });
  createEffect(() => !!props.unavailable, unavailable => { if (unavailable) redact(); });
  function redact() {
    authorityGeneration++; readGeneration++; previewGeneration++;
    setDenied(true); setHistory(undefined); setWork(undefined); setRead(undefined);
    setName(""); setAffiliation(""); setNote(""); setCheckinId("");
    setAdmissionRetryConfirmed(false); setConfirmed(false); setQuiescent(false); setIsolated(false); setHandwritten(false);
    setPreview(undefined); setPreviewError(""); setReadError(""); setReading(false);
    setCommandError("Recovery access denied. Private evidence cleared. Reverify access before retrying the saved command.");
  }
  async function reverify() {
    if (props.unavailable) return;
    const generation = ++readGeneration; setReading(true);
    try {
      // A fresh authenticated, binding-checked read proves access to the frozen target.
      const id = slot.pending()?.workflowId ?? props.workflowId;
      if (id) await getRecovery(id); else await recoveryHistory();
      if (live && generation === readGeneration) { setDenied(false); setCommandError(""); }
    } catch { if (live && generation === readGeneration) redact(); }
    finally { if (live && generation === readGeneration) setReading(false); }
  }
  function clearDraft() { previewGeneration++; setPreview(undefined); setPreviewError(""); }
  function accept(value: RecoveryWorkflow) { setAdmissionRetryConfirmed(false); setWork(value); setName(value.name); setAffiliation(value.affiliation); clearDraft(); setRead(undefined); setConfirmed(false); setQuiescent(false); setCheckinId(""); setIsolated(false); setHandwritten(false); }
  async function load(id?: string, offset = historyOffset()) {
    if (denied() || props.unavailable || pending() || retry()) return;
    if (!id) setHistoryOffset(offset);
    const generation = ++readGeneration; setReading(true); setReadError("");
    try {
      if (id) { const value = await getRecovery(id); if (live && generation === readGeneration) accept(value); }
      else { const value = await recoveryHistory(offset); if (live && generation === readGeneration) setHistory(value); }
    } catch (error) { if (live && error instanceof RecoveryRequestError && error.denied) { redact(); return; } if (live && generation === readGeneration) { setReadError(props.compact ? "Couldn't load this page. Refresh to retry; this is not an empty page." : "Recovery evidence unavailable. Refresh explicitly; this is not an empty queue. Saved command retry is unchanged."); setHistory(undefined); setWork(undefined); clearDraft(); } }
    finally { if (live && generation === readGeneration) setReading(false); }
  }
  async function submit(action?: Action) {
    if (pending() || denied() || props.unavailable) return;
    const w = work(); if (action && (!w || retry())) return;
    if (action?.operation === "retry_admission_reads" && (!w?.admissionReadRetryEligible || !admissionRetryConfirmed())) return;
    setAdmissionRetryConfirmed(false);
    setPending(true); setCommandError(""); readGeneration++;
    const authority = authorityGeneration;
    try {
      const result = await slot.submit(action && w ? { ...action, operationId: crypto.randomUUID(), workflowId: w.workflowId, expectedVersion: w.version } as RecoveryCommand : undefined);
      if (live && authority === authorityGeneration && !denied() && result) accept(result.workflow);
    } catch (error) { if (live && error instanceof RecoveryRequestError && error.denied) redact(); else if (live && authority === authorityGeneration) setCommandError(slot.pending() ? "Command not confirmed. Its saved identity and payload are retained. Retry this exact command; do not create another." : "Command rejected without a confirmed change. Refresh evidence before a new decision."); }
    finally { if (live) { setPending(false); setRetry(!!slot.pending()); setReading(false); } }
  }
  async function renderPreview() {
    const w = work(); if (!w || !fontReady() || blocked()) return;
    const generation = ++previewGeneration; setPreview(undefined); setPreviewError("");
    try { const value = await previewRecovery(w.workflowId, name(), affiliation()); if (live && generation === previewGeneration) setPreview(value); }
    catch (error) { if (live && error instanceof RecoveryRequestError && error.denied) redact(); else if (live && generation === previewGeneration) setPreviewError("Preview unavailable. No label was printed. Check label-only text and retry."); }
  }
  async function reconcile() {
    const w = work(); if (!w || blocked()) return;
    const generation = ++readGeneration; setReading(true); setRead(undefined); setReadError("");
    try { const value = await reconcileRecovery(w.workflowId); if (live && generation === readGeneration) setRead(value); }
    catch (error) { if (live && error instanceof RecoveryRequestError && error.denied) redact(); else if (live && generation === readGeneration) setReadError("Exact-list reconciliation unavailable. This is not evidence of absence."); }
    finally { if (live && generation === readGeneration) setReading(false); }
  }
  onSettled(() => {
    void load(props.workflowId);
    void Promise.all([400, 700].map(weight => document.fonts.load(`${weight} 16px "WTS Name Label"`, "Ѓорѓи Ќќ Žé gjpq"))).then(faces => { if (live) setFontReady(faces.every(group => group.length > 0 && group.every(face => face.status === "loaded"))); }).catch(() => { if (live) setFontReady(false); });
  });
  const truth = (operation: "authorize_initial" | "deny" | "cancel" | "continue" | "reset") => {
    const common = { reason: reason(), note: note() };
    if (operation === "authorize_initial" && read()?.state === "existing") void submit({ operation, ...common, readId: read()!.id });
    else if (operation === "reset" && read()?.state === "existing" && confirmed() && quiescent() && checkinId() === read()!.checkinId && reason() !== "incident") void submit({ operation, ...common, readId: read()!.id, checkinId: checkinId(), confirmed: true, producersQuiescent: true });
    else if (operation === "deny" || operation === "cancel" || operation === "continue") void submit({ operation, ...common });
  };
  const workLabels: Record<string, string> = { not_submitted: "Waiting", protocol_complete: "Printer finished", handwrite_complete: "Handwritten", admission_uncertain: "Check admission", existing_unattributed: "Needs review", uncertain: "Check output", admission_pending: "Checking in", accepted: "Admitted", rejected: "Not admitted" };
  const workLabel = (item: RecoveryWorkflow) => {
    const latest = item.attempts.at(-1);
    if (item.isolated) return "Printer isolated";
    if (latest?.state === "uncertain") return "Check output";
    if (latest?.cancellation === "pending") return "Cancellation pending";
    if (latest?.state === "queued") return "Label queued";
    if (latest?.state === "dispatched") return "Printing";
    return workLabels[item.fulfillment || item.admissionState] ?? (item.fulfillment || item.admissionState).replaceAll("_", " ").replace(/^\w/, first => first.toUpperCase());
  };
  function backToList() {
    if (pending() || retry() || reading()) return;
    readGeneration++; setWork(undefined); setRead(undefined); setName(""); setAffiliation(""); clearDraft();
    if (!history()) void load();
  }
  return <section aria-label={props.admin ? "Admin recovery" : "Station label recovery"} class={props.compact ? "recovery-compact min-w-0 space-y-4 break-words" : "wts-name-label-text min-w-0 space-y-4 rounded-lg border border-base-content/20 p-4 break-words"}>
    <div class="recovery-heading">
      <h2 tabindex="-1" class="text-xl font-bold">{props.compact ? work() ? "Label recovery" : "Recent work" : props.admin ? "Admission evidence and recovery" : "Recover a label at this station"}</h2>
      <Show when={!props.compact || !work()}><button aria-label="Refresh recovery history" class="btn btn-ghost min-h-12" disabled={props.unavailable || denied() || reading() || pending() || retry()} onClick={() => void load()}>{props.compact ? "Refresh" : "Refresh recovery history"}</button></Show>
    </div>
    <Show when={!props.compact}><p>Work stays at its original station and event. Parking does not make uncertain printing safe. No action here repeats a possibly-sent admission. A confirmed safe-read retry only renews pre-send work; normal readiness and send fences still apply.</p></Show>
    <Show when={!props.compact || work()}><div class="flex flex-wrap gap-2"><Show when={props.compact}><button class="btn btn-ghost min-h-12" disabled={pending() || retry() || reading()} onClick={backToList}>Back to recent work</button></Show><button class="btn btn-outline min-h-12" disabled={!work() || props.unavailable || reading() || pending() || retry()} onClick={() => void load(work()?.workflowId)}>Refresh selected evidence</button></div></Show>
    <Show when={reading()}><p role="status">{props.compact && !work() ? "Loading recent work…" : "Loading recovery evidence…"}</p></Show>
    <Show when={readError()}><p role="alert">{readError()}</p></Show>
    <Show when={commandError()}><p role="alert">{commandError()}</p></Show>
    <Show when={retry()}><button class="btn btn-warning min-h-12" disabled={denied() || pending()} onClick={() => void submit()}>Retry exact saved recovery command</button></Show>
    <Show when={denied()}><button class="btn min-h-12" disabled={props.unavailable || reading() || pending()} onClick={() => void reverify()}>Reverify recovery access</button></Show>
    <Show when={retry()}><p>Saved recovery command: <output aria-label="Saved recovery command ID">{slot.pending()?.operationId}</output></p></Show>
    <Show when={!props.unavailable && !denied() && (!props.compact || (!work() && !reading())) && history()}>{data => <div>
      <p class="recovery-caption">{props.compact ? "Unresolved work and today's completed labels." : "Unresolved work and current-day completed history (Europe/Skopje)."}</p>
      <ul class="recovery-list"><For each={data().items}>{item => <li><button class={props.compact ? "recovery-list-row" : "btn btn-ghost min-h-12 max-w-full h-auto whitespace-normal"} disabled={pending() || retry() || reading()} onClick={() => void load(item.workflowId)}><Show when={props.compact} fallback={<>{item.name} · {item.eventTitle} · {item.stationId} · {item.fulfillment || item.admissionState}{item.parked ? " · parked" : ""}</>}><span><strong>{item.name || "Unnamed attendee"}</strong><small>{item.eventTitle}</small></span><span>{workLabel(item)}<Show when={item.parked}> · Set aside</Show></span></Show></button></li>}</For></ul>
      <Show when={!data().items.length}><p>No work on this page.</p></Show>
      <Show when={historyPages().length || data().nextOffset !== null || !props.compact}><div class="flex flex-wrap gap-2"><Show when={historyPages().length}><button class="btn btn-outline min-h-12" disabled={reading() || pending() || retry()} onClick={() => { const previous = historyPages().at(-1); if (previous !== undefined) { setHistoryPages(pages => pages.slice(0, -1)); void load(undefined, previous); } }}>Previous recovery page</button></Show><button class="btn btn-outline min-h-12" disabled={data().nextOffset === null || reading() || pending() || retry()} onClick={() => { const next = data().nextOffset; if (next !== null) { setHistoryPages(pages => [...pages, historyOffset()]); void load(undefined, next); } }}>Next recovery page</button></div></Show>
    </div>}</Show>
    <Show when={!props.unavailable && !denied() && work()}>{w => <div class="space-y-4">
      <h3 class="font-bold">{w().name}<Show when={!props.compact}> · {w().eventTitle} · {w().stationId}</Show></h3>
      <Show when={props.compact} fallback={<p>Admission: {w().admissionState} · Decision: {w().decision || "none"} · Fulfillment: {w().fulfillment || "not resolved"}</p>}><p>{w().eventTitle} · {workLabel(w())}</p></Show>
      <Show when={w().admissionReadRetryEligible}>
        <fieldset class="space-y-2 border p-3"><legend>Admission safe-read budget exhausted</legend>
          <p>Admission has not been sent. Automatic safe reads stopped after the bounded retry budget was exhausted. This request allows up to three more safe-read attempts on the same workflow. The coordinator may then submit admission once only if its normal checks pass. This button does not itself send admission or print.</p>
          <label class="block"><input type="checkbox" checked={admissionRetryConfirmed()} disabled={blocked()} onChange={e => setAdmissionRetryConfirmed(e.currentTarget.checked)} /> I confirm a new bounded admission safe-read retry for this attendee.</label>
          <button class="btn btn-warning min-h-12" disabled={blocked() || reading() || !admissionRetryConfirmed()} onClick={() => void submit({ operation: "retry_admission_reads" })}>Retry admission safe reads</button>
        </fieldset>
      </Show>
      <Show when={w().isolated}><p role="status" class="alert alert-warning">Station physically isolated. Keep the printer disconnected until queued output is acknowledged safe and isolation is explicitly released.</p></Show>
      <Show when={!props.admin} fallback={<div class="space-y-3">
        <p>Evidence is bounded to 20 reads, admission attempts and resets. Existing is not attributable; absent after possibly-sent never permits a new admission POST.</p>
        <ul><For each={w().admissionAttempts}>{a => <li>Attempt {a.id}: {a.state} · exact list {a.listId} · attendee {a.attendeeId} · send boundary {a.sendBoundaryAt || "not crossed"}</li>}</For></ul>
        <ul><For each={w().reads}>{r => <li>Read {r.createdAt}: {r.state} · check-in {r.checkinId || "none"}</li>}</For></ul>
        <ul><For each={w().resets}>{r => <li>Reset {r.id}: {r.state} · check-in {r.checkinId}</li>}</For></ul>
        <button class="btn min-h-12" disabled={blocked() || reading()} onClick={() => void reconcile()}>Reconcile original exact list</button>
        <Show when={read()}>{r => <p role="status">Latest reconciliation: {r().state} · exact check-in {r().checkinId || "none"}</p>}</Show>
        <label class="block">Decision reason<select class="select min-h-12 w-full" value={reason()} onChange={e => setReason(e.currentTarget.value as ReturnType<typeof reason>)}><option value="incident">Incident investigation</option><option value="erroneous_checkin">Erroneous check-in</option><option value="duplicate">Duplicate</option><option value="wrong_attendee">Wrong attendee</option></select></label>
        <label class="block">Optional bounded note (no email, QR or credentials)<input class="input min-h-12 w-full" maxlength={200} autocomplete="off" value={note()} onInput={e => setNote(e.currentTarget.value)} /></label>
        <div class="flex flex-wrap gap-2"><button class="btn min-h-12" disabled={blocked() || read()?.state !== "existing" || !!w().attempts.length} onClick={() => truth("authorize_initial")}>Authorize one initial label for existing check-in</button><button class="btn min-h-12" disabled={blocked()} onClick={() => truth("deny")}>Deny fulfillment</button><button class="btn min-h-12" disabled={blocked()} onClick={() => truth("continue")}>Continue investigation</button><button class="btn min-h-12" disabled={blocked()} onClick={() => truth("cancel")}>Request safe cancellation</button></div>
        <fieldset class="space-y-2 border p-3"><legend>Guarded erroneous-check-in reset</legend><p>Stop the system and quiesce every admission producer first. Queued or active output must be neutralized. A reset never grants fresh initial-label eligibility.</p><label class="block">Retype exact upstream check-in ID<input class="input min-h-12 w-full" inputmode="numeric" autocomplete="off" value={checkinId()} onInput={e => setCheckinId(e.currentTarget.value)} /></label><label class="block"><input type="checkbox" checked={quiescent()} onChange={e => setQuiescent(e.currentTarget.checked)} /> I verified producers are stopped and quiescent.</label><label class="block"><input type="checkbox" checked={confirmed()} onChange={e => setConfirmed(e.currentTarget.checked)} /> I confirm this exact check-in is erroneous and request reset.</label><button class="btn btn-warning min-h-12" disabled={blocked() || !confirmed() || !quiescent() || reason() === "incident" || read()?.state !== "existing" || !checkinId() || checkinId() !== read()?.checkinId} onClick={() => truth("reset")}>Request guarded reset</button></fieldset>
      </div>}>
        <div class="space-y-3">
          <Show when={latest()}>{p => <><p>Latest output: {p().state} · observation: {p().observation || "none"} · cancellation: {p().cancellation || "none"}</p><div class="flex flex-wrap gap-2"><button class="btn min-h-12" disabled={blocked() || !["completed", "uncertain"].includes(p().state) || !!p().observation} onClick={() => void submit({ operation: "observe", printId: p().id, outcome: "printed" })}>I observed printed output</button><button class="btn min-h-12" disabled={blocked() || !["completed", "uncertain"].includes(p().state) || !!p().observation} onClick={() => void submit({ operation: "observe", printId: p().id, outcome: "not_printed" })}>I observed no usable output</button></div><p>Observation never automatically prints. Missing or damaged output needs a separate replacement request.</p></>}</Show>
          <details open={!props.compact} class="recovery-edit"><summary hidden={!props.compact}>Edit label text</summary><div class="space-y-3">
          <label class="block">Label-only name<input class="input min-h-12 w-full" autocomplete="off" maxlength={200} value={name()} onInput={e => { clearDraft(); setName(e.currentTarget.value); }} /></label><label class="block">Label-only affiliation (blank is allowed)<input class="input min-h-12 w-full" autocomplete="off" maxlength={200} value={affiliation()} onInput={e => { clearDraft(); setAffiliation(e.currentTarget.value); }} /></label>
          <p>Corrections never edit Hi.Events. Active output keeps its frozen text; this draft is used only by an explicit later replacement.</p>
          <Show when={!fontReady()}><p role="status">Pinned Cyrillic display fonts are not ready. Restore bundled Noto Sans fonts if loading fails.</p></Show>
          <button class="btn min-h-12" disabled={!fontReady() || blocked()} onClick={() => void renderPreview()}>Preview exact label PNG</button><button class="btn min-h-12" disabled={blocked() || !name().trim()} onClick={() => void submit({ operation: "correct", name: name(), affiliation: affiliation() })}>Save label-only draft</button>
          <Show when={previewError()}><p role="alert">{previewError()}</p></Show><Show when={preview()}>{p => <figure><img class="max-w-full h-auto" src={`data:image/png;base64,${p().pngBase64}`} width={p().width} height={p().height} alt="Exact server-rendered label preview" /><figcaption>Preview from the frozen workflow profile and pinned renderer/font. {p().rows.some(row => row.shortened) ? "Text was visibly shortened to fit." : "No shortening."}</figcaption></figure>}</Show>
          </div></details>
          <Show when={w().attempts.length >= 2}><p class="alert alert-warning">Two or more label attempts: inspect printer, media and physical output before another replacement. There is no hard replacement cap.</p></Show>
          <button class="btn btn-warning min-h-12" disabled={blocked() || w().isolated || !latest() || !["completed", "uncertain"].includes(latest()!.state) || (latest()!.state === "uncertain" && !latest()!.observation) || name() !== w().name || affiliation() !== w().affiliation} onClick={() => void submit({ operation: "replace", printId: latest()!.id })}>Request a new replacement label</button>
          <details open={!props.compact || w().isolated} class="recovery-handwrite"><summary hidden={!props.compact}><Show when={w().isolated} fallback="Handwrite instead">Finish handwriting &amp; reconnect</Show></summary>
            <fieldset class="border p-3 space-y-2"><legend>Handwritten fulfillment</legend><p>First request cancellation of queued printing. Pending acknowledgement is not cancelled: wait and refresh, then explicitly finish handwriting. If disconnected or physically uncertain, physically isolate the printer before confirming; leave it disconnected until safe queue acknowledgement and release. Never assume a browser action instantly stops USB output.</p><label class="block"><input type="checkbox" checked={isolated()} onChange={e => setIsolated(e.currentTarget.checked)} /> I physically isolated the printer and will keep it isolated until safe release.</label><label class="block"><input type="checkbox" checked={handwritten()} onChange={e => setHandwritten(e.currentTarget.checked)} /> I confirm I have physically handwritten the label. Agent cancellation acknowledgement alone does not mean handwriting is complete.</label><button class="btn min-h-12" disabled={blocked() || !handwritten()} onClick={() => void submit({ operation: "handwrite", physicallyIsolated: isolated() })}>{w().fulfillment === "handwrite_pending" ? "Confirm label was handwritten" : "Request safe handwritten fulfillment"}</button><Show when={w().isolated}><button class="btn min-h-12" disabled={blocked() || w().attempts.some(a => a.cancellation === "pending")} onClick={() => void submit({ operation: "release_isolation", confirmed: true })}>Confirm safe queue and release isolation</button></Show></fieldset>
          </details>
          <button class="btn btn-ghost min-h-12" disabled={blocked()} onClick={() => void submit({ operation: w().parked ? "resume" : "park" })}>{w().parked ? "Resume this work" : "Park this work"}</button>
          <Show when={props.compact}><p>Parking sets work aside; it does not cancel printing.</p></Show>
        </div>
      </Show>
      <details><summary class="min-h-12 cursor-pointer">Immutable label attempt history</summary><p>{w().attemptsTruncated === true ? "Showing only the latest 25 attempts; older attempts are available in pages below." : w().attemptsTruncated === false ? "Latest attempt window (all attempts at this read)." : "Latest attempt window; completeness is not reported by this server."}</p><ol><For each={w().attempts}>{a => <li class="py-2">{a.purpose} · {a.state} · {a.name} / {a.affiliation || "blank affiliation"} · {a.observation || "no observation"} · predecessor {a.predecessorId || "none"}</li>}</For></ol><For each={[w().workflowId]}>{id => <CheckinRecoveryAttemptHistory workflowId={id} onDenied={redact} />}</For></details>
    </div>}</Show>
  </section>;
}
