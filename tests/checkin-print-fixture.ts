import type PocketBase from "pocketbase";
import { expect } from "./checkin-fixtures";

/** Real disposable agent authorization/start/outcome commands; no device driver
 * or physical printer is called. Only the final device outcome is simulated. */
export async function settleQueuedPrint(db: PocketBase, workflowId: string, stationId: string) {
  const owner = (await db.collection("checkin_coordinator").getOne("wts2026coord000")).owner;
  await db.send("/api/wts/checkin-agents", { method: "POST", requestKey: null, body: { operation: "machine_print_claim", owner, nowMs: Date.now(), limit: 100 } });
  const prints = await db.collection("checkin_print_attempts").getFullList({ filter: db.filter("workflow_id = {:workflow} && station_id = {:station} && (state = 'queued' || state = 'dispatched')", { workflow: workflowId, station: stationId }) });
  expect(prints).toHaveLength(1);
  const print = prints[0];
  const attempt = await db.collection("checkin_agent_attempts").getFirstListItem(db.filter("print_attempt_id = {:id}", { id: print.id }));
  const agent = await db.collection("checkin_agents").getOne(attempt.agent_id);
  const authorizationHash = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const payload = { stationId, attemptId: attempt.id, payloadHash: attempt.payload_hash, authorizationHash };
  for (const operation of ["authorize", "start", "outcome"]) {
    await db.send("/api/wts/checkin-agents", { method: "POST", requestKey: null, body: { operation: `machine_${operation}`, owner, nowMs: Date.now(), credentialHash: agent.credential_hash, payload: operation === "outcome" ? { ...payload, outcome: "protocol_complete" } : payload } });
  }
  expect((await db.collection("checkin_print_attempts").getOne(print.id)).state).toBe("completed");
  return print.id;
}

/** Synthetic admission response delivered through the real coordinator fences. */
export async function acceptQueuedAdmission(db: PocketBase, workflowId: string) {
  const owner = (await db.collection("checkin_coordinator").getOne("wts2026coord000")).owner;
  const command = (operation: string, rest: object = {}) => db.send<any>("/api/wts/checkin-arrivals", { method: "POST", requestKey: null, body: { operation, owner, ...rest } });
  let { job } = await command("machine_admission_claim");
  for (let i = 0; job && job.workflowId !== workflowId && i < 100; i++) {
    await command("machine_admission_release", { attemptId: job.attemptId });
    ({ job } = await command("machine_admission_claim"));
  }
  expect(job?.workflowId).toBe(workflowId);
  await command("machine_admission_fence", { attemptId: job.attemptId, coordinatorGeneration: job.coordinatorGeneration });
  await command("machine_admission_result", { attemptId: job.attemptId, outcome: { state: "newly_checked_in", fingerprint: "f".repeat(64) } });
}
