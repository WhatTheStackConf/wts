import { For, Show, createSignal, onSettled } from "solid-js";
import { CheckinLayout } from "~/components/checkin/CheckinLayout";
import { CheckinEventSelector } from "~/components/checkin/CheckinEventSelector";
import { useRequireCheckinOperator } from "~/lib/route-guards";
import { createAsyncResource } from "~/lib/async-resource";
import { bindCheckinStation, checkinStatus, previewCheckinStation } from "~/lib/checkin-client";
import type { CheckinPreviewDTO, CheckinStationDTO } from "~/lib/checkin-contract";

const readinessMessages: Record<string, string> = {
  system_disabled: "The system is stopped.",
  station_disabled: "This station is disabled.",
  coordinator_unavailable: "Coordinator is not connected.",
  hievents_unconfigured: "Hi.Events admission integration is not configured.",
  printer_unavailable: "Printer agent and physical readiness are not verified.",
  event_configuration_missing: "Event admission lists are not configured.",
  notifications_unconfigured: "Admin notification delivery is not configured.",
  admission_and_printing_not_implemented: "Admission and printing are not implemented in this release.",
};

export function StationReadiness(props: { station: CheckinStationDTO }) {
  return (
    <section aria-label="Station readiness" class="space-y-3 break-words">
      <h2 class="text-xl font-bold">{props.station.label}</h2>
      <p>{props.station.location || "Location not configured"} · Printer: {props.station.printerRef || "Not configured"}</p>
      <p>Station {props.station.enabled ? "enabled" : "disabled"} · Authorization generation {props.station.generation}</p>
      <p class="font-bold text-warning">Not ready for event use</p>
      <ul class="list-disc space-y-1 pl-6"><For each={props.station.unreadyReasons}>{(reason) => <li>{readinessMessages[reason] ?? "A required dependency is not ready."}</li>}</For></ul>
      <p class="text-sm">{props.station.activeBindingCount} phones active in the last 5 minutes. This counts authenticated contact, not live connections.</p>
      <Show when={props.station.multiplePhonesWarning}>
        <p role="status" class="alert alert-warning">More than two phones are active at this station. Check that each phone is intended; there is no hard cap.</p>
      </Show>
    </section>
  );
}

export default function CheckinStationPage() {
  const guard = useRequireCheckinOperator();
  const [code, setCode] = createSignal("");
  const [preview, setPreview] = createSignal<CheckinPreviewDTO>();
  const [pending, setPending] = createSignal(false);
  const [message, setMessage] = createSignal("");
  const [error, setError] = createSignal("");
  const [status, actions] = createAsyncResource(() => guard.authorized() ? true : undefined, checkinStatus);

  onSettled(() => {
    const fragment = window.location.hash;
    if (fragment) {
      // QR material is memory-only and removed before any user interaction.
      window.history.replaceState(window.history.state, "", window.location.pathname);
      const match = /^#provision=([a-f0-9]{64})$/.exec(fragment);
      if (match) setCode(match[1]);
      else setError("Invalid provisioning link. Scan the current station QR again.");
    }
    const refreshStatus = () => {
      if (guard.authorized() && !document.hidden) void actions.refetch().catch(() => undefined);
    };
    const timer = window.setInterval(refreshStatus, 5000);
    window.addEventListener("focus", refreshStatus);
    document.addEventListener("visibilitychange", refreshStatus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshStatus);
      document.removeEventListener("visibilitychange", refreshStatus);
    };
  });

  async function review(event: SubmitEvent) {
    event.preventDefault();
    if (pending()) return;
    setPending(true); setError(""); setMessage(""); setPreview(undefined);
    try { setPreview(await previewCheckinStation(code())); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to review this station."); }
    finally { setPending(false); }
  }
  async function confirm() {
    const current = preview();
    if (!current || pending()) return;
    setPending(true); setError("");
    try {
      await bindCheckinStation(code(), current.confirmation);
      setPreview(undefined); setCode("");
      setMessage("Station binding confirmed. Admission and printing remain disabled.");
      await actions.refetch();
    } catch (failure) {
      setPreview(undefined);
      setError(failure instanceof Error ? failure.message : "Binding not confirmed. Review the station again.");
    } finally { setPending(false); }
  }
  return (
    <CheckinLayout title="Your Check-in Station">
      <Show when={guard.authorized()}>
        <div class="alert alert-warning" role="note">Provisioning and event selection only. Attendee admission, camera scanning, lookup and Name Label printing are not enabled in this release.</div>
        <div aria-live="polite" class="space-y-2">
          <Show when={message()}><p class="alert alert-success">{message()}</p></Show>
          <Show when={error()}><p role="alert" class="alert alert-error">{error()}</p></Show>
          <Show when={status.error}>
            <p role="alert" class="alert alert-error">Cannot verify current login, binding or station state. All operations remain unavailable.</p>
            <button type="button" class="btn btn-outline min-h-12" disabled={status.loading} onClick={() => void actions.refetch().catch(() => undefined)}>Refresh station status</button>
          </Show>
        </div>
        <Show when={!status.error && status()}>{(current) => (
          <section class="rounded-lg border border-base-content/20 bg-base-200 p-5 space-y-4">
            <p class="font-bold">System: {current().system.enabled ? "enabled for provisioning" : "stopped"}</p>
            <p>Binding: {current().bindingState}</p>
            <Show when={current().station}>{(station) => <StationReadiness station={station()} />}</Show>
            <Show when={current().bindingState === "bound" && current().binding && current().station}>
              <CheckinEventSelector status={current()} verifying={status.loading} />
            </Show>
            <Show when={current().bindingState === "revoked"}>
              <p role="alert" class="text-error">This browser binding was revoked. Ask an admin for help; logging in again does not restore it.</p>
            </Show>
            <div class="flex flex-wrap gap-3">
              <button type="button" class="btn min-h-12" disabled>Scan attendee</button>
              <button type="button" class="btn min-h-12" disabled>Find attendee</button>
              <button type="button" class="btn min-h-12" disabled>Print Name Label</button>
            </div>
          </section>
        )}</Show>
        <section class="rounded-lg border border-base-content/20 bg-base-200 p-5 space-y-4">
          <h2 class="text-xl font-bold">Provision this phone</h2>
          <p>Use your phone's camera to open a station QR after logging in, or paste its opaque code below. Reviewing a QR does not change your binding. Confirming another station replaces this browser's binding, never transfers work.</p>
          <form method="post" action="/api/checkin" onSubmit={(event) => void review(event)} class="space-y-3">
            <label for="station-code" class="block font-medium">Station provisioning code</label>
            <input id="station-code" name="code" class="input input-bordered min-h-12 w-full font-mono text-base" value={code()} onInput={(event) => { setCode(event.currentTarget.value); setPreview(undefined); }} required pattern="[a-f0-9]{64}" maxlength={64} autocomplete="off" spellcheck={false} aria-describedby="code-help" />
            <p id="code-help" class="text-sm opacity-80">64 lowercase letters/numbers from the current admin-issued QR. No attendee QR or login credentials.</p>
            <button type="submit" class="btn btn-primary min-h-12" disabled={pending()}>Review station</button>
          </form>
          <Show when={preview()}>{(current) => (
            <div class="space-y-4 border-t border-base-content/20 pt-4" aria-label="Confirm station">
              <StationReadiness station={current().station} />
              <p>Verify this station's location and printer identity before binding. Not-ready dependencies do not prevent provisioning, but admission and printing stay disabled.</p>
              <button type="button" class="btn btn-primary min-h-12" disabled={pending() || !current().canBind} onClick={() => void confirm()}>Confirm station binding</button>
              <button type="button" class="btn btn-ghost min-h-12" disabled={pending()} onClick={() => setPreview(undefined)}>Cancel</button>
            </div>
          )}</Show>
        </section>
      </Show>
    </CheckinLayout>
  );
}
