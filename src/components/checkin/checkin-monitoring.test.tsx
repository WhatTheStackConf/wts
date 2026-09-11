import { renderToString } from "@solidjs/web";
import { expect, it } from "vite-plus/test";
import { CheckinMonitoringView } from "~/components/checkin/checkin-monitoring";
import type { MonitoringDashboard } from "~/lib/checkin-monitoring-contract";
it("renders actionable uncertainty, email failure and acknowledgement limits without admin addresses in incident display", () => {
  const dashboard: MonitoringDashboard = { scope: "wts2026station1", lastTickMs: 0, hasMore: false, recipientsConfigured: false, incidents: [{ id: "a".repeat(15), stationId: "wts2026station1", workflowId: null, category: "output_uncertain", sinceMs: 1, openedMs: 1, recoveredMs: 0, acknowledgedMs: 0, nextDeliveryMs: 900001, delivery: "unknown", deliveryKind: "open", nextAction: "investigate_delivery_no_retry" }] };
  const html = renderToString(() => <CheckinMonitoringView dashboard={dashboard} readiness={[]} onAcknowledge={() => {}} />);
  for (const text of ["Physical output uncertain", "do not reprint automatically", "No designated admin recipients", "automatic retry is blocked", "Acknowledge incident", 'aria-label="Monitoring incidents"', 'role="status"', "does not resolve admission"]) expect(html).toContain(text);
  expect(html).not.toContain("@example");
});
