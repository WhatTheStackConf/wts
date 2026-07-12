import { createSignal, Show } from "solid-js";
import { AdminDataPanel, useAdminToast } from "~/components/admin/AdminPageShell";
import {
  adminApplyHiEventsReconciliation,
  adminPreviewHiEventsReconciliation,
} from "~/lib/gamification-hievents-actions";
import type { AdminHiEventsReconciliationDto } from "~/lib/gamification-hievents-evidence";

function formatTime(value?: string): string {
  return value ? new Date(value).toLocaleString() : "Not available";
}

function operationId(): string {
  return globalThis.crypto?.randomUUID?.() || `hievents-sync-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function AdminHiEventsReconciliation() {
  const { toast, showToast } = useAdminToast();
  const [busy, setBusy] = createSignal(false);
  const [preview, setPreview] = createSignal<AdminHiEventsReconciliationDto | null>(null);
  const [applied, setApplied] = createSignal<AdminHiEventsReconciliationDto | null>(null);
  const [syncOperationId, setSyncOperationId] = createSignal(operationId());

  const inspect = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      const result = await adminPreviewHiEventsReconciliation();
      if (!result.success || !result.data) throw new Error(result.error || "Could not inspect Hi.Events.");
      setPreview(result.data);
      setApplied(null);
      setSyncOperationId(operationId());
      showToast("success", result.data.state === "complete" ? "Complete source snapshot ready for review." : "Hi.Events source was not complete. No accounting will be changed.");
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Could not inspect Hi.Events.");
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    if (!preview() || preview()!.state !== "complete" || busy()) return;
    if (!window.confirm("Sync and apply this complete Hi.Events snapshot? Source evidence, XP, and Badges may be corrected only where the source no longer supports them.")) return;
    setBusy(true);
    try {
      const result = await adminApplyHiEventsReconciliation(true, preview()!.snapshotFingerprint || "", syncOperationId());
      if (!result.success || !result.data) throw new Error(result.error || "Could not apply Hi.Events reconciliation.");
      setApplied(result.data);
      setPreview(result.data);
      showToast("success", "Hi.Events reconciliation applied from a fresh complete snapshot.");
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Could not apply Hi.Events reconciliation.");
    } finally {
      setBusy(false);
    }
  };

  const current = () => applied() || preview();

  return (
    <div class="space-y-6">
      <Show when={toast()}>{(currentToast) => <div class={`alert ${currentToast().type === "error" ? "alert-error" : "alert-success"}`} role="status">{currentToast().text}</div>}</Show>
      <AdminDataPanel>
        <div class="p-5">
          <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 class="font-bold text-white">Hi.Events evidence reconciliation</h2>
              <p class="mt-1 max-w-3xl text-sm leading-relaxed text-base-content/70">Inspect every attendee page before applying source evidence. Partial and unavailable responses are never treated as an empty attendee list, and cannot create or void gamification evidence.</p>
            </div>
            <div class="flex shrink-0 gap-2">
              <button type="button" class={`btn btn-outline btn-secondary font-mono ${busy() ? "loading" : ""}`} disabled={busy()} onClick={inspect}>Preview source snapshot</button>
              <button type="button" class="btn btn-primary font-mono" disabled={busy() || current()?.state !== "complete"} onClick={sync}>Sync and apply</button>
            </div>
          </div>
        </div>
      </AdminDataPanel>

      <Show when={busy()}><p class="font-mono text-sm text-secondary-200" role="status">Hi.Events reconciliation is in progress...</p></Show>

      <Show when={current()}>{(result) => <>
        <Show when={result().state !== "complete"}>
          <div class="alert alert-warning items-start text-sm" role="alert">
            <span>Source state: <strong>{result().state}</strong>. The snapshot is not complete, so no evidence, Badge, XP, or profile records can be changed. Preview again to retry.</span>
          </div>
        </Show>
        <div class="grid gap-4 md:grid-cols-3">
          <AdminDataPanel><div class="p-5"><p class="text-xs font-mono text-base-content/60">CONFIGURED EVENT</p><p class="mt-1 break-all font-bold text-white">{result().eventId || "Not configured"}</p><p class="mt-1 text-xs font-mono text-base-content/60">Source state: {result().state}</p></div></AdminDataPanel>
          <AdminDataPanel><div class="p-5"><p class="text-xs font-mono text-base-content/60">PAGINATION</p><p class="mt-1 font-bold text-white">{result().pagination.completedPages} / {result().pagination.totalPages || result().pagination.requestedPages} pages</p><p class="mt-1 text-xs font-mono text-base-content/60">{result().pagination.complete ? "Complete traversal" : "Incomplete traversal: no evidence changes"}</p></div></AdminDataPanel>
          <AdminDataPanel><div class="p-5"><p class="text-xs font-mono text-base-content/60">SOURCE TIMESTAMPS</p><p class="mt-1 text-sm font-mono text-white">Fetched {formatTime(result().fetchedAt)}</p><p class="mt-1 text-xs font-mono text-base-content/60">Updated {formatTime(result().sourceUpdatedAt)}</p></div></AdminDataPanel>
        </div>

        <AdminDataPanel>
          <div class="grid gap-5 p-5 md:grid-cols-3">
            <div><p class="text-xs font-mono text-base-content/60">MATCHES</p><p class="mt-1 text-lg font-bold text-white">{result().matchCounts.matchedUsers} Users</p><p class="mt-1 text-xs font-mono text-base-content/60">{result().matchCounts.eligibleAttendees} eligible attendee rows</p></div>
            <div><p class="text-xs font-mono text-base-content/60">AMBIGUITIES</p><p class="mt-1 text-lg font-bold text-warning-200">{result().matchCounts.ambiguousMatches}</p><p class="mt-1 text-xs font-mono text-base-content/60">Automatic awards are withheld.</p></div>
            <div><p class="text-xs font-mono text-base-content/60">PROPOSED CHANGES</p><p class="mt-1 text-lg font-bold text-white">{result().proposed.ticketClaims} ticket / {result().proposed.checkinClaims} check-in</p><p class="mt-1 text-xs font-mono text-base-content/60">{result().proposed.corrections} source corrections</p></div>
          </div>
        </AdminDataPanel>

        <Show when={result().applied}>
          <div class="alert alert-success font-mono text-sm" role="status">Applied {result().applied!.ticketClaims} ticket claims, {result().applied!.checkinClaims} check-in claims, and {result().applied!.corrections} source corrections.</div>
        </Show>
      </>}</Show>
    </div>
  );
}
