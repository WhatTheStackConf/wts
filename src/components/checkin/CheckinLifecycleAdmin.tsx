import { For, Show, createSignal } from "solid-js";
import { createAsyncResource } from "~/lib/async-resource";
import { createCheckinLifecycleClient, type CheckinLifecycleClient } from "~/lib/checkin-lifecycle-client";
import type { LifecycleApprovalCommand } from "~/lib/checkin-lifecycle-contract";

export interface CheckinLifecycleAdminProps {
  /** Mount only inside the existing admin route guard. Server enforces admin. */
  client?: CheckinLifecycleClient;
}
export function CheckinLifecycleAdmin(props: CheckinLifecycleAdminProps) {
  // A command-owning client is fixed for this mount; a reactive prop getter
  // must not replace its retained UUID between mutation and retry.
  const client = props.client ?? createCheckinLifecycleClient();
  const [mutating, setMutating] = createSignal(false);
  // Trust can also be lost through an ambiguous mutation, independently of reads.
  const [stale, setStale] = createSignal(true);
  const [error, setError] = createSignal("");
  const [message, setMessage] = createSignal("");
  const [intent, setIntent] = createSignal<"close" | "approve">();
  const [confirmation, setConfirmation] = createSignal("");
  const [closeFrozen, setCloseFrozen] = createSignal(false);
  const [attempted, setAttempted] = createSignal(false);
  const [approval, setApproval] = createSignal<LifecycleApprovalCommand>();
  let confirmationInput: HTMLInputElement | undefined;
  let refreshButton: HTMLButtonElement | undefined;
  // Only a validated command response resolves intent. Resource replacement,
  // including a read showing an applied command, must not unmount its retry form.
  const [state, statusActions] = createAsyncResource(async () => {
    try {
      const result = await client.status();
      setStale(false);
      return result;
    } catch (failure) {
      setStale(true);
      throw failure;
    }
  });
  const locked = () => state.loading || mutating();
  async function refresh() {
    if (locked()) return;
    setError("");
    // refetch rejects, while the resource retains its last observation/error.
    await statusActions.refetch().catch(() => undefined);
  }
  function choose(value: "close" | "approve") {
    if (locked() || stale() || closeFrozen() || approval()) return;
    const current = state();
    if (!current || current.closedAt) return;
    if (value === "approve" && (!current.restoreRequired || !current.reconciledAt)) return;
    setAttempted(false); setIntent(value); setConfirmation(""); setError(""); setMessage("");
    if (value === "approve") setApproval({ generation: current.restoreGeneration, confirmEdition: "WTS2026" });
    requestAnimationFrame(() => { confirmationInput?.focus(); confirmationInput?.scrollIntoView({ block: "center" }); });
  }
  async function confirm(event: SubmitEvent) {
    event.preventDefault();
    if (locked() || (stale() && !attempted()) || confirmation() !== "WTS2026" || !intent()) return;
    setAttempted(true);
    setMutating(true); setError(""); setMessage("");
    try {
      const result = intent() === "close" ? await client.close(confirmation()) : await client.approveRestore(approval()!);
      statusActions.mutate(result); setStale(false); setIntent(undefined); setApproval(undefined); setConfirmation("");
      setMessage(result.closedAt ? "WTS2026 closure confirmed. Its deletion deadline is fixed; this edition cannot reopen." : "Restore approval confirmed for this generation. System and stations remain disabled; historical work is not authorized to replay.");
      requestAnimationFrame(() => refreshButton?.focus());
    } catch (failure) {
      setStale(true);
      setError(failure instanceof Error ? failure.message : "Outcome unknown. Retry the same command.");
    } finally { setCloseFrozen(!!client.pendingClose()); setMutating(false); }
  }
  return <section aria-labelledby="lifecycle-heading" class="min-w-0 space-y-4 rounded-lg border border-base-300 p-4">
    <h2 id="lifecycle-heading" class="text-xl font-bold">Edition lifecycle — WTS2026</h2>
    <p>Closure is permanent, not a temporary stop. It disables new work and future dispatch authorization. Started physical tasks cannot be instantly cancelled. Hi.Events tickets are not deleted.</p>
    <div aria-live="polite">
      <Show when={state.error && stale()}><p role="alert" class="alert alert-error break-words">Lifecycle state is unavailable. Previously displayed state is stale; any pending command is retained.</p></Show>
      <Show when={error()}><p role="alert" class="alert alert-error break-words">{error()}</p></Show>
      <Show when={message()}><p role="status" class="alert alert-success">{message()}</p></Show>
      <Show when={stale()}><p class="font-bold">Lifecycle state not verified. Refresh before starting a new action.</p></Show>
    </div>
    <button ref={(el) => { refreshButton = el; }} type="button" class="btn btn-outline min-h-12" disabled={locked()} onClick={() => void refresh()}>Refresh lifecycle</button>
    <Show when={state()}>{(s) => <>
      <dl class="grid min-w-0 gap-2 break-words sm:grid-cols-2" aria-label="Edition retention status">
        <dt>Edition closed at</dt><dd>{s().closedAt ?? "Not closed"}</dd>
        <dt>Fixed deletion deadline (30 days after closure)</dt><dd>{s().purgeDeadline ?? "Not set until explicit closure"}</dd>
        <dt>Central row deletion</dt><dd>{s().centralDeletedAt ?? "Pending — no completion recorded"}</dd>
        <dt>Central compaction / retirement</dt><dd>{s().centralCompactedAt ?? "Pending — row deletion alone is not secure erasure"}</dd>
      </dl>
      <Show when={s().totals}>{(totals) => <p>Anonymous totals: {totals().workflows} workflows; {totals().prints} prints.</p>}</Show>
      <h3 class="font-bold">Device purge status</h3>
      <Show when={s().devices.length > 0} fallback={<p>No device purge inventory recorded. This does not prove all devices are clean.</p>}>
        <ul class="space-y-3"><For each={s().devices}>{(device) => <li class="min-w-0 rounded border border-base-300 p-3 break-all">
          <p>Station: {device.stationId} · Device: {device.id}</p>
          <p>Journal: {device.journalIdentity || "Unknown — must be accounted for"}</p>
          <p>{device.unreachable ? "Unreachable — cannot verify current device state" : "Reachable"}</p>
          <p>{device.completedAt ? `Purge completion recorded: ${device.completedAt}; method: ${device.method}` : "Local purge pending — must wipe or reconnect in purge-only mode before reuse"}</p>
        </li>}</For></ul>
      </Show>
      <h3 class="font-bold">Restore quarantine and reconciliation</h3>
      <p>{s().restoreRequired ? "Restore quarantine active. Scanning and printing disabled." : "No restore quarantine reported. This does not establish operational readiness."}</p>
      <p>Restore generation: {s().restoreGeneration}</p>
      <p>Reconciliation recorded: {s().reconciledAt ?? "Not recorded — operator reconciliation required"}</p>
      <p>Admin approval: {s().approvedAt ?? "Not recorded"}</p>
      <p>Reconcile original attempt identities against agents and Hi.Events, apply overdue purges, and rotate ownership generations through the operator procedure. This surface cannot mark reconciliation complete, force print, reset admission or re-enable a closed edition.</p>
      <Show when={!s().closedAt && !intent()}>
        <div class="flex flex-wrap gap-3">
          <button type="button" class="btn btn-error min-h-12" disabled={locked() || stale()} onClick={() => choose("close")}>Close WTS2026 permanently</button>
          <Show when={s().restoreRequired}>
            <button type="button" class="btn btn-warning min-h-12" disabled={locked() || stale() || !s().reconciledAt} onClick={() => choose("approve")}>Review restore approval</button>
          </Show>
        </div>
      </Show>
    </>}</Show>
    <Show when={intent()}>
      <form method="post" action="/api/checkin-lifecycle" aria-label="Confirm edition lifecycle action" class="min-w-0 space-y-3 rounded border-2 border-warning p-4" onSubmit={(event) => void confirm(event)}>
        <h3 class="font-bold">{intent() === "close" ? "Confirm permanent edition closure" : `Approve reconciled restore generation ${approval()?.generation}`}</h3>
        <p>{intent() === "close" ? "The fixed deadline cannot be extended by unresolved work or repeated closure." : "This approval does not enable scanning or printing and cannot reopen a closed edition."}</p>
        <Show when={closeFrozen()}><p role="status">Closure outcome unconfirmed. The original command UUID is retained for an explicit same-command retry.</p></Show>
        <label class="block" for="lifecycle-confirmation">Type WTS2026 exactly to confirm</label>
        <input ref={(el) => { confirmationInput = el; }} id="lifecycle-confirmation" name="confirmEdition" class="input input-bordered min-h-12 w-full min-w-0 text-base" autocomplete="off" required pattern="WTS2026" maxlength={7} value={confirmation()} disabled={locked() || closeFrozen()} onInput={(event) => setConfirmation(event.currentTarget.value)} />
        <button type="submit" class="btn btn-warning min-h-12 max-w-full whitespace-normal" disabled={locked() || (stale() && !attempted()) || confirmation() !== "WTS2026"}>{closeFrozen() ? "Retry same closure command" : intent() === "close" ? "Confirm permanent closure" : "Confirm restore approval"}</button>
        <Show when={!attempted()}><button type="button" class="btn btn-ghost min-h-12" disabled={locked()} onClick={() => { setIntent(undefined); setApproval(undefined); setConfirmation(""); refreshButton?.focus(); }}>Cancel</button></Show>
      </form>
    </Show>
    <aside class="space-y-2 text-sm" aria-label="Backup and operator limits">
      <h3 class="font-bold">Backup and operator limits</h3>
      <p>Central deletion and compaction do not erase backups, offline disks or external snapshots. Retire or expire every backup and spool copy under the retention runbook; deletion is not a claim of forensic secure erasure.</p>
      <p>Offline or lost Pis remain outstanding until wiped or reconnected in purge-only mode. Do not reuse an old queue. Restore only into disabled reconciliation mode; admin approval is a separate gate, never permission to replay historical admission or printing.</p>
    </aside>
  </section>;
}
