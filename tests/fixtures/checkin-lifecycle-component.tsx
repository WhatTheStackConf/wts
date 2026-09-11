import { render } from "@solidjs/web";
import { CheckinLifecycleAdmin } from "../../src/components/checkin/CheckinLifecycleAdmin";
import { createCheckinLifecycleClient } from "../../src/lib/checkin-lifecycle-client";
import type { LifecycleStatus } from "../../src/lib/checkin-lifecycle-contract";
import "../../src/styles/app.css";

// Explicit transport test double: no backend, production calls, or physical work.
const restore = new URLSearchParams(location.search).has("restore");
const initial: LifecycleStatus = {
  edition: "WTS2026", closedAt: null, purgeDeadline: null, centralDeletedAt: null,
  centralCompactedAt: null, totals: null, restoreRequired: restore,
  restoreGeneration: restore ? 4 : 0, reconciledAt: restore ? "2026-09-19T18:00:00.000Z" : null,
  approvedAt: null, devices: [],
};
const harness = {
  status: initial,
  failRead: false,
  loseNextMutation: true,
  commands: [] as string[],
};
declare global { interface Window { lifecycleHarness: typeof harness } }
window.lifecycleHarness = harness;
const transportDouble: typeof fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body));
  if (body.operation === "status") {
    if (harness.failRead) return Response.json({}, { status: 503 });
    return Response.json(harness.status);
  }
  harness.commands.push(String(init?.body));
  harness.status = body.operation === "close"
    ? { ...harness.status, closedAt: "2026-09-19T18:00:00.000Z", purgeDeadline: "2026-10-19T18:00:00.000Z" }
    : { ...harness.status, restoreRequired: false, approvedAt: "2026-09-19T18:01:00.000Z" };
  if (harness.loseNextMutation) {
    harness.loseNextMutation = false;
    return Response.json({ ...harness.status, edition: "WRONG" });
  }
  return Response.json(harness.status);
};
render(() => <main class="mx-auto max-w-4xl p-3"><CheckinLifecycleAdmin client={createCheckinLifecycleClient(transportDouble)} /></main>, document.getElementById("root")!);
