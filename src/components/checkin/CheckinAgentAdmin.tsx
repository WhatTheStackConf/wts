import { For, Match, Show, Switch, createSignal } from "solid-js";
import { AgentReadiness, createAgentReadinessResource } from "~/components/checkin/AgentReadiness";
import { createAsyncResource } from "~/lib/async-resource";
import { agentAdminList, mutateAgent, CheckinAgentRequestError, type AgentMutation } from "~/lib/checkin-agent-client";
import { listLabelProfiles } from "~/lib/checkin-label-client";
import { CHECKIN_REASON_CODES, type CheckinReasonCode } from "~/lib/checkin-contract";
import type { AgentReadinessDTO } from "~/lib/checkin-agent-contract";

type Intent = { operation: "admin_issue"; station: AgentReadinessDTO; identity: { agentIdentity: string; printerIdentity: string; journalIdentity: string; profileId: string; credentialLifetimeHours: number } }
  | { operation: "admin_revoke"; station: AgentReadinessDTO & { agentId: string } };

export function CheckinAgentAdmin() {
  const { data, refresh, failures } = createAgentReadinessResource(() => true, agentAdminList);
  const [profiles, profileActions] = createAsyncResource(listLabelProfiles);
  const [selected, setSelected] = createSignal<AgentReadinessDTO>();
  const [intent, setIntent] = createSignal<Intent>();
  const [reason, setReason] = createSignal<CheckinReasonCode | "">("");
  const [note, setNote] = createSignal("");
  const [frozen, setFrozen] = createSignal<AgentMutation>();
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");
  const [message, setMessage] = createSignal("");
  const [issued, setIssued] = createSignal<{ credential: string; stationLabel: string }>();
  const [revealCredential, setRevealCredential] = createSignal(false);
  let reasonInput: HTMLSelectElement | undefined;
  const available = () => !!data() && !data.error && !data.loading;
  const locked = () => pending() || !!intent() || !!frozen();
  async function refreshAll() {
    await Promise.all([refresh(), profileActions.refetch().catch(() => undefined)]);
  }
  function choose(stationId: string) {
    if (locked() || !available()) return;
    const station = data()?.stations.find((station) => station.stationId === stationId);
    setSelected(station ? structuredClone(station) : undefined);
    setIssued(undefined); setError(""); setMessage("");
  }
  function review(next: Intent) {
    if (locked() || !available()) return;
    setIntent(next); setReason(""); setNote(""); setIssued(undefined); setError(""); setMessage("");
    requestAnimationFrame(() => { reasonInput?.focus(); reasonInput?.scrollIntoView({ block: "center" }); });
  }
  function reviewIssue(event: SubmitEvent) {
    event.preventDefault();
    const station = selected();
    if (!station || profiles.error || !profiles()) return;
    const values = new FormData(event.currentTarget as HTMLFormElement);
    const text = (name: string) => { const value = values.get(name); return typeof value === "string" ? value : ""; };
    review({ operation: "admin_issue", station, identity: {
      agentIdentity: text("agentIdentity"), printerIdentity: text("printerIdentity"), journalIdentity: text("journalIdentity"),
      profileId: text("profileId"), credentialLifetimeHours: Number(values.get("credentialLifetimeHours")),
    } });
  }
  async function confirm(event: SubmitEvent) {
    event.preventDefault();
    if (pending()) return;
    const action = intent(); const selectedReason = reason();
    if (!action || (!frozen() && (!available() || !selectedReason))) return;
    let mutation = frozen();
    if (!mutation) {
      const common = { operationId: crypto.randomUUID(), stationId: action.station.stationId, expectedStationVersion: action.station.stationVersion, reason: selectedReason as CheckinReasonCode, note: note() };
      mutation = action.operation === "admin_issue"
        ? { operation: "admin_issue", command: { ...common, ...action.identity } }
        : { operation: "admin_revoke", command: { ...common, agentId: action.station.agentId } };
    }
    setFrozen(mutation); setPending(true); setError("");
    try {
      const result = await mutateAgent(mutation);
      setFrozen(undefined); setIntent(undefined); setSelected(undefined);
      setIssued(result.credential ? { credential: result.credential, stationLabel: result.station.stationLabel } : undefined);
      setRevealCredential(false);
      setMessage(result.replayed ? "Agent action was already saved. No action was repeated. A lost credential cannot be recovered; review a new issuance to replace it."
        : mutation.operation === "admin_issue" ? "Agent credential issued once. Existing agent authority was replaced; printer/media approval is separate."
        : "Agent revoked. Future work and starts are denied; already-started outcomes may still be reported.");
      await refreshAll();
    } catch (failure) {
      setError(failure instanceof CheckinAgentRequestError ? failure.message : "Agent action could not be confirmed. Retry the same action.");
      if (failure instanceof CheckinAgentRequestError && !failure.ambiguous) {
        setFrozen(undefined); setIntent(undefined); setSelected(undefined);
        await refreshAll();
      }
    } finally { setPending(false); }
  }
  return (
    <section aria-label="Station agents" class="min-w-0 rounded-lg border border-base-content/20 bg-base-200 p-5 space-y-5">
      <h2 class="text-2xl font-bold">Station agents</h2>
      <p>Agent credentials are not User logins, Station Client Bindings or provisioning QRs.</p>
      <p>Each fixed station has one outbound agent. Issuance pins its expected identities and profile; a connection never records physical approval. Stops preserve existing work and cannot instantly cancel USB activity.</p>
      <Show when={data.error}><p role="alert" class="alert alert-error">Agent readiness unavailable. Refresh before new actions. <Show when={failures() >= 3} fallback="Status retries are bounded.">Automatic status retries stopped.</Show></p></Show>
      <Show when={profiles.error}><p role="alert">Profile list unavailable. Refresh before issuing an agent.</p></Show>
      <Show when={error()}><p role="alert" class="alert alert-error">{error()}</p></Show>
      <Show when={message()}><p role="status" class="alert alert-success">{message()}</p></Show>
      <button type="button" class="btn btn-outline min-h-12" disabled={data.loading || profiles.loading} onClick={() => void refreshAll()}>Refresh station agents</button>
      <Show when={!data.error && !data.loading && data()}>{(current) => (
        <div class="grid gap-4 lg:grid-cols-3" aria-busy={data.loading ? "true" : "false"}>
          <For each={current().stations}>{(station) => <article class="min-w-0 rounded-lg border border-base-content/20 p-4"><AgentReadiness station={station} /></article>}</For>
        </div>
      )}</Show>
      <Show when={data.loading}><p role="status">Verifying agent readiness…</p></Show>
      <label for="agent-station" class="block font-medium">Station for agent administration</label>
      <select id="agent-station" name="stationId" class="select select-bordered min-h-12 w-full min-w-0 text-base" value={selected()?.stationId ?? ""} disabled={!available() || locked()} onChange={(event) => choose(event.currentTarget.value)}>
        <option value="">Choose a station</option>
        <For each={data()?.stations ?? []}>{(station) => <option value={station.stationId}>{station.stationLabel}</option>}</For>
      </select>
      <Show when={selected()} keyed>{(station) => (
        <div class="space-y-4">
          <p>Selected: {station.stationLabel} · Configuration version {station.stationVersion}. Refresh and reselect after any configuration change.</p>
          <form method="post" action="/api/checkin-agents" aria-label="Provision station agent" class="space-y-3" onSubmit={reviewIssue}>
            <fieldset disabled={locked() || !available() || profiles.loading || !!profiles.error} class="space-y-3 min-w-0">
              <legend class="text-lg font-bold">Expected machine identity</legend>
              <p class="text-sm">Enter the verified asset/serial identities from local setup, not secrets or connection URLs. Stable printer identity must match the station's configured printer asset reference. Journal identity comes from explicit local initialization. Replacing an agent is not permission to erase uncertain work.</p>
              <For each={[
                { name: "agentIdentity", label: "Expected agent identity" },
                { name: "printerIdentity", label: "Stable printer identity" },
                { name: "journalIdentity", label: "Expected journal identity" },
              ]}>{(field) => <div class="space-y-1">
                <label for={`agent-${field.name}`} class="block font-medium">{field.label} (required)</label>
                <input id={`agent-${field.name}`} name={field.name} class="input input-bordered min-h-12 w-full text-base" required maxlength={80} pattern="[A-Za-z0-9][A-Za-z0-9._\u002d]{0,79}" autocomplete="off" spellcheck={false} />
              </div>}</For>
              <label for="agent-profile" class="block font-medium">Pinned Name Label profile (required)</label>
              <select id="agent-profile" name="profileId" class="select select-bordered min-h-12 w-full min-w-0 text-base" required>
                <option value="">Choose a saved profile</option>
                <For each={profiles()?.profiles.filter((profile) => profile.stationId === station.stationId) ?? []}>{(profile) => <option value={profile.id}>v{profile.version} · {profile.approval} · {profile.id}</option>}</For>
              </select>
              <p class="text-sm">No profile? Configure one in Name Label profiles first. Unapproved or incompatible profiles cannot authorize starts.</p>
              <label for="agent-lifetime" class="block font-medium">Credential lifetime in hours (required)</label>
              <input id="agent-lifetime" name="credentialLifetimeHours" type="number" min={1} max={720} step={1} value={24} class="input input-bordered min-h-12 w-full text-base" required />
              <button type="submit" class="btn btn-warning min-h-12">Review agent issuance</button>
            </fieldset>
          </form>
          <Show when={station.agentId && station.credentialState !== "revoked"}>
            <button type="button" class="btn btn-warning min-h-12" disabled={locked() || !available()} onClick={() => { if (station.agentId) review({ operation: "admin_revoke", station: { ...station, agentId: station.agentId } }); }}>Review agent revocation</button>
          </Show>
        </div>
      )}</Show>
      <Show when={intent()}>{(action) => (
        <form method="post" action="/api/checkin-agents" aria-label="Confirm agent action" class="min-w-0 rounded-lg border-2 border-warning p-4 space-y-4" onSubmit={(event) => void confirm(event)}>
          <h3 class="text-lg font-bold"><Show when={action().operation === "admin_issue"} fallback="Revoke machine credential">Issue replacement machine credential</Show></h3>
          <p>Station: {action().station.stationLabel}. This action changes future authority only. Human logins, browser bindings and unresolved work are preserved.</p>
          <label for="agent-reason" class="block font-medium">Agent action reason (required)</label>
          <select id="agent-reason" name="reason" ref={(element) => { reasonInput = element; }} class="select select-bordered min-h-12 w-full text-base" required value={reason()} disabled={pending() || !!frozen()} onChange={(event) => setReason(event.currentTarget.value as CheckinReasonCode | "")}>
            <option value="">Choose a reason</option>
            <For each={CHECKIN_REASON_CODES}>{(value) => <option value={value}>{value.replaceAll("_", " ")}</option>}</For>
          </select>
          <label for="agent-note" class="block font-medium">Agent action note</label>
          <textarea id="agent-note" name="note" class="textarea textarea-bordered w-full text-base" maxlength={240} value={note()} disabled={pending() || !!frozen()} onInput={(event) => setNote(event.currentTarget.value)} aria-describedby="agent-note-help" />
          <p id="agent-note-help" class="text-sm">Bounded operational context only. No attendee data, email, QR codes, credentials, URLs or raw diagnostics.</p>
          <Show when={frozen()}><p role="status" class="alert alert-warning">Submitted action frozen, including identities, profile, versions, reason and note. Retry this exact action to resolve an unknown outcome.</p></Show>
          <div class="flex flex-wrap gap-3">
            <button type="submit" class="btn btn-warning min-h-12" disabled={pending() || (!frozen() && !available())}><Switch><Match when={pending()}>Saving agent action…</Match><Match when={frozen()}>Retry same agent action</Match><Match when={true}>Confirm agent action</Match></Switch></button>
            <button type="button" class="btn btn-ghost min-h-12" disabled={pending() || !!frozen()} onClick={() => setIntent(undefined)}>Cancel agent action</button>
          </div>
        </form>
      )}</Show>
      <Show when={issued()}>{(result) => (
        <section aria-label="One-time machine credential" class="space-y-3 rounded-lg border-2 border-warning p-4">
          <h3 class="text-lg font-bold">One-time agent credential · {result().stationLabel}</h3>
          <p>Transfer privately to this station's service credential file. Never paste into an operator phone, QR, ticket, chat or log. This value is not recoverable after dismissal or reload.</p>
          <label for="issued-agent-credential" class="block font-medium">Issued agent credential</label>
          <input id="issued-agent-credential" name="issuedCredential" type={revealCredential() ? "text" : "password"} readonly value={result().credential} class="input input-bordered min-h-12 w-full font-mono text-base" autocomplete="off" spellcheck={false} />
          <label class="flex items-center gap-3 min-h-12"><input type="checkbox" name="revealCredential" class="checkbox" checked={revealCredential()} onChange={(event) => setRevealCredential(event.currentTarget.checked)} />Reveal one-time credential for private transfer</label>
          <p class="text-sm">Reveal only in private, then select and copy using your device's normal text controls. Clear your clipboard after transfer.</p>
          <button type="button" class="btn btn-outline min-h-12" onClick={() => setIssued(undefined)}>Hide agent credential</button>
        </section>
      )}</Show>
    </section>
  );
}
