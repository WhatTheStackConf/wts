import { For, Show, createSignal } from "solid-js";
import { CHECKIN_REASON_CODES, type CheckinReasonCode } from "~/lib/checkin-contract";
import { CheckinLabelRequestError, mutateLabelProfile, type CheckinLabelCatalogue, type LabelProfileMutation, type LabelProfileStation } from "~/lib/checkin-label-client";
import type { LabelProfile, LabelProfileConfig } from "~/lib/checkin-label-render-contract";
import { NameLabelProfileEditor } from "~/components/checkin/NameLabelProfileEditor";

type Intent = { operation: "configure"; config: LabelProfileConfig } | { operation: "approve"; profile: LabelProfile };
interface Props { catalogue: CheckinLabelCatalogue; available: boolean; refresh(): Promise<void> }
export function NameLabelProfileAdmin(props: Props) {
  const [selected, setSelected] = createSignal<{ station: LabelProfileStation; profile?: LabelProfile; profileStationVersion?: number }>();
  const [intent, setIntent] = createSignal<Intent>();
  const [reason, setReason] = createSignal<CheckinReasonCode | "">("");
  const [note, setNote] = createSignal("");
  const [confirmed, setConfirmed] = createSignal(false);
  const [frozen, setFrozen] = createSignal<LabelProfileMutation>();
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");
  const [message, setMessage] = createSignal("");
  let reasonInput: HTMLSelectElement | undefined;
  function choose(stationId: string) {
    if (intent() || frozen() || pending() || !props.available) return;
    const station = props.catalogue.stations.find((station) => station.id === stationId);
    const profile = props.catalogue.profiles.find((profile) => profile.stationId === stationId);
    setSelected(station ? structuredClone({ station, profile, profileStationVersion: profile ? props.catalogue.profileStationVersions[profile.id] : undefined }) : undefined);
    setMessage(""); setError("");
  }
  function review(value: Intent) {
    if (!props.available) return;
    setIntent(value); setReason(""); setNote(""); setConfirmed(false); setMessage(""); setError("");
    requestAnimationFrame(() => { reasonInput?.focus(); reasonInput?.scrollIntoView({ block: "center" }); });
  }
  async function confirm(event: SubmitEvent) {
    event.preventDefault();
    if (pending()) return;
    const current = selected(); const action = intent(); const selectedReason = reason();
    if (!current || !action || (!frozen() && (!props.available || !selectedReason || (action.operation === "approve" && !confirmed())))) return;
    let mutation = frozen();
    if (!mutation) {
      const common = { operationId: crypto.randomUUID(), expectedStationVersion: current.station.version, reason: selectedReason as CheckinReasonCode, note: note() };
      mutation = action.operation === "configure"
        ? { operation: "configure", command: { ...common, stationId: current.station.id, expectedVersion: current.profile?.version ?? 0, config: action.config } }
        : { operation: "approve", command: { ...common, profileId: action.profile.id, expectedVersion: action.profile.version, physicalConfirmation: true } };
    }
    setFrozen(mutation); setPending(true); setError("");
    try {
      const result = await mutateLabelProfile(mutation);
      setFrozen(undefined); setIntent(undefined); setSelected(undefined);
      setMessage(result.replayed ? "This profile action was already saved; no change was repeated." : "Profile action saved. Supervised admission and printing require current station readiness.");
      await props.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Profile action could not be confirmed.");
      if (failure instanceof CheckinLabelRequestError && !failure.ambiguous) {
        setFrozen(undefined); setIntent(undefined); setSelected(undefined);
        await props.refresh();
      }
    } finally { setPending(false); }
  }
  return (
    <div class="min-w-0 border-t border-base-content/20 pt-5 space-y-4">
      <h3 class="text-xl font-bold">Station printer and stock configuration</h3>
      <Show when={error()}><p role="alert" class="alert alert-error">{error()}</p></Show>
      <Show when={message()}><p role="status" class="alert alert-success">{message()}</p></Show>
      <label for="label-profile-station" class="block font-medium">Station for profile configuration</label>
      <select id="label-profile-station" class="select select-bordered min-h-12 w-full min-w-0 text-base" value={selected()?.station.id ?? ""} disabled={!props.available || pending() || !!intent() || !!frozen()} onChange={(event) => choose(event.currentTarget.value)}>
        <option value="">Choose a station</option>
        <For each={props.catalogue.stations}>{(station) => <option value={station.id}>{station.label} · {station.printerRef || "No printer asset"}</option>}</For>
      </select>
      <Show when={selected()} keyed>{(current) => (
        <div class="space-y-4">
          <p>Station configuration version {current.station.version} · {current.profile ? `Profile v${current.profile.version}: ${current.profile.approval}` : "No saved profile"}</p>
          <Show when={current.profile?.config.printerRef !== undefined && current.profile.config.printerRef !== current.station.printerRef}><p role="status" class="alert alert-warning">Printer identity mismatch. This profile is unavailable for production use; configure and physically verify a new version.</p></Show>
          <Show when={current.profile && current.profileStationVersion !== current.station.version}><p role="status" class="alert alert-warning">Station configuration changed since this profile was saved. Save and physically verify a new profile version before approval, even if the printer reference is unchanged.</p></Show>
          <NameLabelProfileEditor station={current.station} existing={current.profile?.config} locked={!props.available || pending() || !!intent() || !!frozen()} review={(config) => review({ operation: "configure", config })} />
          <Show when={current.profile}>{(profile) => (
            <>
              <p class="text-sm">Approval applies only to the exact printer, stock, renderer, font and profile version. It is a recorded human attestation, not a consequence of this preview.</p>
              <button type="button" class="btn btn-warning min-h-12" disabled={!props.available || pending() || !!intent() || !!frozen() || profile().approval === "approved" || profile().config.synthetic || profile().config.printerRef !== current.station.printerRef || current.profileStationVersion !== current.station.version} onClick={() => review({ operation: "approve", profile: profile() })}>Review physical profile approval</button>
              <Show when={profile().config.synthetic}><p>Synthetic profiles cannot be approved for production.</p></Show>
            </>
          )}</Show>
        </div>
      )}</Show>
      <Show when={intent()}>{(action) => (
        <form method="post" action="/api/checkin-labels" aria-label="Confirm Name Label profile action" class="min-w-0 rounded-lg border-2 border-warning p-4 space-y-4" onSubmit={(event) => void confirm(event)}>
          <h4 class="text-lg font-bold">{action().operation === "configure" ? "Save an unapproved profile version" : "Record physical profile approval"}</h4>
          <p>Station: {selected()?.station.label} · Printer: {selected()?.station.printerRef}. The exact command and its expected versions are frozen after submission, including reason and note.</p>
          <label for="label-profile-reason" class="block font-medium">Profile action reason (required)</label>
          <select id="label-profile-reason" ref={(element) => { reasonInput = element; }} class="select select-bordered min-h-12 w-full text-base" required value={reason()} disabled={pending() || !!frozen()} onChange={(event) => setReason(event.currentTarget.value as CheckinReasonCode | "")}>
            <option value="">Choose a reason</option>
            <For each={CHECKIN_REASON_CODES}>{(value) => <option value={value}>{value.replaceAll("_", " ")}</option>}</For>
          </select>
          <label for="label-profile-note" class="block font-medium">Profile action note</label>
          <textarea id="label-profile-note" class="textarea textarea-bordered w-full text-base" maxlength={240} required={action().operation === "approve"} value={note()} disabled={pending() || !!frozen()} onInput={(event) => setNote(event.currentTarget.value)} aria-describedby="label-profile-note-help" />
          <p id="label-profile-note-help" class="text-sm">Bounded non-sensitive operational evidence only. No attendee text, email, QR, credentials, URLs or raw diagnostics. For approval, describe the owner-led physical check of legibility, bounds and gap feed.</p>
          <Show when={action().operation === "approve"}>
            <label for="label-physical-confirmation" class="flex items-start gap-3"><input id="label-physical-confirmation" type="checkbox" class="checkbox" required checked={confirmed()} disabled={pending() || !!frozen()} onChange={(event) => setConfirmed(event.currentTarget.checked)} /><span>I physically verified printed legibility, bounds and gap feed on this exact printer, stock and profile version. A screen preview, hash or generic-media report is not this evidence.</span></label>
          </Show>
          <Show when={frozen()}><p role="status" class="alert alert-warning">Submitted command frozen. Resolve an unknown response by retrying this same action, not by submitting a replacement.</p></Show>
          <div class="flex flex-wrap gap-3">
            <button type="submit" class="btn btn-warning min-h-12" disabled={pending() || (!frozen() && !props.available)}>{pending() ? "Saving profile action…" : frozen() ? "Retry same profile action" : "Confirm profile action"}</button>
            <button type="button" class="btn btn-ghost min-h-12" disabled={pending() || !!frozen()} onClick={() => setIntent(undefined)}>Cancel profile action</button>
          </div>
        </form>
      )}</Show>
    </div>
  );
}
