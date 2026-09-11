import { Match, Show, Switch } from "solid-js";
import type { CheckinArrivalDecision } from "~/lib/checkin-arrival-contract";
import { cameraDecisionSettled } from "~/lib/checkin-camera";
import "./scanner-panel.css";

interface CheckinCompactResultProps {
  decision?: CheckinArrivalDecision;
  pending?: boolean;
  error?: boolean;
  redacted?: boolean;
  invalid?: boolean;
}

/** Presentation only: never infers completion from an accepted admission alone. */
export function compactArrivalPresentation(decision?: CheckinArrivalDecision) {
  const result = (tone: "success" | "error" | "waiting", title: string, detail: string) => ({ tone, title, detail });
  if (!decision) return result("waiting", "QR captured", "Checking this attendee…");
  if ("workflow" in decision) {
    const work = decision.workflow;
    if (work.state === "accepted") {
      if (cameraDecisionSettled(decision)) return result("success", "Done", "Checked in. Collect the label.");
      if (work.printState === "uncertain") return result("error", "Check printer output", "Admission recorded. Do not reprint; ask an admin.");
      if (work.printState === "cancelled" || !work.printState) return result("error", "Admission recorded · no label", "Do not check in again. Resolve the label in Tools.");
      return result("waiting", work.printState === "dispatched" ? "Printing label…" : "Label queued…", "Admission recorded. Keep this attendee here.");
    }
    if (work.state === "admission_uncertain" || work.state === "existing_unattributed") return result("error", "Admission needs review", "Do not check in again. Ask an admin to resolve this arrival.");
    if (work.state === "rejected") return result("error", "Admission not accepted", "Keep this attendee here. Review the arrival in Tools.");
    return result("waiting", "Ticket captured", "Checking admission. Please wait.");
  }
  if (decision.state === "already_handled") return result("error", "Already handled", "No new check-in or label. Ask the owning station if needed.");
  if (decision.state === "rejected") {
    const reasons = {
      invalid_identity: "Use the attendee’s ticket QR.", not_in_list: "Ticket is not on this event’s list.",
      cancelled: "This ticket is cancelled.", awaiting_payment: "Payment is still required.",
      unknown_eligibility: "Ticket eligibility could not be verified.", already_checked_in: "Already checked in. No new label was authorized.",
    };
    return result("error", "Ticket not accepted", reasons[decision.reason]);
  }
  if (decision.state === "needs_affiliation_choice") return result("error", "Affiliation unavailable", "Retry the check or explicitly use a blank affiliation.");
  return result("error", "Check unavailable", "Keep this attendee held. Retry the same arrival or use Tools.");
}

export function CheckinCompactResult(props: CheckinCompactResultProps) {
  const presentation = () => props.redacted
    ? { tone: "waiting", title: "Verifying access…", detail: "This arrival stays held." }
    : props.invalid ? { tone: "error", title: "Not an attendee QR", detail: "Use the attendee’s ticket QR. Nothing was submitted." }
      : props.error ? { tone: "error", title: "Arrival needs attention", detail: "Outcome unverified. Keep this attendee held; refresh or retry the same arrival." }
        : compactArrivalPresentation(props.pending ? undefined : props.decision);
  const work = () => !props.redacted && !props.error && !props.pending && props.decision && "workflow" in props.decision ? props.decision.workflow : undefined;
  return <div class="checkin-compact-result" data-tone={presentation().tone} role="status" aria-live="polite" aria-atomic="true">
    <span class="checkin-result-mark" aria-hidden="true"><Switch fallback="…"><Match when={presentation().tone === "success"}>✓</Match><Match when={presentation().tone === "error"}>!</Match></Switch></span>
    <h3 class="checkin-result-title">{presentation().title}</h3>
    <Show when={work()}>{(attendee) => <div class="checkin-result-person wts-name-label-text">
      <p class="checkin-result-name" aria-label={attendee().name} title={attendee().name}>{attendee().name}</p>
      <Show when={attendee().affiliation}><p class="checkin-result-affiliation" aria-label={attendee().affiliation} title={attendee().affiliation}>{attendee().affiliation}</p></Show>
    </div>}</Show>
    <p class="checkin-result-detail">{presentation().detail}</p>
  </div>;
}
