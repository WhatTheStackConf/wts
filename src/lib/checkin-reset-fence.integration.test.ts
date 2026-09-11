import { expect, it } from "vite-plus/test";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { join, resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { setup, ready, context } from "./checkin-recovery-test-helper";
import { CheckinRecoveryService } from "./checkin-recovery-service";
import { createCheckinRecoverySource } from "./checkin-recovery-upstream";
import { createCheckinEventSource } from "./checkin-event-source";
import { Coordinator } from "../../runtime/checkin/coordinator";

// Source-pinned logical URLs are mapped exclusively onto this disposable loopback
// server. No production hostname, credential, attendee or physical device is used.
async function upstream() {
  const base = "https://synthetic.example.invalid/api";
  const config = { apiUrl: base, apiKey: `e30.${Buffer.from(JSON.stringify({account_id:1})).toString("base64url")}.synthetic`, accountId: "1" };
  let effects = 0, changed = false, hold = false;
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const inspecting = new Promise<void>(resolve => { entered = resolve; });
  const product = {id:401,event_id:101,title:"Synthetic admission"};
  const row = {id:501,event_id:101,public_id:"A-ABC1234",product_id:401,order_id:601};
  function page(path: string, data: unknown[], simple = false) {
    return {data,links:{first:`${base}/${path}?page=1`,last:simple?null:`${base}/${path}?page=1`,prev:null,next:null},meta:{current_page:1,per_page:25,from:data.length?1:null,to:data.length||null,path:`${base}/${path}`,...(simple?{}:{last_page:1,total:data.length})}};
  }
  const calls: string[] = [];
  const server = createServer(async (req,res) => {
    calls.push(req.method!);
    if(req.method === "DELETE") { effects++; res.writeHead(204); res.end(); return; }
    const path = req.url!.replace(/^\/api\//, ""); let data: unknown;
    if(path.startsWith("events/101/check-in-lists?")) data=page("events/101/check-in-lists",[{id:201,name:"Synthetic list",short_id:"cil_SYNTHETIC",is_active:true,is_expired:false,products:[product]}]);
    else if(path.endsWith("/questions")) data={data:[]};
    else if(path.startsWith("events/101/products?")) data=page("events/101/products",[product]);
    else if(path === "events/101/attendees/501") data={data:row};
    else if(path.startsWith("public/check-in-lists/cil_SYNTHETIC/attendees?")) {
      if(hold) { entered(); await gate; }
      data=page("public/check-in-lists/cil_SYNTHETIC/attendees",[{...row,check_in:{id:901,attendee_id:501,check_in_list_id:201,order_id:601,checked_in_at:changed?"2026-09-09T10:01:00Z":"2026-09-09T10:00:00Z",short_id:"ci_SYNTHETIC"}}],true);
    } else {res.writeHead(404);res.end();return;}
    res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify(data));
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();if(!address || typeof address === "string") throw new Error("missing loopback address");
  const transport: typeof fetch = async (url,init) => {
    const logical = String(url); if(!logical.startsWith(base+"/")) throw new Error("nonfixture request");
    return fetch(logical.replace(base,`http://127.0.0.1:${address.port}/api`),init);
  };
  return { config, loopback: `http://127.0.0.1:${address.port}/api`, source:createCheckinRecoverySource(config,transport), sourceKey:createCheckinEventSource(config).sourceKey,
    calls, effects:()=>effects, change:()=>{changed=true;}, pause:()=>{hold=true;}, inspecting, release,
    close:async()=>{release();await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});} };
}
async function provision() {
  const t=await setup(); const u=await upstream();
  let coordinator: Coordinator | undefined;
  try {
    const r=await ready(t);coordinator=r.coordinator;await coordinator.listen();await r.heartbeat();
    const first=await t.service.preflight(t.token,{...t.command(),context:await context(t)});
    if(first.state!=="reserved")throw new Error("reservation failed");
    await coordinator.processAdmissions({attendee:async()=>({upstreamAttendeeId:"501",publicId:"A-ABC1234",productId:"401",alreadyCheckedIn:true}),admit:async()=>({state:"uncertain"})});
    const system=await t.pb.collection("checkin_system").getOne("wts2026system00");
    await t.control.adminControl({operation:"set_system_enabled",operationId:crypto.randomUUID(),expectedVersion:system.version,enabled:false,reason:"incident"});
    await coordinator.close();
    // Fixture-only source identity, before any recovery inspection or claim.
    const db=new DatabaseSync(join(t.root,"pb_data/data.db"));
    try {db.prepare("UPDATE checkin_arrival_workflows SET source_key=? WHERE id=?").run(u.sourceKey,first.workflow.id);} finally {db.close();}
    const recovery=new CheckinRecoveryService(t.pb,t.admin.actor,u.source);
    const read=await recovery.reconcile(first.workflow.id);
    await recovery.command(undefined,{operationId:crypto.randomUUID(),workflowId:first.workflow.id,expectedVersion:0,operation:"reset",readId:read.id,checkinId:"901",confirmed:true,producersQuiescent:true,reason:"erroneous_checkin",note:"Synthetic reset"});
    await coordinator.listen();
    return {t,u,coordinator,cleanup:async()=>{await coordinator!.close();await u.close();await t.cleanup();}};
  } catch(error) {await coordinator?.close();await u.close();await t.cleanup();throw error;}
}

it.each(["valid","enabled","enabled_then_stopped","takeover","fingerprint"] as const)("real PB + production reset adapter: paused fresh inspection %s",async fault=>{
  const f=await provision();let successor:Coordinator|undefined;
  try {
    f.u.pause();
    const processing=f.coordinator.processResets(f.u.source).then(value=>({value}),error=>({error}));
    await f.u.inspecting;
    const [claimed]=await f.t.pb.collection("checkin_recovery_resets").getFullList();
    expect(claimed.state).toBe("possibly_sent");expect(claimed.delete_fence_at).toBe("");
    expect(claimed.send_claim_target.resetId).toBe(claimed.id);
    if(fault === "enabled" || fault === "enabled_then_stopped") {
      let system=await f.t.pb.collection("checkin_system").getOne("wts2026system00");
      await f.t.control.adminControl({operation:"set_system_enabled",operationId:crypto.randomUUID(),expectedVersion:system.version,enabled:true,reason:"configuration"});
      if(fault === "enabled_then_stopped") {system=await f.t.pb.collection("checkin_system").getOne("wts2026system00");await f.t.control.adminControl({operation:"set_system_enabled",operationId:crypto.randomUUID(),expectedVersion:system.version,enabled:false,reason:"incident"});}
    }
    if(fault === "takeover") {
      // Keep the original coordinator active locally; expire only its backend lease
      // so the production callback reaches PB and is denied by the new owner fence.
      const db=new DatabaseSync(join(f.t.root,"pb_data/data.db"));
      try {db.prepare("UPDATE checkin_coordinator SET last_seen_at=? WHERE id='wts2026coord000'").run(new Date(Date.now()-60000).toISOString());} finally {db.close();}
      successor=new Coordinator(f.t.pb);await successor.listen();
    }
    if(fault === "fingerprint")f.u.change();
    f.u.release(); const result=await processing;
    if(fault!=="takeover")expect(result).toEqual({value:1});
    expect(f.u.effects()).toBe(fault === "valid"?1:0);
    const stored=await f.t.pb.collection("checkin_recovery_resets").getOne(claimed.id);
    expect(!!stored.delete_fence_at).toBe(fault === "valid");
    if(fault==="fingerprint")expect(stored.state).toBe("identity_changed");
    if(fault!=="takeover")expect(await f.coordinator.processResets(f.u.source)).toBe(0);
    else expect(await successor!.processResets(f.u.source)).toBe(0);
    expect(f.u.calls).not.toContain("POST");
  } finally {await successor?.close();await f.cleanup();}
},20000);

it("real PB send route binds every target field, lifecycle and current pending reset; concurrent grants have one winner",async()=>{
  const f=await provision();
  try {
    const job=await f.coordinator.claimReset();if(!job)throw new Error("missing claim");
    const runtime=await f.t.pb.collection("checkin_coordinator").getOne("wts2026coord000");
    const body={operation:"machine_reset_fence",owner:runtime.owner,nowMs:Date.now(),job};
    const grant=(value:unknown=body)=>f.t.pb.send("/api/wts/checkin-reset-fence",{method:"POST",body:value,requestKey:null});
    await expect(f.t.operator.client.send("/api/wts/checkin-reset-fence",{method:"POST",body,requestKey:null})).rejects.toMatchObject({status:403});
    for(const field of Object.keys(job) as (keyof typeof job)[]) {
      const value=["workflowId","resetId"].includes(field)?"z".repeat(15):["sourceKey","fingerprint"].includes(field)?"f".repeat(64):"999";
      await expect(grant({...body,job:{...job,[field]:value}})).rejects.toThrow();
    }
    const db=new DatabaseSync(join(f.t.root,"pb_data/data.db"));
    try {
      for(const field of ["closed_at","restore_required","central_deleted_at"]) {
        db.prepare(`UPDATE checkin_lifecycle SET ${field}=?`).run(field==="restore_required"?1:new Date().toISOString());
        await expect(grant()).rejects.toThrow();
        db.prepare(`UPDATE checkin_lifecycle SET ${field}=?`).run(field==="restore_required"?0:"");
      }
      db.prepare("UPDATE checkin_recovery_workflows SET decision='cancelled' WHERE workflow_id=?").run(job.workflowId);
      await expect(grant()).rejects.toThrow();
      db.prepare("UPDATE checkin_recovery_workflows SET decision='reset_pending' WHERE workflow_id=?").run(job.workflowId);
    } finally {db.close();}
    expect((await f.t.pb.collection("checkin_recovery_resets").getOne(job.resetId)).delete_fence_at).toBe("");
    const results=await Promise.allSettled([grant(),grant()]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
    expect((await f.t.pb.collection("checkin_recovery_resets").getOne(job.resetId)).delete_fence_at).not.toBe("");
    await expect(grant()).rejects.toMatchObject({status:409});
    expect(f.u.effects()).toBe(0); // Grant alone is never an upstream effect.
  } finally {await f.cleanup();}
},20000);

it.each(["lost_fence","duplicate_fence","lost_claim","lost_delete","lost_result"] as const)("real PB one-shot reset cannot replay %s",async fault=>{
  const f=await provision();const send=f.t.pb.send.bind(f.t.pb);let fenceBody:unknown;
  try {
    f.t.pb.send=(async(url,options)=>{
      const op=(options?.body as {operation?:string})?.operation;
      if(op === "machine_reset_fence")fenceBody=options!.body;
      const reply=await send(url,options);
      if(op === "machine_reset_fence" && fault === "duplicate_fence")await send(url,options); // second authorization must throw
      if(op === "machine_reset_fence" && fault === "lost_fence" || op === "machine_reset_claim" && fault === "lost_claim" || op === "machine_reset_result" && fault === "lost_result")throw new Error("Synthetic committed response loss");
      return reply;
    }) as typeof f.t.pb.send;
    const processor=fault === "lost_delete"?{reset:async(job:Parameters<typeof f.u.source.reset>[0],beforeDelete:()=>Promise<void>)=>{await f.u.source.reset(job,beforeDelete);throw new Error("Synthetic lost DELETE response");}}:f.u.source;
    await f.coordinator.processResets(processor).catch(()=>undefined);
    f.t.pb.send=send;
    expect(f.u.effects()).toBe(["lost_delete","lost_result"].includes(fault)?1:0);
    expect(await f.coordinator.processResets(f.u.source)).toBe(0);
    const [stored]=await f.t.pb.collection("checkin_recovery_resets").getFullList();
    expect(stored.state).not.toBe("queued");
    if(fault!=="lost_claim") {
      expect(stored.delete_fence_at).not.toBe("");
      await expect(send("/api/wts/checkin-reset-fence",{method:"POST",body:fenceBody,requestKey:null})).rejects.toMatchObject({status:409});
    }
    await f.coordinator.close();await f.coordinator.listen();
    expect(await f.coordinator.processResets(f.u.source)).toBe(0);
  } finally {f.t.pb.send=send;await f.cleanup();}
},20000);


it.each(["open", "closed", "restore_required", "enabled_before_claim"] as const)("compiled coordinator CLI reset producer respects %s lifecycle and stop state", async mode => {
  // The test command builds once before parallel CLI suites begin.
  const compiled = spawnSync(resolve("node_modules/.bin/tsc"), ["-p", "tsconfig.checkin-runtime.json", "--noEmit"], { encoding: "utf8" });
  expect(compiled.status, compiled.stdout + compiled.stderr).toBe(0);
  const f = await provision(); let child: ChildProcess | undefined; let output = "";
  try {
    await f.coordinator.close();
    if (mode === "enabled_before_claim") {
      const system = await f.t.pb.collection("checkin_system").getOne("wts2026system00");
      await f.t.control.adminControl({ operation: "set_system_enabled", operationId: crypto.randomUUID(), expectedVersion: system.version, enabled: true, reason: "configuration" });
    } else if (mode !== "open") {
      const db = new DatabaseSync(join(f.t.root, "pb_data/data.db"));
      try { db.prepare(`UPDATE checkin_lifecycle SET ${mode === "closed" ? "closed_at" : "restore_required"}=?`).run(mode === "closed" ? new Date().toISOString() : 1); } finally { db.close(); }
    }
    const credentials = join(f.t.root, "coordinator-private.json"), admission = join(f.t.root, "upstream-private.json"), config = join(f.t.root, "runtime-private.json"), shim = join(f.t.root, "loopback-only.mjs");
    writeFileSync(credentials, JSON.stringify({ email: "root-checkin@example.test", password: f.t.password }), { mode: 0o600 });
    writeFileSync(admission, JSON.stringify(f.u.config), { mode: 0o600 });
    writeFileSync(config, JSON.stringify({ pocketbaseUrl: f.t.baseUrl, superuserCredentialFile: credentials, admissionCredentialFile: admission, port: 0, heartbeatIntervalMs: 100, pollIntervalMs: 100 }), { mode: 0o600 });
    // Test-only preload changes transport, never production configuration rules.
    writeFileSync(shim, `const real=globalThis.fetch; globalThis.fetch=(input,init)=>{ let url=String(input); if(url.startsWith(${JSON.stringify(f.u.config.apiUrl + "/")})) url=url.replace(${JSON.stringify(f.u.config.apiUrl)},${JSON.stringify(f.u.loopback)}); else if(!url.startsWith(${JSON.stringify(f.t.baseUrl + "/")})) throw new Error("Non-loopback request forbidden"); return real(url,init); };`);
    f.u.pause();
    child = spawn(process.execPath, ["--import", shim, resolve(".output/checkin-runtime/runtime/checkin/cli.js"), "coordinator", config], { env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout!.on("data", chunk => { output += String(chunk); }); child.stderr!.on("data", chunk => { output += String(chunk); });
    const until = async (predicate: () => Promise<boolean>) => { const deadline = Date.now() + 10000; while (!await predicate()) { if (Date.now() > deadline || child!.exitCode !== null) throw new Error("CLI fixture failed: " + output); await new Promise(resolve => setTimeout(resolve, 30)); } };
    await until(async () => output.includes("coordinator_ready"));
    if (mode === "open") {
      await f.u.inspecting;
      const before = (await f.t.pb.collection("checkin_coordinator").getOne("wts2026coord000")).last_seen_at;
      await until(async () => (await f.t.pb.collection("checkin_coordinator").getOne("wts2026coord000")).last_seen_at !== before);
      f.u.release();
      await until(async () => (await f.t.pb.collection("checkin_recovery_resets").getFullList())[0].state === "deleted");
      expect(f.u.effects()).toBe(1);
      expect((await f.t.pb.collection("checkin_recovery_resets").getFullList())[0].delete_fence_at).not.toBe("");
    } else if (mode === "enabled_before_claim") {
      for (let count = 0; count < 3; count++) {
        const seen = (await f.t.pb.collection("checkin_coordinator").getOne("wts2026coord000")).last_seen_at;
        await until(async () => (await f.t.pb.collection("checkin_coordinator").getOne("wts2026coord000")).last_seen_at !== seen);
      }
      expect(child.exitCode).toBeNull();
      expect((await f.t.pb.collection("checkin_recovery_resets").getFullList())[0].state).toBe("queued");
      expect(f.u.effects()).toBe(0);
    } else {
      await until(async () => output.includes("coordinator_reporting_only"));
      expect((await f.t.pb.collection("checkin_recovery_resets").getFullList())[0].state).toBe("queued");
      expect(f.u.effects()).toBe(0);
    }
    expect(output).not.toContain(f.u.config.apiKey);
    expect(f.u.calls).not.toContain("POST");
  } finally {
    f.u.release();
    if (child && child.exitCode === null) { const exited = new Promise(resolve => child!.once("exit", resolve)); child.kill("SIGTERM"); await exited; }
    await f.cleanup();
  }
}, 30000);
