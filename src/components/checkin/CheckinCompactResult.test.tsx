import { renderToString } from "@solidjs/web";
import { CheckinCameraScanner } from "~/components/checkin/checkin-camera-scanner";
import type { CheckinArrivalDecision, CheckinArrivalWorkflow } from "~/lib/checkin-arrival-contract";
import { describe, expect, it } from "vite-plus/test";
import { compactArrivalPresentation, CheckinCompactResult } from "./CheckinCompactResult";

const workflow = { id: "aaaaaaaaaaaaaaa", stationId: "wts2026station1", eventId: "eeeeeeeeeeeeeee", eventTitle: "Synthetic", state: "accepted", name: "Јана", affiliation: "", profileId: "ppppppppppppppp", createdAt: "2026-09-11" } as const;
it("separates a captured QR from confirmed completion", () => {
  expect(compactArrivalPresentation()).toMatchObject({ tone: "waiting", title: "QR captured" });
  expect(compactArrivalPresentation({ state: "reserved", workflow: { ...workflow, state: "not_submitted", printState: null } })).toMatchObject({ tone: "waiting", title: "Ticket captured" });
});
it("never marks queued, uncertain, cancelled or suppressed output successful", () => {
  for (const printState of ["queued", "dispatched", "uncertain", "cancelled", null] as const) {
    expect(compactArrivalPresentation({ state: "accepted", workflow: { ...workflow, printState }, printIntentId: "ppppppppppppppp" }).tone).not.toBe("success");
  }
  expect(compactArrivalPresentation({ state: "accepted", workflow: { ...workflow, printState: "completed" }, printIntentId: "ppppppppppppppp" })).toMatchObject({ tone: "success", title: "Done" });
});
it("keeps rejection and attribution uncertainty visually distinct from success", () => {
  expect(compactArrivalPresentation({ state: "rejected", reason: "not_in_list" }).tone).toBe("error");
  expect(compactArrivalPresentation({ state: "already_handled" }).tone).toBe("error");
  expect(compactArrivalPresentation({ state: "admission_uncertain", workflow: { ...workflow, state: "admission_uncertain", printState: null } }).tone).toBe("error");
});

describe("rendered compact result privacy and controls", () => {
const workflow: CheckinArrivalWorkflow = {
  id: "private-work-id", stationId: "wts2026station1", eventId: "private-event-id", eventTitle: "Event",
  state: "accepted", printState: "completed", name: "Ана O’Neill", affiliation: "Заедница",
  profileId: "private-profile-id", createdAt: "2026-09-11",
};

it("shows the attendee and completed protocol without private identifiers", () => {
  const decision: CheckinArrivalDecision = { state: "existing", workflow };
  const html = renderToString(() => <CheckinCompactResult decision={decision} />);
  expect(html).toContain("Ана O’Neill");
  expect(html).toContain("Заедница");
  expect(html).toContain("Done");
  expect(html).toContain('data-tone="success"');
  expect(html).toContain("wts-name-label-text");
  expect(html).not.toContain("private-");
});

it.each(["queued", "dispatched", "uncertain", "cancelled", null] as const)("never presents accepted %s printing as completed", (printState) => {
  const decision: CheckinArrivalDecision = { state: "existing", workflow: { ...workflow, printState } };
  const html = renderToString(() => <CheckinCompactResult decision={decision} />);
  expect(html).not.toContain('data-tone="success"');
  expect(html).not.toContain("Done");
  expect(html).toContain("Admission recorded");
});

it.each(["admission_pending", "admission_uncertain", "existing_unattributed"] as const)("never presents %s as successful even with a completed print projection", (state) => {
  const html = renderToString(() => <CheckinCompactResult decision={{ state, workflow: { ...workflow, state } }} />);
  expect(html).not.toContain('data-tone="success"');
});

it.each([{ redacted: true }, { error: true }, { pending: true }])("redacts full attendee text and attributes for %j", (props) => {
  const html = renderToString(() => <CheckinCompactResult decision={{ state: "existing", workflow }} {...props} />);
  expect(html).not.toContain("Ана");
  expect(html).not.toContain("Заедница");
  expect(html).not.toContain("private-");
});

it("provides accessible full text for long Cyrillic attendee details", () => {
  const name = "Долгометражно Име ".repeat(12);
  const affiliation = "Заедница ".repeat(30);
  const html = renderToString(() => <CheckinCompactResult decision={{ state: "existing", workflow: { ...workflow, name, affiliation } }} />);
  expect(html).toContain(`aria-label="${name}"`);
  expect(html).toContain(`aria-label="${affiliation}"`);
  expect(html).toContain('aria-live="polite"');
});

it("exposes one compact Start scanning action while preserving legacy camera controls", () => {
  const compact = renderToString(() => <CheckinCameraScanner compact enabled held={false} purpose="attendee" onDecode={() => {}} />);
  expect(compact.match(/<button/g)).toHaveLength(1);
  expect(compact).toContain("Start scanning");
  expect(compact).not.toContain("Start attendee camera");
  const legacy = renderToString(() => <CheckinCameraScanner enabled held={false} purpose="attendee" onDecode={() => {}} />);
  expect(legacy).toContain("Start attendee camera");
  expect(legacy).toContain("Stop attendee camera");
  expect(legacy).toContain("Camera frames are decoded on this phone and never uploaded.");
});

});
