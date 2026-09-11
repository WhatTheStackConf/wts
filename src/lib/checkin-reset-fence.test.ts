import { expect, it } from "vite-plus/test";
import PocketBase from "pocketbase";
import { Coordinator } from "../../runtime/checkin/coordinator";
import type { ResetJob } from "../../runtime/checkin/protocol";
const job: ResetJob = { workflowId: "workflow0000001", resetId: "reset0000000001", sourceKey: "a".repeat(64), upstreamEventId: "101", upstreamListId: "201", upstreamAttendeeId: "301", checkinId: "401", fingerprint: "b".repeat(64) };
it("requires an immediate one-time grant after inspection, denying lost or repeated grants", async () => {
  for (const fault of ["none", "lost", "repeat"] as const) {
    const pb = new PocketBase("http://127.0.0.1"); const calls: string[] = []; let claimed = false, effects = 0;
    pb.send = (async (url: string, options: { body: Record<string, unknown> }) => {
      const op = String(options.body.operation); calls.push(op);
      if (op === "machine_reset_claim") { if (claimed) return { job: null }; claimed = true; return { job }; }
      if (op === "machine_reset_fence") {
        expect(url).toBe("/api/wts/checkin-reset-fence"); expect(options.body.job).toEqual(job);
        if (fault === "lost") throw new Error("Lost committed fence response");
        return { resetId: job.resetId, authorized: true };
      }
      if (op === "machine_reset_result") return { resetId: job.resetId, state: options.body.outcome };
      return {};
    }) as typeof pb.send;
    const coordinator = new Coordinator(pb); await coordinator.listen();
    try {
      await coordinator.processResets({ reset: async (_job, beforeDelete) => {
        calls.push("inspection"); await beforeDelete();
        if (fault === "repeat") await beforeDelete();
        calls.push("DELETE"); effects++; return "deleted";
      } });
      expect(effects).toBe(fault === "none" ? 1 : 0);
      expect(calls.filter(c => c === "machine_reset_fence")).toHaveLength(1);
      expect(calls.indexOf("machine_reset_fence")).toBeGreaterThan(calls.indexOf("inspection"));
      if (fault === "none") expect(calls.indexOf("DELETE")).toBe(calls.indexOf("machine_reset_fence") + 1);
      expect(await coordinator.processResets({ reset: async (_job, beforeDelete) => { await beforeDelete(); effects++; return "deleted"; } })).toBe(0);
    } finally { await coordinator.close(); }
  }
});
it("rejects legacy unfenced transport before it can run or claim work", async () => {
  const pb = new PocketBase("http://127.0.0.1"); let claims = 0; pb.send = (async (_url, options) => { if ((options?.body as {operation?:string})?.operation === "machine_reset_claim") { claims++; return {job}; } return {}; }) as typeof pb.send;
  const coordinator = new Coordinator(pb); await coordinator.listen(); let effects = 0;
  try { await expect(coordinator.processResets({ reset: async () => { effects++; return "deleted"; } })).rejects.toThrow(); expect(effects).toBe(0); expect(claims).toBe(0); }
  finally { await coordinator.close(); }
});
