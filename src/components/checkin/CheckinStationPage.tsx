import { For, Show } from "solid-js";
import type { CheckinStationDTO } from "~/lib/checkin-contract";

const readinessMessages: Record<string, string> = {
  system_disabled: "The system is stopped.",
  station_disabled: "This station is disabled.",
  coordinator_unavailable: "Coordinator is not connected.",
  hievents_unconfigured: "Hi.Events admission integration is not configured.",
  printer_unavailable: "Printer agent and physical readiness are not verified.",
  agent_readiness_separate: "Agent connection, compatibility and physical profile approval require separate checks.",
  event_configuration_missing: "Event admission lists are not configured.",
  notifications_unconfigured: "Admin notification delivery is not configured.",
  admission_and_printing_not_implemented: "Browser provisioning alone does not authorize admission or printing.",
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
