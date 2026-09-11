import { createHash } from "node:crypto";
import { checkinEventBindingHash } from "./checkin-event-service";
import { checkinArrivalResultSchema } from "./checkin-arrival-client";
import { CheckinLifecycleService } from "./checkin-lifecycle-service";
import { expect, it } from "vite-plus/test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import PocketBase from "pocketbase";
import { CheckinAgentService } from "~/lib/checkin-agent-service";
import { CheckinLabelProfileService } from "~/lib/checkin-label-profile-service";
import { SYNTHETIC_LABEL_CONFIG } from "~/lib/checkin-label-render-contract";
import { Coordinator } from "../../runtime/checkin/coordinator";
import { AgentJournal } from "../../runtime/checkin/journal";
import { AgentRuntime, HttpAgentTransport } from "../../runtime/checkin/agent";
import { SimulatedNiimbotPrinter } from "../../runtime/checkin/printer";
import type { CheckinStationId } from "~/lib/checkin-contract";
import type { CheckinArrivalSource } from "~/lib/checkin-arrival-source";
import type { CheckinEventContext } from "~/lib/checkin-event-contract";
import { CheckinArrivalService } from "~/lib/checkin-arrival-service";
import { CheckinEventService, type CheckinEventSource } from "~/lib/checkin-event-service";
import { CheckinService } from "~/lib/checkin-service";
import { startCheckinPocketBase } from "~/lib/checkin-pocketbase-test-helper";

const events: CheckinEventSource = {
  sourceKey: "a".repeat(64),
  discover: async () => ({ state: "complete", events: [{ id: "101", title: "Synthetic conference" }] }),
  options: async () => ({ state: "complete", lists: [{ id: "201", title: "Synthetic list" }], products: [{ id: "401", title: "Test ticket" }], questions: [{ id: "301", title: "Test affiliation", productIds: ["401"] }] }),
};
const qrIdentity = "A-ABC1234";
async function setup() {
  const test = await startCheckinPocketBase();
  try {
    const admin = await test.user("admin");
    const operator = await test.user("checkin_operator");
    const control = new CheckinService(test.pb, admin.actor);
    const catalogue = new CheckinEventService(test.pb, operator.actor, events);
    const configuration = await new CheckinEventService(test.pb, admin.actor, events).configure({ operationId: crypto.randomUUID(), expectedGeneration: 0, upstreamEventId: "101", member: true, enabled: true, listId: "201", affiliation: { questionId: "301", productIds: ["401"] }, reason: "configuration" });
    await control.adminControl({ operation: "set_system_enabled", operationId: crypto.randomUUID(), expectedVersion: 1, enabled: true, reason: "configuration" });
    const stationId = "wts2026station1";
    await control.adminControl({ operation: "set_station_enabled", operationId: crypto.randomUUID(), expectedVersion: 1, stationId, enabled: true, reason: "configuration" });
    const code = (await control.adminControl({ operation: "rotate_provision_code", operationId: crypto.randomUUID(), expectedVersion: 2, stationId, reason: "configuration" })).provisionCode!;
    const token = "b".repeat(64);
    await control.bind(code, token, (await control.preview(code)).confirmation);
    const initial = await catalogue.catalogue(token);
    const selected = await catalogue.select(token, { ...initial.fence, eventId: configuration.configuration.id, eventGeneration: 1 });
    const source: CheckinArrivalSource = { sourceKey: events.sourceKey, resolve: async () => ({ state: "eligible" as const, attendee: { upstreamAttendeeId: "501", publicId: qrIdentity, productId: "401", name: "Тест Attendee", alreadyCheckedIn: false } }), affiliation: async () => ({ state: "present" as const, text: "Test organisation" }) };
    const service = new CheckinArrivalService(test.pb, operator.actor, source);
    const command = () => ({ operationId: crypto.randomUUID(), context: selected.context!, qrIdentity, affiliationChoice: "fetch" as const });
    return { ...test, admin, operator, control, catalogue, configuration, token, code, source, service, command };
  } catch (error) { await test.cleanup(); throw error; }
}

async function ready(t: Awaited<ReturnType<typeof setup>>, stationId: CheckinStationId = "wts2026station1", coordinator = new Coordinator(t.pb)) {
  const row = await t.pb.collection("checkin_stations").getOne(stationId);
  let version = Number(row.version);
  const code = row.provision_code_hash ? t.code : (await t.control.adminControl({ operation: "rotate_provision_code", operationId: crypto.randomUUID(), stationId, expectedVersion: version++, reason: "configuration" })).provisionCode!;
  if (!row.enabled) { await t.control.adminControl({ operation: "set_station_enabled", operationId: crypto.randomUUID(), stationId, expectedVersion: version++, enabled: true, reason: "configuration" }); }
  await t.control.adminControl({ operation: "configure_station", operationId: crypto.randomUUID(), stationId, expectedVersion: version++, label: "Test station", location: "Test", printerRef: "test-printer", reason: "configuration" });
  const profiles = new CheckinLabelProfileService(t.pb, t.admin.actor);
  const saved = await profiles.configure({ operationId: crypto.randomUUID(), stationId, expectedVersion: 0, expectedStationVersion: version, reason: "configuration", note: "Synthetic test profile", config: { ...SYNTHETIC_LABEL_CONFIG, synthetic: false, printerRef: "test-printer", stockRef: "test-stock" } });
  await profiles.approve({ operationId: crypto.randomUUID(), profileId: saved.profile.id, expectedVersion: 1, expectedStationVersion: version, reason: "configuration", physicalConfirmation: true, note: "Synthetic attestation only, not physical evidence" });
  const identity = { stationId, agentIdentity: "test-pi", printerIdentity: "test-printer", journalIdentity: "test-journal", profileId: saved.profile.id };
  const issued = await new CheckinAgentService(t.pb, t.admin.actor).issue({ ...identity, operationId: crypto.randomUUID(), expectedStationVersion: version, reason: "configuration", note: "Synthetic agent", credentialLifetimeHours: 24 });
  const heartbeat = () => coordinator.machine(issued.credential!, "heartbeat", { ...identity, protocolGeneration: 1, schemaGeneration: 1, journalSequence: 1, journalDigest: "c".repeat(64), journalState: "healthy" });
  return { coordinator, heartbeat, issued, saved, code };
}
async function context(t: Awaited<ReturnType<typeof setup>>, token = t.token): Promise<CheckinEventContext> {
  const current = await t.catalogue.catalogue(token);
  return (await t.catalogue.select(token, { ...current.fence, eventId: t.configuration.configuration.id, eventGeneration: 1 })).context!;
}

it("projects live completed history and replay without rewriting the accepted command", { timeout: 60_000 }, async () => {
  const t = await setup(); const runtime = await ready(t); const coordinatorUrl = await runtime.coordinator.listen();
  const identity = { stationId: "wts2026station1" as const, agentIdentity: "test-pi", printerIdentity: "test-printer", journalIdentity: "test-journal", profileId: runtime.saved.profile.id };
  const journalPath = join(t.root, "agent-journal.sqlite");
  AgentJournal.provision(journalPath, identity);
  const journal = new AgentJournal(journalPath, identity);
  try {
    const agent = new AgentRuntime(identity, journal, new HttpAgentTransport(coordinatorUrl, runtime.issued.credential!));
    expect((await agent.heartbeat()).station.readyForAuthorization).toBe(true);
    const command = { ...t.command(), context: await context(t) };
    expect(await t.service.preflight(t.token, command)).toMatchObject({ state: "reserved" });
    expect(await t.service.status(t.token, command.operationId)).toMatchObject({operationId:command.operationId,result:{state:"reserved"},operationsEnabled:false});
    const cachedCommand = {...command, operationId:crypto.randomUUID()};
    expect(await t.service.preflight(t.token,cachedCommand)).toMatchObject({state:"existing"});
    const hidden = await t.pb.collection("checkin_arrival_commands").getFirstListItem(`operation_id='${cachedCommand.operationId}'`);
    expect(hidden.history_visible).toBe(false);
    expect(await runtime.coordinator.processAdmissions({
      attendee: async (job) => ({ upstreamAttendeeId: job.upstreamAttendeeId, publicId: qrIdentity, productId: "401", alreadyCheckedIn: false }),
      admit: async () => {
        expect(await t.service.status(t.token, command.operationId)).toMatchObject({result:{state:"admission_pending"}});
        expect(await t.service.status(t.token, cachedCommand.operationId)).toMatchObject({result:{state:"admission_pending"}});
        return { state: "newly_checked_in", fingerprint: "a".repeat(64) };
      },
    })).toBe(1);
    const frozen = await t.pb.collection("checkin_arrival_commands").getFirstListItem(`operation_id = '${command.operationId}'`);
    expect(await runtime.coordinator.claimPrints()).toBe(1);
    expect(await t.service.preflight(t.token, command)).toMatchObject({state:"accepted", workflow:{printState:"queued"}});
    const work = await agent.work();
    expect(work.attempts).toHaveLength(1);
    expect(work.attempts[0].payload).toMatchObject({ purpose: "initial", text: { name: "Тест Attendee", affiliation: "Test organisation" } });
    const printer = new SimulatedNiimbotPrinter(identity.printerIdentity);
    await expect(agent.process(work.attempts[0], printer)).resolves.toBe("protocol_complete");
    expect(printer.printed).toHaveLength(1);
    expect(await t.service.status(t.token, command.operationId)).toMatchObject({result:{state:"accepted",workflow:{printState:"completed"}}});
    expect(await t.service.status(t.token, cachedCommand.operationId)).toMatchObject({operationId:cachedCommand.operationId,result:{state:"accepted",workflow:{printState:"completed"}}});
    expect((await t.pb.collection("checkin_arrival_commands").getOne(hidden.id)).result).toEqual(hidden.result);
    const currentDay = (await t.service.history(t.token)).day;
    const historyDay = (day: string, token = t.token, cursor?: string) => t.pb.send<any>("/api/wts/checkin-arrivals", {method:"POST", body:{operation:"history",actorUserId:t.operator.actor.userId,identityHash:checkinEventBindingHash(token),day,query:{scope:"station",limit:1,cursor}},requestKey:null});
    expect((await historyDay("2099-01-01")).items).toEqual([]);
    const accepted = await t.service.preflight(t.token,command);
    if (accepted.state !== "accepted" || !accepted.printIntentId) throw new Error("No initial intent");
    const recovery = async (command: object) => t.pb.send<any>("/api/wts/checkin-recovery",{method:"POST",body:{operation:"command",actorUserId:t.operator.actor.userId,identityHash:checkinEventBindingHash(t.token),command:{operationId:crypto.randomUUID(),workflowId:accepted.workflow.id,...command}},requestKey:null});
    const projection = await t.pb.collection("checkin_recovery_workflows").getFirstListItem(`workflow_id = '${accepted.workflow.id}'`);
    const corrected = await recovery({operation:"correct",expectedVersion:projection.version,name:"Corrected Label",affiliation:"New Label Affiliation"});
    await recovery({operation:"replace",expectedVersion:corrected.workflow.version,printId:accepted.printIntentId});
    expect(await t.service.preflight(t.token,command)).toMatchObject({state:"accepted",workflow:{printState:"queued",name:"Тест Attendee",affiliation:"Test organisation"}});
    expect(await t.service.status(t.token,cachedCommand.operationId)).toMatchObject({result:{state:"accepted",workflow:{printState:"queued",name:"Тест Attendee"}}});
    expect((await historyDay("2099-01-01")).items).toMatchObject([{completedAt:null,result:{workflow:{printState:"queued"}}}]);
    const replacement = await t.pb.collection("checkin_print_attempts").getFirstListItem("purpose='replacement'");
    expect(replacement).toMatchObject({name:"Corrected Label",affiliation:"New Label Affiliation"});
    // Test historical admission timestamps, not forged completion transitions.
    const db = new DatabaseSync(join(t.root,"pb_data","data.db"));
    db.prepare("UPDATE checkin_arrival_commands SET completed_at='2020-01-01T00:00:00Z',completed_day='2020-01-01' WHERE id=?").run(frozen.id); db.close();
    for (const state of ["queued","dispatched","uncertain"]) {
      const historical = new DatabaseSync(join(t.root,"pb_data","data.db"));
      historical.prepare("UPDATE checkin_print_attempts SET state=? WHERE id=?").run(state,replacement.id); historical.close();
      expect((await historyDay("2099-01-01")).items).toMatchObject([{completedAt:null,result:{workflow:{printState:state}}}]);
    }
    const restore = new DatabaseSync(join(t.root,"pb_data","data.db"));
    restore.prepare("UPDATE checkin_print_attempts SET state='queued' WHERE id=?").run(replacement.id); restore.close();
    expect((await t.service.history(t.token)).items).toMatchObject([{completedAt:null,result:{workflow:{printState:"queued"}}}]);
    const second = await ready(t,"wts2026station2",runtime.coordinator);
    const otherToken = "d".repeat(64);
    await t.control.bind(second.code,otherToken,(await t.control.preview(second.code)).confirmation);
    expect(await t.service.preflight(otherToken,command)).toEqual({state:"already_handled",operationId:command.operationId,replayed:true,operationsEnabled:false});
    expect((await historyDay(currentDay,otherToken)).items).toEqual([]);
    expect((await t.service.status(otherToken, command.operationId)).result).toBeNull();
    expect((await historyDay(currentDay,otherToken,`${frozen.created}|${frozen.id}`)).items).toEqual([]);
    expect((await new CheckinArrivalService(t.pb,t.admin.actor,t.source).history(undefined,{scope:"all",limit:1})).items).toHaveLength(1);
    // Complete the explicit replacement through the same simulated printer.
    await agent.heartbeat(); await runtime.coordinator.claimPrints();
    const next = await agent.work(); expect(next.attempts).toHaveLength(1);
    await agent.process(next.attempts[0],printer);

    expect(await t.service.preflight(t.token, command)).toMatchObject({state:"accepted", workflow:{printState:"completed"}});
    expect((await t.service.history(t.token)).items).toMatchObject([{completedAt: expect.any(String), result:{state:"accepted",workflow:{printState:"completed"}}}]);
    expect((await t.pb.collection("checkin_arrival_commands").getOne(frozen.id)).result).toEqual(frozen.result);
    expect((await t.pb.collection("checkin_print_attempts").getFullList()).every(p => p.state === "completed")).toBe(true);
    expect((await t.pb.collection("checkin_agent_authorizations").getFullList()).every(a => a.outcome === "protocol_complete")).toBe(true);
  } finally { journal.close(); await runtime.coordinator.close(); await t.cleanup(); }
});

it("status follows station ownership through login and phone handoffs, without writes",async()=>{
  const t=await setup();
  try {
    const command=t.command(); await t.service.preflight(t.token,command);
    const before=await t.pb.collection("checkin_arrival_commands").getFirstListItem(`operation_id='${command.operationId}'`);
    const audits=(await t.pb.collection("checkin_audit_events").getFullList()).length;
    const own=await t.service.status(t.token,command.operationId);
    expect(own.result).toEqual(before.result);
    const absent=await t.service.status(t.token,crypto.randomUUID()); expect(absent.result).toBeNull();
    expect(await new CheckinArrivalService(t.pb,t.admin.actor,t.source).status(t.token,command.operationId)).toEqual(own);
    expect((await t.pb.collection("checkin_audit_events").getFullList()).length).toBe(audits);
    const otherToken="e".repeat(64);await t.control.bind(t.code,otherToken,(await t.control.preview(t.code)).confirmation);
    expect(await t.service.status(otherToken,command.operationId)).toEqual(own);
    await expect(t.service.status(undefined,command.operationId)).rejects.toMatchObject({status:403});
    await expect(t.service.status(t.token,"bad' OR 1=1")).rejects.toMatchObject({status:400});
    expect(await t.pb.collection("checkin_arrival_commands").getOne(before.id)).toEqual(before);

    expect(JSON.stringify(own)).not.toMatch(/qrIdentity|qr_hash|actor_user_id|payload_hash|A-ABC1234/);
    await t.pb.collection("users").update(t.operator.actor.userId,{role:"user"});
    await expect(t.service.status(t.token,command.operationId)).rejects.toMatchObject({status:403});
  }finally{await t.cleanup();}
});
function sql(t: Awaited<ReturnType<typeof setup>>, statement: string) {
  const db = new DatabaseSync(join(t.root,"pb_data","data.db"));
  try { db.exec(statement); } finally { db.close(); }
}
it("atomically reconciles a genuine possibly-sent crash across all persisted projections", async () => {
  const t=await setup(), runtime=await ready(t); await runtime.coordinator.listen();
  try {
    await runtime.heartbeat();
    const command={...t.command(),context:await context(t)};
    await t.service.preflight(t.token,command);
    let owner=(await t.pb.collection("checkin_coordinator").getOne("wts2026coord000")).owner;
    const claimOwner=owner;
    const send=(operation:string,rest:object={})=>t.pb.send<any>("/api/wts/checkin-arrivals",{method:"POST",body:{operation,owner,...rest},requestKey:null});
    const {job}=await send("machine_admission_claim");
    await send("machine_admission_fence",{attemptId:job.attemptId,coordinatorGeneration:job.coordinatorGeneration});
    // Simulate death after persisted send boundary, with no outcome/catch path.
    await runtime.coordinator.close(); await runtime.coordinator.listen();
    owner=(await t.pb.collection("checkin_coordinator").getOne("wts2026coord000")).owner;
    sql(t,"CREATE TRIGGER fail_crash_audit BEFORE INSERT ON checkin_audit_events WHEN NEW.operation='admission_result' BEGIN SELECT RAISE(ABORT,'test failure'); END");
    await expect(send("machine_admission_reconcile")).rejects.toThrow();
    expect(await t.pb.collection("checkin_arrival_attempts").getOne(job.attemptId)).toMatchObject({state:"possibly_sent"});
    expect(await t.pb.collection("checkin_arrival_workflows").getOne(job.workflowId)).toMatchObject({state:"admission_pending"});
    expect((await t.pb.collection("checkin_arrival_commands").getOne(job.commandId)).result.state).toBe("reserved");
    sql(t,"DROP TRIGGER fail_crash_audit");
    await send("machine_admission_reconcile"); await send("machine_admission_reconcile");
    await t.restart();
    expect(await t.pb.collection("checkin_arrival_attempts").getOne(job.attemptId)).toMatchObject({state:"uncertain",claim_owner_hash:createHash("sha256").update(claimOwner).digest("hex"),outcome_digest:""});
    expect(await t.pb.collection("checkin_arrival_workflows").getOne(job.workflowId)).toMatchObject({state:"admission_uncertain"});
    expect((await t.pb.collection("checkin_arrival_commands").getOne(job.commandId)).result.state).toBe("admission_uncertain");
    expect((await t.service.history(t.token)).items).toMatchObject([{completedAt:null,result:{state:"admission_uncertain",workflow:{state:"admission_uncertain",printState:null}}}]);
    expect(await t.pb.collection("checkin_print_attempts").getFullList()).toHaveLength(0);
    expect(await t.pb.collection("checkin_audit_events").getFullList({filter:"operation='admission_result'"})).toHaveLength(1);
  } finally {await runtime.coordinator.close();await t.cleanup();}
});
it("validates closed late acceptance as suppressed, never a newly queued label", async()=>{
 const t=await setup(),runtime=await ready(t);await runtime.coordinator.listen();
 try{
  await runtime.heartbeat();const command={...t.command(),context:await context(t)};await t.service.preflight(t.token,command);
  const owner=(await t.pb.collection("checkin_coordinator").getOne("wts2026coord000")).owner;
  const send=(operation:string,rest:object={})=>t.pb.send<any>("/api/wts/checkin-arrivals",{method:"POST",body:{operation,owner,...rest},requestKey:null});
  const {job}=await send("machine_admission_claim");await send("machine_admission_fence",{attemptId:job.attemptId,coordinatorGeneration:job.coordinatorGeneration});
  await new CheckinLifecycleService(t.pb,t.admin.actor).close({operationId:crypto.randomUUID(),confirmEdition:"WTS2026"});
  await send("machine_admission_result",{attemptId:job.attemptId,outcome:{state:"newly_checked_in",fingerprint:"f".repeat(64)}});
  const result=await t.service.preflight(t.token,command);
  expect(result).toMatchObject({state:"accepted",printIntentId:null,printSuppression:"lifecycle",workflow:{state:"accepted",printState:null}});
  expect(checkinArrivalResultSchema.safeParse(result).success).toBe(true);
  expect(checkinArrivalResultSchema.safeParse({...result,printSuppression:undefined}).success).toBe(false);
  expect(checkinArrivalResultSchema.safeParse({...result,printIntentId:"bad"}).success).toBe(false);
  expect(checkinArrivalResultSchema.safeParse({...result,workflow:{...("workflow" in result?result.workflow:{}),printState:"queued"}}).success).toBe(false);
  expect(await t.pb.collection("checkin_print_attempts").getFullList()).toHaveLength(0);
 }finally{await runtime.coordinator.close();await t.cleanup();}
});

it("keyset-paginates bounded station history past old completed rows without foreign leakage",async()=>{
 const t=await setup();
 try{
  const first=t.command();await t.service.preflight(t.token,first);
  const original=await t.pb.collection("checkin_arrival_commands").getFirstListItem(`operation_id='${first.operationId}'`);
  const db=new DatabaseSync(join(t.root,"pb_data","data.db"));
  const insert=db.prepare("INSERT INTO checkin_arrival_commands (id,operation_id,station_id,event_id,status,result,history_visible,created,completed_at,completed_day) VALUES (?,?,?,?,?,?,?,?,?,?)");
  const expected=[first.operationId];
  for(let i=0;i<108;i++){
   const operation=crypto.randomUUID(), old=i<103, foreign=i>=106;
   insert.run(`page${String(i).padStart(11,"0")}`,operation,foreign?"wts2026station2":"wts2026station1",original.event_id,"final",JSON.stringify(old?{state:"rejected",reason:"invalid_identity"}:{state:"dependency_unavailable"}),1,"2020-01-01 00:00:00.000Z",old?"2020-01-01T00:00:00Z":"",old?"2020-01-01":"");
   if(!old&&!foreign)expected.push(operation);
  }
  db.close();
  const seen:string[]=[];let cursor:string|undefined;
  do{
   const page=await t.service.history(t.token,{limit:1,cursor});expect(page.items.length).toBeLessThanOrEqual(1);
   seen.push(...page.items.map(item=>item.operationId));expect(seen.length).toBeLessThanOrEqual(expected.length);
   cursor=page.nextCursor??undefined;
  }while(cursor);
  expect(seen.sort()).toEqual(expected.sort());expect(new Set(seen).size).toBe(expected.length);
  await expect(t.service.history(t.token,{cursor:"2020-01-01|bad' OR 1=1"})).rejects.toThrow();
 }finally{await t.cleanup();}
});
