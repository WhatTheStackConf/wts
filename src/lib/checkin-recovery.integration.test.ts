import { expect, it } from "vite-plus/test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { setup, ready, context } from "./checkin-recovery-test-helper";
import { CheckinRecoveryService } from "./checkin-recovery-service";
import type { RecoveryCommand, RecoveryRead } from "./checkin-recovery-contract";

async function fixture(accepted = false) {
 const t = await setup(); const r = await ready(t); await r.coordinator.listen(); await r.heartbeat();
 const first = await t.service.preflight(t.token, {...t.command(), context: await context(t)});
 if (first.state !== "reserved") throw new Error("reservation failed");
 let posts = 0;
 const processor = {attendee: async () => ({upstreamAttendeeId:"501", publicId:"A-ABC1234",productId:"401",alreadyCheckedIn:false}), admit: async () => { posts++; return accepted ? {state:"newly_checked_in" as const, fingerprint:"d".repeat(64)} : {state:"uncertain" as const}; }};
 await r.coordinator.processAdmissions(processor);
 let outcome: RecoveryRead = {state:"existing", checkinId:"901", fingerprint:"d".repeat(64)};
 const targets: unknown[] = [];
 const source = { reconcile: async (target: unknown) => { targets.push(target); return outcome; } };
 const admin = new CheckinRecoveryService(t.pb,t.admin.actor,source), operator = new CheckinRecoveryService(t.pb,t.operator.actor,source);
 const workflowId = first.workflow.id;
 const command = async (input: object, who = admin, token: string | undefined = undefined) => who.command(token, {operationId:crypto.randomUUID(),workflowId,expectedVersion:(await admin.get(undefined,workflowId)).version,...input} as RecoveryCommand);
 const raw = async (operation: string, payload: object = {}, nowMs=Date.now()) => {
  const coord = await t.pb.collection("checkin_coordinator").getOne("wts2026coord000");
  return t.pb.send<Record<string, any>>("/api/wts/checkin-agents", {method:"POST", body:{operation:`machine_${operation}`,owner:coord.owner,nowMs,credentialHash:(await t.pb.collection("checkin_agents").getFullList())[0]!.credential_hash,payload:{stationId:"wts2026station1",...payload}},requestKey:null});
 };
 const settle = async (outcome = "output_uncertain") => {
  await r.coordinator.claimPrints();
  const attempts = await t.pb.collection("checkin_agent_attempts").getFullList({sort:"created,id"}); const a = attempts.at(-1)!;
  const p = {attemptId:a.id,payloadHash:a.payload_hash,authorizationHash:crypto.randomUUID().replaceAll("-","")+crypto.randomUUID().replaceAll("-","")};
  await raw("authorize",p); await raw("start",p); await raw("outcome",{...p,outcome}); return a;
 };
 return {t,r,admin,operator,workflowId,command,raw,settle,targets,processor,posts:()=>posts,setRead:(value:RecoveryRead)=>{outcome=value;},close:async()=>{await r.coordinator.close();await t.cleanup();}};
}

it("admin reconciliation preserves original snapshot; absent/malformed/unavailable never rePOST or print", async () => {
 const f=await fixture(); try {
  for (const state of ["absent","malformed","unavailable"] as const) {
   f.setRead({state}); const read=await f.admin.reconcile(f.workflowId); expect(read.state).toBe(state);
   await expect(f.command({operation:"authorize_initial",readId:read.id,reason:"incident",note:""})).rejects.toThrow();
   await f.r.coordinator.processAdmissions(f.processor);
  }
  expect(f.posts()).toBe(1);expect(await f.t.pb.collection("checkin_print_attempts").getFullList()).toHaveLength(0);
  expect(f.targets).toEqual(Array(3).fill({workflowId:f.workflowId,sourceKey:"a".repeat(64),upstreamEventId:"101",upstreamListId:"201",upstreamAttendeeId:"501"}));
  await expect(f.operator.reconcile(f.workflowId)).rejects.toThrow();
  const read=await f.admin.reconcile(f.workflowId);
  for(const operation of ["authorize_initial","reset","deny","cancel","continue"]) await expect(f.command({operation,readId:read.id,reason:"incident",note:""},f.operator,f.t.token)).rejects.toThrow();
  const safe=await f.operator.get(f.t.token,f.workflowId);expect(safe.reads).toEqual([]);expect(safe.admissionAttempts).toEqual([]);
  expect(JSON.stringify(safe)).not.toMatch(/A-ABC1234|example.test|sourceKey|public_id/);
  await expect(f.t.operator.client.send("/api/wts/checkin-recovery",{method:"POST",body:{operation:"reconcile_context",actorUserId:f.t.admin.actor.userId,workflowId:f.workflowId}})).rejects.toThrow();
 } finally {await f.close();}
});

it("concurrent initial authorization converges with immutable commands and unique initial purpose", async()=>{
 const f=await fixture(); try {
  const old=await f.admin.reconcile(f.workflowId); f.setRead({state:"absent"});await f.admin.reconcile(f.workflowId);
  await expect(f.command({operation:"authorize_initial",readId:old.id,reason:"incident",note:""})).rejects.toThrow();
  f.setRead({state:"existing",checkinId:"901",fingerprint:"d".repeat(64)});const read=await f.admin.reconcile(f.workflowId);
  const c={operation:"authorize_initial" as const,operationId:crypto.randomUUID(),workflowId:f.workflowId,expectedVersion:0,readId:read.id,reason:"incident" as const,note:""};
  const results=await Promise.all([f.admin.command(undefined,c),f.admin.command(undefined,c)]);expect(results[0]!.workflow).toEqual(results[1]!.workflow);
  await expect(f.admin.command(undefined,{...c,note:"changed"})).rejects.toThrow();
  await expect(f.command({...c,operationId:crypto.randomUUID(),expectedVersion:1})).rejects.toThrow();
  const prints=await f.t.pb.collection("checkin_print_attempts").getFullList();expect(prints).toHaveLength(1);
  expect((await f.t.pb.collection("checkin_arrival_workflows").getOne(f.workflowId)).state).toBe("admission_uncertain");
  for(const collection of ["checkin_recovery_commands","checkin_recovery_reads","checkin_recovery_audit","checkin_print_attempts"]){const row=(await f.t.pb.collection(collection).getFullList())[0]!; await expect(f.t.pb.collection(collection).update(row.id,{name:"tamper",result:{}})).rejects.toThrow();await expect(f.t.pb.collection(collection).delete(row.id)).rejects.toThrow();}
 } finally {await f.close();}
});

it("active Cyrillic corrections freeze dispatched text; observations never output and replacements form unlimited immutable chain",async()=>{
 const f=await fixture(true);try {
  await f.r.coordinator.claimPrints(); let w=await f.admin.get(undefined,f.workflowId); const original=w.attempts[0]!;
  await f.command({operation:"correct",name:"Ана Попова",affiliation:""},f.operator,f.t.token);
  expect((await f.admin.get(undefined,f.workflowId)).attempts[0]!.name).toBe(original.name);
  await expect(f.command({operation:"replace",printId:original.id},f.operator,f.t.token)).rejects.toThrow();
  await f.settle();
  await expect(f.command({operation:"handwrite",physicallyIsolated:false},f.operator,f.t.token)).rejects.toThrow();
  const preview=await f.operator.preview(f.t.token,f.workflowId,"Ана Попова","");expect(preview.pngBase64.length).toBeGreaterThan(100);expect(preview.name).toBe("Ана Попова");
  for(let i=0;i<4;i++){
   w=await f.admin.get(undefined,f.workflowId);const last=w.attempts.at(-1)!;
   const c={operation:"observe" as const,operationId:crypto.randomUUID(),workflowId:f.workflowId,expectedVersion:w.version,printId:last.id,outcome:i%2?"printed" as const:"not_printed" as const};
   const observed=await Promise.all([f.operator.command(f.t.token,c),f.operator.command(f.t.token,c)]);expect(observed[0]!.workflow).toEqual(observed[1]!.workflow);
   expect(observed[0]!.workflow.attempts).toHaveLength(i+1);
   const replaced=await f.command({operation:"replace",printId:last.id},f.operator,f.t.token);
   expect(replaced.workflow.attempts.at(-1)).toMatchObject({purpose:"replacement",predecessorId:last.id,name:"Ана Попова",affiliation:""});
   await f.settle("protocol_complete");
  }
  expect((await f.admin.get(undefined,f.workflowId)).attempts).toHaveLength(5);expect(f.posts()).toBe(1);
 }finally{await f.close();}
});

it("disconnected cancellation requires acknowledgement; isolation blocks reuse and old queues never authorize",async()=>{
 const f=await fixture(true);try {
  await f.r.coordinator.claimPrints();
  const pending=await f.command({operation:"handwrite",physicallyIsolated:false},f.operator,f.t.token);expect(pending.workflow.fulfillment).toBe("handwrite_pending");
  const cancellations=await f.raw("cancellations"); const c=cancellations.cancellations[0];expect(c).toBeTruthy();
  await expect(f.raw("authorize",{attemptId:c.work.attemptId,payloadHash:c.work.payloadHash,authorizationHash:"f".repeat(64)})).rejects.toThrow();
  await expect(f.raw("neutralized",{cancellationId:c.cancellationId,attemptId:c.work.attemptId,payloadHash:"e".repeat(64),disposition:"neutralized"})).rejects.toThrow();
  await f.t.restart();
  await expect(f.r.heartbeat()).rejects.toThrow(); // Reboot retires the old producer lease.
  expect((await f.raw("cancellations")).cancellations[0].cancellationId).toBe(c.cancellationId);
  await f.raw("neutralized",{cancellationId:c.cancellationId,attemptId:c.work.attemptId,payloadHash:c.work.payloadHash,disposition:"neutralized"});
  expect((await f.admin.get(undefined,f.workflowId)).fulfillment).toBe("handwrite_pending");
  await f.command({operation:"handwrite",physicallyIsolated:false},f.operator,f.t.token);
  expect((await f.admin.get(undefined,f.workflowId)).fulfillment).toBe("handwritten");
  await f.r.coordinator.close(); await f.r.coordinator.listenReportingOnly();
  await expect(f.r.heartbeat()).rejects.toThrow();
  expect((await f.t.pb.collection("checkin_lifecycle").getOne("wts2026life0000")).restore_required).toBe(true);
  await expect(f.raw("work",{purpose:"label"})).rejects.toMatchObject({ status: 503 });
  await expect(f.command({operation:"replace",printId:pending.workflow.attempts[0]!.id},f.operator,f.t.token)).rejects.toThrow();
 }finally{await f.close();}
 const g=await fixture(true);try{
  await g.r.coordinator.claimPrints();const isolated=await g.command({operation:"handwrite",physicallyIsolated:true},g.operator,g.t.token);expect(isolated.workflow).toMatchObject({isolated:true,fulfillment:"handwrite_pending"});
  await g.command({operation:"handwrite",physicallyIsolated:true},g.operator,g.t.token);expect((await g.admin.get(undefined,g.workflowId)).fulfillment).toBe("handwritten");
  await expect(g.command({operation:"release_isolation",confirmed:true},g.operator,g.t.token)).rejects.toThrow();
  expect((await g.raw("status")).station.readyForAuthorization).toBe(false);
  const c=(await g.raw("cancellations")).cancellations[0];await g.raw("neutralized",{cancellationId:c.cancellationId,attemptId:c.work.attemptId,payloadHash:c.work.payloadHash,disposition:"neutralized"});
  await g.command({operation:"release_isolation",confirmed:true},g.operator,g.t.token);expect((await g.raw("work",{purpose:"label"})).attempts).toEqual([]);
 }finally{await g.close();}
});

it("reset requires stopped producers and exact fresh read; send boundary and unknown outcome never retry or restore eligibility",async()=>{
 const f=await fixture();try{
  const read=await f.admin.reconcile(f.workflowId);
  const c={operation:"reset",readId:read.id,checkinId:"901",confirmed:true,producersQuiescent:true,reason:"erroneous_checkin",note:"Synthetic reset"};
  await expect(f.command(c)).rejects.toThrow();
  const system=await f.t.pb.collection("checkin_system").getOne("wts2026system00");await f.t.control.adminControl({operation:"set_system_enabled",operationId:crypto.randomUUID(),expectedVersion:system.version,enabled:false,reason:"incident"});
  await expect(f.command(c)).rejects.toThrow(); await f.r.coordinator.close();
  await expect(f.command({...c,checkinId:"902"})).rejects.toThrow();
  await f.command(c);await f.r.coordinator.listen();
  const raw=async(operation:string,data:object={})=>{const coord=await f.t.pb.collection("checkin_coordinator").getOne("wts2026coord000");return f.t.pb.send<Record<string,any>>("/api/wts/checkin-recovery",{method:"POST",body:{operation,owner:coord.owner,nowMs:Date.now(),...data},requestKey:null});};
  const claim=await raw("machine_reset_claim");expect(claim.job).toMatchObject({workflowId:f.workflowId,checkinId:"901",upstreamListId:"201",upstreamAttendeeId:"501"});
  expect((await f.t.pb.collection("checkin_recovery_resets").getOne(claim.job.resetId)).send_boundary_at).toBeTruthy();
  expect(await raw("machine_reset_claim")).toEqual({job:null});
  await raw("machine_reset_result",{resetId:claim.job.resetId,outcome:"uncertain"});
  f.setRead({state:"absent"});await f.admin.reconcile(f.workflowId);expect(await raw("machine_reset_claim")).toEqual({job:null});
  await expect(f.command({operation:"authorize_initial",readId:read.id,reason:"incident",note:""})).rejects.toThrow();
  expect((await f.t.pb.collection("checkin_arrival_workflows").getOne(f.workflowId)).state).toBe("admission_uncertain");expect(f.posts()).toBe(1);
 }finally{await f.close();}
});

it("owning-station history and park survive reload; foreign reads and all label commands fail, no transfer exists",async()=>{
 const f=await fixture();try{
  const parked=await f.command({operation:"park"},f.operator,f.t.token);expect(parked.workflow.parked).toBe(true);await f.t.restart();
  expect((await f.operator.history(f.t.token)).items[0]!.parked).toBe(true);
  await f.command({operation:"resume"},f.operator,f.t.token);expect((await f.operator.history(f.t.token)).items[0]!.parked).toBe(false);
  await expect(f.operator.get("c".repeat(64),f.workflowId)).rejects.toThrow();await expect(f.operator.history("c".repeat(64))).rejects.toThrow();
  for(const operation of ["correct","observe","replace","handwrite","park","resume","transfer"]) await expect(f.command({operation,name:"Other",affiliation:"",printId:"a".repeat(15),outcome:"printed",physicallyIsolated:true},f.operator,"c".repeat(64))).rejects.toThrow();
  await f.command({operation:"continue",reason:"incident",note:""});await f.command({operation:"deny",reason:"incident",note:""});expect((await f.admin.get(undefined,f.workflowId)).decision).toBe("denied");
 }finally{await f.close();}
});


it("HTTP/client paginate over 1000 multibyte legal history rows and continue replacements", async () => {
 const f=await fixture(true);try {
  await f.settle("protocol_complete");
  const print=(await f.t.pb.collection("checkin_print_attempts").getFullList())[0]!;
  const agent=(await f.t.pb.collection("checkin_agent_attempts").getFullList())[0]!;
  const auth=(await f.t.pb.collection("checkin_agent_authorizations").getFullList())[0]!;
  const db=new DatabaseSync(join(f.t.root,"pb_data/data.db"));
  db.prepare("UPDATE checkin_print_attempts SET created=? WHERE id=?").run("2020-01-01 00:00:00.000Z",print.id);db.close();
  const pid=(i:number)=>`history${String(i).padStart(8,"0")}`;
  seedCopies(f,"checkin_print_attempts",print,1001,i=>({id:pid(i),purpose:"replacement",name:"Ж".repeat(200),affiliation:"界".repeat(200),predecessor_attempt_id:i?pid(i-1):print.id,created:"2020-01-02 00:00:00.000Z"}));
  seedCopies(f,"checkin_agent_attempts",agent,1,()=>({id:"historyagent001",print_attempt_id:pid(1000)}));
  seedCopies(f,"checkin_agent_authorizations",auth,1,()=>({id:"historyauth0001",attempt_id:"historyagent001",authorization_hash:"9".repeat(64)}));
  const { handleCheckinRecoveryRequest }=await import("./checkin-recovery-http");
  const { getRecovery, commandRecovery, recoveryAttemptHistory }=await import("./checkin-recovery-client");
  const originalFetch=globalThis.fetch;
  const http=(body:unknown,token=f.t.token)=>handleCheckinRecoveryRequest(new Request("https://wts.test/api/checkin-recovery",{method:"POST",headers:{origin:"https://wts.test","content-type":"application/json",cookie:`wts_checkin_client=${token}`},body:JSON.stringify(body)}),{authenticate:async()=>({id:f.t.operator.actor.userId,role:"checkin_operator"}),service:async()=>f.operator});
  try {
   globalThis.fetch=((url:any,init:any)=>url==="/api/checkin-recovery"?http(JSON.parse(init.body)):originalFetch(url,init)) as typeof fetch;
   const current=await getRecovery(f.workflowId);expect(current.attempts).toHaveLength(25);expect(current.attemptsTruncated).toBe(true);expect(current.attempts.at(-1)!.id).toBe(pid(1000));
   const ids:string[]=[];let offset:number|null=0;
   while(offset!==null){const p=await recoveryAttemptHistory(f.workflowId,offset);expect(p.items.length).toBeLessThanOrEqual(25);if(p.nextOffset!==null)expect(p.nextOffset).toBe(offset+p.items.length);ids.push(...p.items.map(a=>a.id));offset=p.nextOffset;}
   expect(ids).toEqual([print.id,...Array.from({length:1001},(_,i)=>pid(i))]);expect(new Set(ids).size).toBe(1002);
   expect((await http({operation:"attempt_history",workflowId:f.workflowId,offset:0},"e".repeat(64))).status).toBe(403);
   const command={operation:"replace" as const,workflowId:f.workflowId,operationId:crypto.randomUUID(),expectedVersion:current.version,printId:pid(1000)};
   const result=await commandRecovery(command);expect(result.workflow.attempts).toHaveLength(25);expect(result.workflow.attempts.at(-1)!.predecessorId).toBe(pid(1000));
   const replay=await commandRecovery(command);expect(replay.replayed).toBe(true);
   const lastPage=await recoveryAttemptHistory(f.workflowId,1000);expect(lastPage.items).toHaveLength(3);expect(lastPage.nextOffset).toBe(null);
   const receipt=await f.t.pb.collection("checkin_recovery_commands").getFirstListItem(`operation_id="${command.operationId}"`);expect(Buffer.byteLength(JSON.stringify(receipt.result))).toBeLessThan(1024);
  } finally {globalThis.fetch=originalFetch;}
 }finally{await f.close();}
},60000);

function seedCopies(f: Awaited<ReturnType<typeof fixture>>, table: string, original: Record<string, any>, count: number, values: (i:number)=>Record<string,any>) {
 const db=new DatabaseSync(join(f.t.root,"pb_data/data.db"));try {
  const columns=(db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[]).map(c=>c.name);
  const insert=db.prepare(`INSERT INTO ${table} (${columns.map(c=>`"${c}"`).join(",")}) VALUES (${columns.map(()=>"?").join(",")})`);
  const row=db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(original.id) as Record<string,any>;
  db.exec("BEGIN");for(let i=0;i<count;i++){const copy={...row,...values(i)};insert.run(...columns.map(c=>copy[c]));}db.exec("COMMIT");
 }finally{db.close();}
}

it("persistent claim scans past 100 blocked, unready and assigned queued rows without starving a later station",async()=>{
 const f=await fixture(true);try{
  await f.r.coordinator.claimPrints();
  const print=(await f.t.pb.collection("checkin_print_attempts").getFullList())[0]!;
  const a=(await f.t.pb.collection("checkin_agent_attempts").getFullList())[0]!;
  const db=new DatabaseSync(join(f.t.root,"pb_data/data.db"));
  db.prepare("UPDATE checkin_print_attempts SET created=? WHERE id=?").run("2020-01-01 00:00:00.000Z",print.id);db.close();
  // Prior assigned rows remain queued and must not consume the public limit.
  seedCopies(f,"checkin_print_attempts",print,100,i=>({id:`assigned${String(i).padStart(7,"0")}`,purpose:"replacement",created:"2020-01-01 00:00:01.000Z"}));
  seedCopies(f,"checkin_agent_attempts",a,100,i=>({id:`assigned${String(i).padStart(7,"0")}`,print_attempt_id:`assigned${String(i).padStart(7,"0")}`}));
  seedCopies(f,"checkin_print_attempts",print,100,i=>({id:`unready${String(i).padStart(8,"0")}`,purpose:"replacement",station_id:"wts2026station2",created:"2020-01-01 00:00:02.000Z"}));
  seedCopies(f,"checkin_print_attempts",print,1,()=>({id:"eligiblebefore1",purpose:"replacement",created:"2020-01-01 00:00:02.500Z"}));
  expect(await f.r.coordinator.claimPrints()).toBe(1);
  expect(await f.t.pb.collection("checkin_agent_attempts").getFullList({filter:'print_attempt_id="eligiblebefore1"'})).toHaveLength(1);
  await f.command({operation:"handwrite",physicallyIsolated:false},f.operator,f.t.token);
  const cancel=(await f.t.pb.collection("checkin_recovery_cancellations").getFullList())[0]!;
  seedCopies(f,"checkin_print_attempts",print,100,i=>({id:`blocked${String(i).padStart(8,"0")}`,purpose:"replacement",station_id:"wts2026station2",created:"2020-01-01 00:00:03.000Z"}));
  seedCopies(f,"checkin_recovery_cancellations",cancel,100,i=>({id:`blocked${String(i).padStart(8,"0")}`,print_id:`blocked${String(i).padStart(8,"0")}`}));
  // Separate accepted workflow at the ready station remains eligible.
  const w=await f.t.pb.collection("checkin_arrival_workflows").getOne(f.workflowId);
  seedCopies(f,"checkin_arrival_workflows",w,1,()=>({id:"eligiblework001",operation_id:crypto.randomUUID(),upstream_attendee_id:"777",public_id:"A-XYZ1234",print_intent_id:"eligibleprint01"}));
  seedCopies(f,"checkin_print_attempts",print,1,()=>({id:"eligibleprint01",workflow_id:"eligiblework001",created:"2020-01-01 00:00:04.000Z"}));
  expect(await f.r.coordinator.claimPrints()).toBe(1);
  expect(await f.t.pb.collection("checkin_agent_attempts").getFullList({filter:'print_attempt_id="eligibleprint01"'})).toHaveLength(1);
 }finally{await f.close();}
});

it("cancellation ownership is filtered before limit and neutralization persists CET day without inventing handwriting",async()=>{
 const f=await fixture(true);try{
  await f.r.coordinator.claimPrints();await f.command({operation:"cancel",reason:"incident",note:""});
  const own=(await f.raw("cancellations")).cancellations[0];expect(own.startState).toBe("not_started");
  const c=await f.t.pb.collection("checkin_recovery_cancellations").getOne(own.cancellationId);
  const a=await f.t.pb.collection("checkin_agent_attempts").getOne(own.work.attemptId);
  seedCopies(f,"checkin_agent_attempts",a,100,i=>({id:`foreign${String(i).padStart(8,"0")}`,agent_id:"foreignagent001",print_attempt_id:`foreign${String(i).padStart(8,"0")}`}));
  seedCopies(f,"checkin_recovery_cancellations",c,100,i=>({id:`foreign${String(i).padStart(8,"0")}`,agent_attempt_id:`foreign${String(i).padStart(8,"0")}`,print_id:`foreign${String(i).padStart(8,"0")}`,workflow_id:"foreignwork0001",created:"2020-01-01 00:00:00.000Z"}));
  expect((await f.raw("cancellations")).cancellations.map((r:any)=>r.cancellationId)).toEqual([own.cancellationId]);
  await f.raw("neutralized",{cancellationId:own.cancellationId,attemptId:own.work.attemptId,payloadHash:own.work.payloadHash,disposition:"neutralized"},Date.parse("2026-01-15T22:30:00Z"));
  expect(await f.admin.get(undefined,f.workflowId)).toMatchObject({decision:"cancelled",fulfillment:"cancelled",completedDay:"2026-01-15"});
  await f.t.restart();expect(await f.admin.get(undefined,f.workflowId)).toMatchObject({decision:"cancelled",completedDay:"2026-01-15"});
 }finally{await f.close();}
});

it("many multibyte replacements keep immutable bounded receipts and replay current projection with canonical command version",async()=>{
 const f=await fixture(true);try{
  const correction={operation:"correct" as const,operationId:crypto.randomUUID(),workflowId:f.workflowId,expectedVersion:0,name:"Ж".repeat(200),affiliation:"界".repeat(200)};
  const first=await f.operator.command(f.t.token,correction);
  for(let i=0;i<40;i++){
   await f.settle("protocol_complete");
   const w=await f.admin.get(undefined,f.workflowId);expect(w.fulfillment).toBe("protocol_complete");
   await f.command({operation:"replace",printId:w.attempts.at(-1)!.id},f.operator,f.t.token);
  }
  const current=await f.admin.get(undefined,f.workflowId);expect(current.attempts).toHaveLength(25);
  expect(current.attemptsTruncated).toBe(true);
  const page=async(offset:number)=>f.t.pb.send<any>("/api/wts/checkin-recovery",{method:"POST",body:{operation:"attempt_history",actorUserId:f.t.admin.actor.userId,workflowId:f.workflowId,offset},requestKey:null});
  const p1=await page(0),p2=await page(p1.nextOffset);expect(p1.items).toHaveLength(25);expect(p2.items).toHaveLength(16);expect(p2.nextOffset).toBe(null);
  expect(new Set([...p1.items,...p2.items].map((r:any)=>r.id)).size).toBe(41);
  const receipts=await f.t.pb.collection("checkin_recovery_commands").getFullList();
  expect(receipts.every(r=>Buffer.byteLength(JSON.stringify(r.result))<1024&&!r.result.workflow)).toBe(true);
  await f.t.restart();
  const replay=await f.operator.command(f.t.token,correction) as any;
  expect(replay).toMatchObject({operationId:correction.operationId,replayed:true,commandVersion:first.workflow.version,workflow:{version:current.version}});
  expect(replay.workflow.attempts).toHaveLength(25);
  expect(await f.t.pb.collection("checkin_recovery_commands").getFullList()).toHaveLength(receipts.length);
 }finally{await f.close();}
},60000);


it("late protocol replay preserves human observation and handwriting; terminal projections survive restart",async()=>{
 const f=await fixture(true);try{
  await f.command({operation:"correct",name:"Тест",affiliation:""},f.operator,f.t.token);
  const attempt=await f.settle("protocol_complete");
  let w=await f.admin.get(undefined,f.workflowId);expect(w.fulfillment).toBe("protocol_complete");expect(w.completedDay).toMatch(/^2026-/);
  const auth=(await f.t.pb.collection("checkin_agent_authorizations").getFullList({filter:`attempt_id="${attempt.id}"`}))[0]!;
  const report={attemptId:attempt.id,authorizationHash:auth.authorization_hash,outcome:"protocol_complete"};
  await f.command({operation:"observe",printId:w.attempts.at(-1)!.id,outcome:"not_printed"},f.operator,f.t.token);
  w=await f.admin.get(undefined,f.workflowId);await f.raw("outcome",report);
  expect(await f.admin.get(undefined,f.workflowId)).toMatchObject({version:w.version,fulfillment:"not_printed",completedDay:""});
  await f.command({operation:"handwrite",physicallyIsolated:false},f.operator,f.t.token);
  await f.command({operation:"handwrite",physicallyIsolated:false},f.operator,f.t.token);
  w=await f.admin.get(undefined,f.workflowId);await f.raw("outcome",report);
  expect(await f.admin.get(undefined,f.workflowId)).toMatchObject({version:w.version,fulfillment:"handwritten"});
  await f.t.restart();expect(await f.admin.get(undefined,f.workflowId)).toMatchObject({version:w.version,fulfillment:"handwritten"});
 }finally{await f.close();}
});
