import { afterEach, expect, it, vi } from "vite-plus/test";
import { recoveryAttemptHistorySchema, recoveryRequestSchema } from "./checkin-recovery-client-contract";
import { createRecoveryCommandSlot, recoveryAttemptHistory } from "./checkin-recovery-client";
const workflowId = "aaaaaaaaaaaaaaa";
const attempt = (i: number) => ({ id: `history${String(i).padStart(8,"0")}`, purpose: "replacement", state: "completed", name: "Ж", affiliation: "界", predecessorId: "", observation: null, cancellation: null });
afterEach(() => vi.unstubAllGlobals());
it("attempt-page contracts reject overlong, duplicate, private-extra, nonprogressing and unsafe requests", () => {
 const page = { workflowId, items: Array.from({length:25},(_,i)=>attempt(i)), nextOffset:25 };
 expect(recoveryAttemptHistorySchema.safeParse(page).success).toBe(true);
 for (const value of [{...page,items:[...page.items,attempt(25)]},{...page,items:[attempt(0),attempt(0)],nextOffset:null},{...page,token:"private"},{...page,items:[],nextOffset:25}]) expect(recoveryAttemptHistorySchema.safeParse(value).success).toBe(false);
 for (const offset of [-1,0.5,Number.MAX_SAFE_INTEGER+1]) expect(recoveryRequestSchema.safeParse({operation:"attempt_history",workflowId,offset}).success).toBe(false);
 expect(recoveryRequestSchema.safeParse({operation:"attempt_history",workflowId,offset:0,limit:1000}).success).toBe(false);
});
it("client validates page identity and offset and history failures never clear frozen mutation", async () => {
 const slot=createRecoveryCommandSlot();
 vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error("lost")));
 await expect(slot.submit({operation:"park",workflowId,expectedVersion:0,operationId:crypto.randomUUID()})).rejects.toThrow();
 const saved=slot.pending();
 for (const result of [{workflowId:"bbbbbbbbbbbbbbb",items:[],nextOffset:null},{workflowId,items:Array.from({length:25},(_,i)=>attempt(i)),nextOffset:25}]) {
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify(result))));
  await expect(recoveryAttemptHistory(workflowId,25)).rejects.toMatchObject({ambiguous:true});
  expect(slot.pending()).toBe(saved);
 }
 for (const status of [401,403]) {
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("{}",{status})));
  await expect(recoveryAttemptHistory(workflowId)).rejects.toMatchObject({denied:true});
  expect(slot.pending()).toBe(saved);
 }
});
