import { expect, it } from "vite-plus/test";
import { renderToString } from "@solidjs/web";
import { ArrivalDecision } from "./CheckinArrivalPreflight";
import { checkinArrivalResultSchema } from "~/lib/checkin-arrival-client";

it("renders accepted admission with lifecycle-suppressed printing as separate facts", async () => {
  const outcome = checkinArrivalResultSchema.parse({
    state: "accepted", operationId: crypto.randomUUID(), replayed: false, operationsEnabled: false,
    printIntentId: null, printSuppression: "lifecycle",
    workflow: { id: "w".repeat(15), stationId: "wts2026station1", eventId: "e".repeat(15), eventTitle: "Synthetic event", state: "accepted", printState: null, name: "Тест", affiliation: "", profileId: "p".repeat(15), createdAt: "2026-09-10T00:00:00Z" },
  });
  if (outcome.state !== "accepted") throw new Error("Expected accepted fixture");
  const html = await renderToString(() => <ArrivalDecision decision={outcome} />);
  expect(html).toContain("Admission recorded. No Name Label was queued");
  expect(html).not.toContain("Exactly one initial Name Label intent");
  expect(html).not.toContain("Printer protocol complete");
  expect(checkinArrivalResultSchema.safeParse({ ...outcome, printSuppression: undefined }).success).toBe(false);
  expect(checkinArrivalResultSchema.safeParse({ ...outcome, workflow: { ...outcome.workflow, printState: "queued" } }).success).toBe(false);
});
