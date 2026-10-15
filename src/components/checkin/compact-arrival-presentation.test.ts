import type { CheckinArrivalDecision, CheckinArrivalWorkflow } from "~/lib/checkin-arrival-contract";
import { expect, it } from "vite-plus/test";
import { compactArrivalPresentation } from "./CheckinCompactResult";

const workflow: CheckinArrivalWorkflow = {
  id: "aaaaaaaaaaaaaaa", stationId: "wts2026station1", eventId: "eeeeeeeeeeeeeee", eventTitle: "Synthetic",
  state: "accepted", printState: null, name: "Јана", affiliation: "", profileId: "ppppppppppppppp", createdAt: "2026-09-11",
};
const accepted = (printState: CheckinArrivalWorkflow["printState"]): CheckinArrivalDecision => ({ state: "accepted", workflow: { ...workflow, printState }, printIntentId: "ppppppppppppppp" });
const work = (state: CheckinArrivalWorkflow["state"]): CheckinArrivalDecision => ({ state: "admission_pending", workflow: { ...workflow, state } });

it("presents every compact arrival outcome with its exact copy", () => {
  const cases: Array<[CheckinArrivalDecision | undefined, string, string, string]> = [
    [undefined, "waiting", "QR captured", "Checking this attendee…"],
    [accepted("completed"), "success", "Done", "Checked in. Collect the label."],
    [accepted("uncertain"), "error", "Check printer output", "Admission recorded. Do not reprint; ask an admin."],
    [accepted("cancelled"), "error", "Admission recorded · no label", "Do not check in again. Resolve the label in Tools."],
    [accepted(null), "error", "Admission recorded · no label", "Do not check in again. Resolve the label in Tools."],
    [accepted(undefined), "error", "Admission recorded · no label", "Do not check in again. Resolve the label in Tools."],
    [accepted("dispatched"), "waiting", "Printing label…", "Admission recorded. Keep this attendee here."],
    [accepted("queued"), "waiting", "Label queued…", "Admission recorded. Keep this attendee here."],
    [work("admission_uncertain"), "error", "Admission needs review", "Do not check in again. Ask an admin to resolve this arrival."],
    [work("existing_unattributed"), "error", "Admission needs review", "Do not check in again. Ask an admin to resolve this arrival."],
    [work("rejected"), "error", "Admission not accepted", "Keep this attendee here. Review the arrival in Tools."],
    [work("not_submitted"), "waiting", "Ticket captured", "Checking admission. Please wait."],
    [work("admission_pending"), "waiting", "Ticket captured", "Checking admission. Please wait."],
    [{ state: "already_handled" }, "error", "Already handled", "No new check-in or label. Ask the owning station if needed."],
    [{ state: "rejected", reason: "invalid_identity" }, "error", "Ticket not accepted", "Use the attendee’s ticket QR."],
    [{ state: "rejected", reason: "not_in_list" }, "error", "Ticket not accepted", "Ticket is not on this event’s list."],
    [{ state: "rejected", reason: "cancelled" }, "error", "Ticket not accepted", "This ticket is cancelled."],
    [{ state: "rejected", reason: "awaiting_payment" }, "error", "Ticket not accepted", "Payment is still required."],
    [{ state: "rejected", reason: "unknown_eligibility" }, "error", "Ticket not accepted", "Ticket eligibility could not be verified."],
    [{ state: "rejected", reason: "already_checked_in" }, "error", "Ticket not accepted", "Already checked in. No new label was authorized."],
    [{ state: "needs_affiliation_choice" }, "error", "Affiliation unavailable", "Retry the check or explicitly use a blank affiliation."],
    [{ state: "dependency_unavailable" }, "error", "Check unavailable", "Keep this attendee held. Retry the same arrival or use Tools."],
  ];
  for (const [decision, tone, title, detail] of cases) expect(compactArrivalPresentation(decision)).toStrictEqual({ tone, title, detail });
});
