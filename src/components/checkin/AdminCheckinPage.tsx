import { For, Show, createSignal } from "solid-js";
import { CheckinAdminRecovery } from "~/components/checkin/CheckinRecovery";
import { CheckinLayout } from "~/components/checkin/CheckinLayout";
import { CheckinEventAdmin } from "~/components/checkin/CheckinEventAdmin";
import { CheckinLabelAdmin } from "~/components/checkin/CheckinLabelAdmin";
import { CheckinArrivalWork } from "~/components/checkin/CheckinArrivalWork";
import { CheckinAgentAdmin } from "~/components/checkin/CheckinAgentAdmin";
import { CheckinAdminMonitoring } from "~/components/checkin/checkin-monitoring";
import { CheckinLifecycleAdmin } from "~/components/checkin/CheckinLifecycleAdmin";
import { createAgentReadinessResource } from "~/components/checkin/AgentReadiness";
import { agentAdminList } from "~/lib/checkin-agent-client";
import { StationReadiness } from "~/components/checkin/CheckinStationPage";
import { useRequireAdmin } from "~/lib/route-guards";
import { createAsyncResource } from "~/lib/async-resource";
import { checkinAdminControl, checkinAdminList, type IssuedCheckinQR } from "~/lib/checkin-client";
import { CHECKIN_NOTE_MAX_LENGTH, CHECKIN_REASON_CODES, type CheckinAdminCommand, type CheckinReasonCode, type CheckinStationDTO } from "~/lib/checkin-contract";

type ControlIntent = CheckinAdminCommand extends infer C ? C extends CheckinAdminCommand ? Omit<C, "operationId" | "reason" | "note"> : never : never;
interface StationConfigurationProps { station: CheckinStationDTO; locked: boolean; submit: (intent: ControlIntent, title: string) => void }
function StationConfiguration(props: StationConfigurationProps) {
  function submit(event: SubmitEvent) {
    event.preventDefault();
    const values = new FormData(event.currentTarget as HTMLFormElement);
    const label = values.get("label");
    const location = values.get("location");
    const printerRef = values.get("printerRef");
    if (typeof label !== "string" || typeof location !== "string" || typeof printerRef !== "string") return;
    props.submit({ operation: "configure_station", stationId: props.station.id, expectedVersion: props.station.version, label, location, printerRef }, "Save station configuration");
  }
  return (
    <form method="post" action="/api/checkin" onSubmit={submit} class="space-y-3">
      <fieldset disabled={props.locked} class="space-y-3">
        <legend class="font-bold">Station configuration</legend>
        <label class="block" for={`${props.station.id}-label`}>Station name</label>
        <input id={`${props.station.id}-label`} name="label" class="input input-bordered min-h-12 w-full text-base" value={props.station.label} maxlength={80} required />
        <label class="block" for={`${props.station.id}-location`}>Location</label>
        <input id={`${props.station.id}-location`} name="location" class="input input-bordered min-h-12 w-full text-base" value={props.station.location} maxlength={120} />
        <label class="block" for={`${props.station.id}-printer`}>Printer asset reference</label>
        <input id={`${props.station.id}-printer`} name="printerRef" class="input input-bordered min-h-12 w-full text-base" value={props.station.printerRef} maxlength={80} aria-describedby={`${props.station.id}-asset-help`} />
        <p id={`${props.station.id}-asset-help`} class="text-sm">Display identity only; no USB path, credentials, email or capability URL. Does not establish physical readiness.</p>
        <button type="submit" class="btn btn-outline min-h-12">Save station configuration</button>
      </fieldset>
    </form>
  );
}

/** Mounted anew for each authorized user/role; no recipient snapshot crosses sessions. */
function AdminMonitoringSurface() {
  const { data, refresh } = createAgentReadinessResource(() => true, agentAdminList);
  return <>
    <Show when={data.error}><p role="alert">Monitoring station readiness unavailable. Do not rely on previous readiness.</p></Show>
    <button type="button" class="btn min-h-11" disabled={data.loading} onClick={() => void refresh()}>Refresh monitoring station readiness</button>
    <CheckinAdminMonitoring readiness={!data.error && !data.loading ? data()?.stations ?? [] : []} />
  </>;
}

export default function AdminCheckinPage() {
  const guard = useRequireAdmin();
  const [bindingPage, setBindingPage] = createSignal(1);
  const [auditPage, setAuditPage] = createSignal(1);
  const [data, actions] = createAsyncResource(() => guard.authorized() ? `${bindingPage()}:${auditPage()}` : undefined, () => checkinAdminList(bindingPage(), auditPage()));
  const [intent, setIntent] = createSignal<{ command: ControlIntent; title: string; operationId: string }>();
  const [reason, setReason] = createSignal<CheckinReasonCode | "">("");
  const [note, setNote] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");
  const [message, setMessage] = createSignal("");
  const [issued, setIssued] = createSignal<IssuedCheckinQR>();
  let reasonInput: HTMLSelectElement | undefined;
  function choose(command: ControlIntent, title: string) {
    setIntent({ command, title, operationId: crypto.randomUUID() });
    setReason(""); setNote(""); setError(""); setMessage(""); setIssued(undefined);
    requestAnimationFrame(() => { reasonInput?.focus(); reasonInput?.scrollIntoView({ block: "center" }); });
  }
  async function confirm(event: SubmitEvent) {
    event.preventDefault();
    const current = intent();
    const selectedReason = reason();
    if (!current || !selectedReason || pending()) return;
    setPending(true); setError("");
    try {
      const result = await checkinAdminControl({ ...current.command, operationId: current.operationId, reason: selectedReason, note: note() });
      setIssued(result.provisionCode ? result : undefined);
      setMessage(result.replayed ? "This action was already applied. No action was repeated. If the QR response was lost, issue a new replacement QR." : `${current.title} applied. Supervised admission and printing require current station readiness.`);
      setIntent(undefined);
      await actions.refetch();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not confirm the action. Refresh before continuing.");
    } finally { setPending(false); }
  }
  return (
    <CheckinLayout title="Check-in administration">
      <Show when={guard.authorized()}>
        <p class="alert alert-warning">Software provisioning and arrival preflight only. No admission or print work can start. Stops preserve work; restoring a scope changes its authorization generation, never authorizes replay.</p>
        <CheckinEventAdmin />
        <CheckinLabelAdmin />
        <CheckinAgentAdmin />
        <Show when={guard.authorized() && guard.user()?.id && `${guard.user()!.id}:${guard.user()!.role}`} keyed>{(_scope) => <><AdminMonitoringSurface /><CheckinLifecycleAdmin /></>}</Show>
        <CheckinAdminRecovery scopeKey={guard.authorized() && guard.user()?.id ? `${guard.user()!.id}:${guard.user()!.role}` : undefined} />
        <CheckinArrivalWork allStations />
        <div aria-live="polite">
          <Show when={error()}><p role="alert" class="alert alert-error">{error()}</p></Show>
          <Show when={message()}><p class="alert alert-success">{message()}</p></Show>
          <Show when={data.error}><p role="alert" class="alert alert-error">Station state is unavailable. Do not rely on previously displayed state.</p></Show>
        </div>
        <button type="button" class="btn btn-outline min-h-12" disabled={pending() || data.loading} onClick={() => { setIntent(undefined); void actions.refetch().catch(() => undefined); }}>Refresh administration</button>
        <Show when={intent()}>{(current) => (
          <form method="post" action="/api/checkin" class="rounded-lg border-2 border-warning bg-base-200 p-5 space-y-4" onSubmit={(event) => void confirm(event)} aria-label="Confirm administrative action">
            <h2 class="text-xl font-bold">Confirm: {current().title}</h2>
            <p>Only affects future authorization. Existing work and uncertainty are preserved. A started physical task cannot be instantly cancelled.</p>
            <label for="control-reason" class="block font-medium">Reason (required)</label>
            <select ref={(element) => { reasonInput = element; }} id="control-reason" name="reason" class="select select-bordered min-h-12 w-full text-base" required value={reason()} disabled={pending()} onChange={(event) => setReason(event.currentTarget.value as CheckinReasonCode | "")}>
              <option value="">Choose a reason</option>
              <For each={CHECKIN_REASON_CODES}>{(value) => <option value={value}>{value.replaceAll("_", " ")}</option>}</For>
            </select>
            <label for="control-note" class="block font-medium">Note (optional)</label>
            <textarea id="control-note" name="note" class="textarea textarea-bordered w-full text-base" maxlength={CHECKIN_NOTE_MAX_LENGTH} value={note()} disabled={pending()} onInput={(event) => setNote(event.currentTarget.value)} aria-describedby="note-help" />
            <p id="note-help" class="text-sm">Up to 240 characters. No personal data, email, QR codes, credentials, URLs or raw diagnostics.</p>
            <div class="flex flex-wrap gap-3">
              <button type="submit" class="btn btn-warning min-h-12" disabled={pending()}>Confirm action</button>
              <button type="button" class="btn btn-ghost min-h-12" disabled={pending()} onClick={() => setIntent(undefined)}>Cancel action</button>
            </div>
          </form>
        )}</Show>
        <Show when={issued()}>{(qr) => (
          <section class="rounded-lg border border-base-content/20 bg-base-200 p-5 space-y-3" aria-label="Issued provisioning QR">
            <h2 class="text-xl font-bold">Replacement Station Provisioning QR</h2>
            <p>Save this QR now. Its code is shown only in this response and is never recovered from storage. The previous QR is invalid; existing bindings remain unchanged.</p>
            <Show when={qr().qrDataUrl}><img src={qr().qrDataUrl} width="320" height="320" class="h-auto max-w-full" alt="Reusable Station Provisioning QR" /></Show>
            <label for="issued-code" class="block font-medium">Issued provisioning code</label>
            <input id="issued-code" class="input input-bordered min-h-12 w-full font-mono text-base" readonly value={qr().provisionCode} />
            <div class="flex flex-wrap gap-3">
              <a class="btn btn-primary min-h-12" href={qr().qrDataUrl} download="wts-2026-station-provisioning.png">Download QR for printing</a>
              <a class="btn btn-outline min-h-12" href={qr().provisionUrl} target="_self" rel="noreferrer">Review station on this device</a>
              <button type="button" class="btn btn-ghost min-h-12" onClick={() => setIssued(undefined)}>Hide QR</button>
            </div>
          </section>
        )}</Show>
        <Show when={!data.error && data()}>{(current) => (
          <>
            <section class="rounded-lg border border-base-content/20 bg-base-200 p-5 space-y-3" aria-label="System controls">
              <h2 class="text-xl font-bold">System: {current().system.enabled ? "enabled for provisioning" : "stopped"}</h2>
              <p>Authorization generation {current().system.generation} · Configuration version {current().system.version}</p>
              <button type="button" class="btn btn-warning min-h-12" disabled={pending() || !!intent()} onClick={() => choose({ operation: "set_system_enabled", expectedVersion: current().system.version, enabled: !current().system.enabled }, current().system.enabled ? "Stop system" : "Restore system")}>
                {current().system.enabled ? "Stop system" : "Restore system"}
              </button>
            </section>
            <div class="grid gap-5 lg:grid-cols-3">
              <For each={current().stations}>{(station) => (
                <article class="min-w-0 rounded-lg border border-base-content/20 bg-base-200 p-5 space-y-5" aria-label={station.label}>
                  <StationReadiness station={station} />
                  <p class="text-xs font-mono">{station.id} · Version {station.version}</p>
                  <StationConfiguration station={station} locked={pending() || !!intent()} submit={choose} />
                  <div class="flex flex-wrap gap-3">
                    <button type="button" class="btn btn-warning min-h-12" disabled={pending() || !!intent()} onClick={() => choose({ operation: "set_station_enabled", stationId: station.id, expectedVersion: station.version, enabled: !station.enabled }, `${station.enabled ? "Disable" : "Restore"} station: ${station.label}`)}>{station.enabled ? "Disable station" : "Restore station"}</button>
                    <button type="button" class="btn btn-outline min-h-12" disabled={pending() || !!intent()} onClick={() => choose({ operation: "rotate_provision_code", stationId: station.id, expectedVersion: station.version }, `Issue replacement QR: ${station.label}`)}>Issue replacement QR</button>
                  </div>
                </article>
              )}</For>
            </div>
            <section class="space-y-3" aria-label="Client bindings">
              <h2 class="text-xl font-bold">Client bindings</h2>
              <p>Active means authenticated contact in the last 5 minutes, not a live connection. No hard phone limit.</p>
              <ul class="space-y-3"><For each={current().bindings.items}>{(binding) => (
                <li class="rounded-lg border border-base-content/20 p-4 space-y-2">
                  <p class="break-all font-mono">{binding.id} · {binding.stationId}</p>
                  <p>{binding.revoked ? "Revoked" : "Valid"} · {binding.active ? "Recently active" : "Inactive"} · Last seen {binding.lastSeenAt || "Never"}</p>
                  <button type="button" class="btn btn-outline min-h-12" disabled={binding.revoked || pending() || !!intent()} onClick={() => choose({ operation: "revoke_binding", bindingId: binding.id, expectedVersion: binding.version }, `Revoke binding: ${binding.id}`)}>Revoke binding</button>
                </li>
              )}</For></ul>
              <div class="flex gap-3">
                <button type="button" class="btn min-h-12" disabled={bindingPage() <= 1 || pending() || !!intent()} onClick={() => setBindingPage((value) => value - 1)}>Previous bindings</button>
                <button type="button" class="btn min-h-12" disabled={!current().bindings.hasMore || pending() || !!intent()} onClick={() => setBindingPage((value) => value + 1)}>Next bindings</button>
              </div>
            </section>
            <section class="space-y-3" aria-label="Check-in audit">
              <h2 class="text-xl font-bold">Audit history</h2>
              <ul class="space-y-3"><For each={current().audit.items}>{(entry) => (
                <li class="rounded-lg border border-base-content/20 p-4 space-y-1 break-words">
                  <p>{entry.createdAt} · {entry.actorName} ({entry.actorRole})</p>
                  <p>{entry.operation} · {entry.eventId ? `Event ${entry.eventId}` : entry.stationId || "System"} · {entry.outcome}</p>
                  <p>{entry.reason} {entry.note}</p>
                </li>
              )}</For></ul>
              <div class="flex gap-3">
                <button type="button" class="btn min-h-12" disabled={auditPage() <= 1 || pending() || !!intent()} onClick={() => setAuditPage((value) => value - 1)}>Previous audit</button>
                <button type="button" class="btn min-h-12" disabled={!current().audit.hasMore || pending() || !!intent()} onClick={() => setAuditPage((value) => value + 1)}>Next audit</button>
              </div>
            </section>
          </>
        )}</Show>
      </Show>
    </CheckinLayout>
  );
}
