/// <reference path="../pb_data/types.d.ts" />
// Human recovery is transactional; external DELETE belongs only to the coordinator.
routerAdd("POST", "/api/wts/checkin-recovery", (e) => {
 const b=e.requestInfo().body;
 const R=require(__hooks+"/checkin-recovery.js");
 const find=R.find;
 function fail(code,status=400){throw new ApiError(status,"Recovery request rejected.",{code:new ValidationError(code,"Recovery request rejected.")});}
 function set(r,v){for(const k in v)r.set(k,v[k]);}
 function json(r,k){return JSON.parse(r.getString(k)||"null");}
 function canonical(v){if(v===null||typeof v!=="object")return JSON.stringify(v);if(Array.isArray(v))return "["+v.map(canonical).join(",")+"]";return "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}";}
 function safe(v,max,required=false){return typeof v==="string"&&v.length<=max&&(!required||!!v.trim())&&!/[\x00-\x1f\x7f<>@]|:\/\/|www\.|[a-f0-9]{64}|bearer|password|secret|token\s*[:=]|\/dev\/|\b[A-Z]-[A-Z0-9]{7}\b/i.test(v);}
 function id(v){return typeof v==="string"&&/^[a-z0-9]{15}$/.test(v);}
 function upstream(v){return typeof v==="string"&&/^[1-9][0-9]{0,15}$/.test(v)&&Number.isSafeInteger(Number(v));}
 function hash(v){return typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);}
 function day(time){const y=new Date(time).getUTCFullYear(),m=new Date(Date.UTC(y,2,31,1)),o=new Date(Date.UTC(y,9,31,1));m.setUTCDate(31-m.getUTCDay());o.setUTCDate(31-o.getUTCDay());return new Date(time+(time>=m.getTime()&&time<o.getTime()?2:1)*3600000).toISOString().slice(0,10);}
 let result;
 e.app.runInTransaction(app=>{
  const machine=typeof b.operation==="string"&&b.operation.startsWith("machine_");
  const now=machine&&Number.isSafeInteger(b.nowMs)?b.nowMs:Date.now(),iso=new Date(now).toISOString();
  const system=app.findRecordById("checkin_system","wts2026system00");
  const runtime=app.findRecordById("checkin_coordinator","wts2026coord000");
  const actor=machine?null:id(b.actorUserId)&&find(app,"users","id = {:id}",{id:b.actorUserId});
  if(!machine&&(!actor||!actor.getBool("verified")||!["admin","checkin_operator"].includes(actor.getString("role"))))fail("forbidden",403);
  const admin=!!actor&&actor.getString("role")==="admin";
  const binding=hash(b.identityHash)&&find(app,"checkin_bindings","identity_hash = {:hash}",{hash:b.identityHash});
  function own(w){if(!binding||binding.getBool("revoked")||binding.getString("station")!==w.getString("station_id"))fail("forbidden",403);}
  function access(w){if(!admin)own(w);}
  // Same authoritative predicate for projection and mutation; readiness still
  // belongs to the coordinator's later claim/send fences, not this command.
  function retryableAdmission(w){
   if(!binding||binding.getBool("revoked")||binding.getString("station")!==w.getString("station_id")||w.getString("state")!=="not_submitted")return null;
   const life=require(__hooks+"/checkin-lifecycle.js").state(app),r=R.projection(app,w);
   if(life.getString("closed_at")||life.getBool("restore_required")||r&&["denied","cancel_pending","cancelled","reset_pending","reset"].includes(r.getString("decision")))return null;
   const a=find(app,"checkin_arrival_attempts","workflow_id = {:id}",{id:w.id});
   if(!a||a.id!==w.getString("admission_attempt_id")||a.getString("station_id")!==w.getString("station_id")||a.getString("state")!=="pre_send_failed"||a.getInt("pre_send_failures")<3||a.getString("send_boundary_at"))return null;
   return a;
  }
  function snapshot(w){return {workflowId:w.id,sourceKey:w.getString("source_key"),upstreamEventId:w.getString("upstream_event_id"),upstreamListId:w.getString("list_id"),upstreamAttendeeId:w.getString("upstream_attendee_id")};}
  function prints(w){const rows=[];R.each(app,"checkin_print_attempts","workflow_id = {:id}",{id:w.id},p=>{rows.push(p);});return rows;}
  function dto(w,selectedPrints){const r=R.projection(app,w), window=selectedPrints?null:app.findRecordsByFilter("checkin_print_attempts","workflow_id = {:id}","-created,-id",26,0,{id:w.id}), ps=selectedPrints||window.slice(0,25).reverse();return {admissionReadRetryEligible:!!retryableAdmission(w),attemptsTruncated:!!window&&window.length>25,workflowId:w.id,stationId:w.getString("station_id"),eventId:w.getString("event_id"),eventTitle:w.getString("event_title"),admissionState:w.getString("state"),version:r?r.getInt("version"):0,name:r?r.getString("name"):w.getString("name"),affiliation:r?r.getString("affiliation"):w.getString("affiliation"),decision:r?r.getString("decision"):"",fulfillment:r?r.getString("fulfillment"):"",parked:r?r.getBool("parked"):false,completedDay:r?r.getString("completed_day"):w.getString("admission_completed_day"),isolated:R.isolated(app,w.getString("station_id")),profile:json(w,"profile_snapshot"),attempts:ps.map(p=>{const o=find(app,"checkin_recovery_observations","print_id = {:id}",{id:p.id}),c=find(app,"checkin_recovery_cancellations","print_id = {:id}",{id:p.id});return {id:p.id,purpose:p.getString("purpose"),state:p.getString("state"),name:p.getString("name"),affiliation:p.getString("affiliation"),predecessorId:p.getString("predecessor_attempt_id"),observation:o?o.getString("outcome"):null,cancellation:c?c.getString("state"):null};}),reads:admin?app.findRecordsByFilter("checkin_recovery_reads","workflow_id = {:id}","-created,-id",20,0,{id:w.id}).map(r=>({id:r.id,state:r.getString("state"),checkinId:r.getString("checkin_id"),createdAt:r.getString("created")})):[],admissionAttempts:admin?app.findRecordsByFilter("checkin_arrival_attempts","workflow_id = {:id}","created,id",20,0,{id:w.id}).map(a=>({id:a.id,state:a.getString("state"),listId:a.getString("list_id"),attendeeId:a.getString("upstream_attendee_id"),sendBoundaryAt:a.getString("send_boundary_at"),completedAt:a.getString("completed_at"),fingerprint:a.getString("result_fingerprint")})):[],resets:admin?app.findRecordsByFilter("checkin_recovery_resets","workflow_id = {:id}","created,id",20,0,{id:w.id}).map(r=>({id:r.id,state:r.getString("state"),checkinId:r.getString("checkin_id"),sendBoundaryAt:r.getString("send_boundary_at")})):[],operationsEnabled:false};}
  if(machine){
   const seen=Date.parse(runtime.getString("last_seen_at"));
   if(!hash(b.owner)||runtime.getString("owner")!==b.owner||!Number.isFinite(seen)||now<seen||now-seen>=runtime.getInt("heartbeat_timeout_ms"))fail("forbidden",403);
   if(b.operation==="machine_reset_claim"){
    // A crashed/lost-response send is never claimed again, regardless of GET.
    const reset=find(app,"checkin_recovery_resets","state = 'queued'",{});
    if(!reset){result={job:null};return;}
    // Ineligible work is not an ownership failure; retain it without stopping
    // the coordinator's heartbeat, admission and print supervision loops.
    if(system.getBool("enabled")){result={job:null};return;}
    const w=app.findRecordById("checkin_arrival_workflows",reset.getString("workflow_id"));
    set(reset,{state:"possibly_sent",send_boundary_at:iso,coordinator_generation:runtime.getInt("generation")});app.save(reset);
    result={job:{...snapshot(w),resetId:reset.id,checkinId:reset.getString("checkin_id"),fingerprint:reset.getString("fingerprint")}};return;
   }
   if(b.operation==="machine_reset_result"){
    if(!id(b.resetId)||!["deleted","uncertain","identity_changed"].includes(b.outcome))fail("invalid_input");
    const r=app.findRecordById("checkin_recovery_resets",b.resetId);
    if(r.getString("state")===b.outcome){result={resetId:r.id,state:b.outcome};return;}
    if(r.getString("state")!=="possibly_sent"||r.getInt("coordinator_generation")!==runtime.getInt("generation"))fail("conflict",409);
    set(r,{state:b.outcome,completed_at:iso});app.save(r);
    R.projectReset(app,r.getString("workflow_id"),b.outcome,now);
    result={resetId:r.id,state:b.outcome};return;
   }
   fail("invalid_input");
  }
  if(b.operation==="history"){
   if(!admin&&(!binding||binding.getBool("revoked")))fail("forbidden",403);
   const offset=Number.isSafeInteger(b.offset)&&b.offset>=0?b.offset:0,selected=[];let eligible=0,more=false;
   for(let skip=0;!more;skip+=100){const page=app.findRecordsByFilter("checkin_arrival_workflows",admin?"edition = 'WTS2026'":"station_id = {:station}","-created,-id",100,skip,{station:binding?binding.getString("station"):""});for(const w of page){const d=dto(w),last=d.attempts[d.attempts.length-1];const done=["handwritten","printed","protocol_complete","cancelled","denied","reset"].includes(d.fulfillment)||(!d.fulfillment&&last?.state==="completed");if(done&&d.completedDay!==day(now))continue;if(eligible++<offset)continue;if(selected.length===25){more=true;break;}selected.push(d);}if(page.length<100)break;}
   result={items:selected,nextOffset:more?offset+selected.length:null};return;
  }
  if(!id(b.workflowId||b.command?.workflowId))fail("invalid_input");
  const w=app.findRecordById("checkin_arrival_workflows",b.workflowId||b.command.workflowId);access(w);
  if(b.operation==="get"){result=dto(w);return;}
  // Independent bounded history reads; unlimited replacement chain is never truncated in storage.
  if(b.operation==="attempt_history"){
   if(!Number.isSafeInteger(b.offset)||b.offset<0)fail("invalid_input");
   const offset=b.offset;
   const rows=app.findRecordsByFilter("checkin_print_attempts","workflow_id = {:id}","created,id",26,offset,{id:w.id});
   result={workflowId:w.id,items:dto(w,rows.slice(0,25)).attempts,nextOffset:rows.length>25?offset+25:null};return;
  }
  if(b.operation==="reconcile_context"){if(!admin)fail("forbidden",403);result=snapshot(w);return;}
  if(b.operation==="reconcile_record"){
   if(!admin)fail("forbidden",403);
   const o=b.outcome;
   if(!o||!["absent","existing","malformed","unavailable"].includes(o.state)||(o.state==="existing"&&(!upstream(o.checkinId)||!hash(o.fingerprint))))fail("invalid_input");
   const r=new Record(app.findCollectionByNameOrId("checkin_recovery_reads"));set(r,{workflow_id:w.id,actor_id:actor.id,state:o.state,checkin_id:o.state==="existing"?o.checkinId:"",fingerprint:o.state==="existing"?o.fingerprint:""});app.save(r);result={id:r.id,state:o.state,checkinId:r.getString("checkin_id")};return;
  }
  if(b.operation!=="command")fail("invalid_input");
  const c=b.command;
  if(!c||typeof c.operationId!=="string"||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(c.operationId)||!Number.isSafeInteger(c.expectedVersion)||c.expectedVersion<0)fail("invalid_input");
  if(c.operation==="retry_admission_reads"&&(Object.keys(c).length!==4||!["operation","operationId","workflowId","expectedVersion"].every(k=>Object.prototype.hasOwnProperty.call(c,k))))fail("invalid_input");
  const truth=["authorize_initial","deny","cancel","continue","reset"].includes(c.operation);
  if(truth&&!admin)fail("forbidden",403);
  if(!truth)own(w); // Admin label recovery is station-local too. No transfer API.
  const fingerprint=$security.sha256(canonical(c));
  const old=find(app,"checkin_recovery_commands","operation_id = {:id}",{id:c.operationId});
  if(old){if(old.getString("payload_hash")!==fingerprint||old.getString("actor_id")!==actor.id)fail("conflict",409);const receipt=json(old,"result");result={operationId:c.operationId,workflow:dto(w),replayed:true,commandId:old.id,commandVersion:receipt.commandVersion ?? receipt.workflow?.version,commandOutcome:receipt.commandOutcome ?? {decision:receipt.workflow?.decision,fulfillment:receipt.workflow?.fulfillment}};return;}
  let r=R.projection(app,w);
  if((r?r.getInt("version"):0)!==c.expectedVersion)fail("conflict",409);
  if(truth&&(!["incident","erroneous_checkin","duplicate","wrong_attendee"].includes(c.reason)||!safe(c.note,240)))fail("invalid_input");
  const before=dto(w);
  if(!r){r=new Record(app.findCollectionByNameOrId("checkin_recovery_workflows"));set(r,{workflow_id:w.id,name:w.getString("name"),affiliation:w.getString("affiliation"),latest_print_id:w.getString("print_intent_id")});}
  let command=new Record(app.findCollectionByNameOrId("checkin_recovery_commands"));set(command,{operation_id:c.operationId,actor_id:actor.id,workflow_id:w.id,payload_hash:fingerprint,operation:c.operation});app.save(command);command=app.findRecordById("checkin_recovery_commands",command.id);
  const ps=prints(w),last=ps[ps.length-1];
  function currentPrint(){if(!last||last.id!==c.printId)fail("conflict",409);return last;}
  function terminal(p){const a=find(app,"checkin_agent_attempts","print_attempt_id = {:id}",{id:p.id});const auth=a&&find(app,"checkin_agent_authorizations","attempt_id = {:id}",{id:a.id});return {a,auth,settled:!!auth&&["protocol_complete","output_uncertain"].includes(auth.getString("outcome"))};}
  function createPrint(purpose){const p=new Record(app.findCollectionByNameOrId("checkin_print_attempts")),profile=json(w,"profile_snapshot");const payload={purpose,text:{name:r.getString("name"),affiliation:r.getString("affiliation")},profile,rendererVersion:profile.config.rendererVersion,fontVersion:profile.config.fontVersion};set(p,{workflow_id:w.id,station_id:w.getString("station_id"),purpose,state:"queued",profile_id:w.getString("profile_id"),profile_config:json(w,"profile_config"),profile_snapshot:profile,name:r.getString("name"),affiliation:r.getString("affiliation"),payload_hash:$security.sha256(canonical({profileId:w.getString("profile_id"),payload})),predecessor_attempt_id:purpose==="replacement"?last.id:""});app.save(p);r.set("latest_print_id",p.id);r.set("fulfillment","queued");r.set("completed_day","");}
  function cancel(){let pending=false;for(const p of ps){const t=terminal(p);if(t.settled)continue;let q=find(app,"checkin_recovery_cancellations","print_id = {:id}",{id:p.id});if(!q){q=new Record(app.findCollectionByNameOrId("checkin_recovery_cancellations"));set(q,{workflow_id:w.id,print_id:p.id,agent_attempt_id:t.a?t.a.id:"",station_id:w.getString("station_id"),state:t.a?"pending":"acknowledged",acknowledged_at:t.a?"":iso});app.save(q);}if(q.getString("state")!=="acknowledged")pending=true;}return pending;}
  function exactRead(){const read=id(c.readId)&&find(app,"checkin_recovery_reads","id = {:id} && workflow_id = {:workflow}",{id:c.readId,workflow:w.id});if(!read||read.getString("state")!=="existing"||Date.now()-Date.parse(read.getString("created"))>60000)fail("conflict",409);const latest=find(app,"checkin_recovery_reads","workflow_id = {:id}",{id:w.id});if(latest.id!==read.id)fail("conflict",409);return read;}
  if(c.operation==="retry_admission_reads"){
   const attempt=retryableAdmission(w);if(!attempt)fail("conflict",409);
   // Only renew the existing pre-send budget. Never create an attempt, clear a
   // send boundary, change admission truth, or perform upstream/printer I/O.
   set(attempt,{pre_send_failures:0,next_retry_at:""});app.save(attempt);
  }else if(c.operation==="authorize_initial"){
   exactRead();if(!["admission_uncertain","existing_unattributed"].includes(w.getString("state"))||ps.length||["denied","cancelled","reset_pending","reset"].includes(r.getString("decision")))fail("conflict",409);
   r.set("decision","authorized");createPrint("initial");
  }else if(c.operation==="continue"){r.set("decision",r.getString("decision")||"investigating");}
  else if(c.operation==="deny"||c.operation==="cancel"){const pending=cancel();r.set("decision",pending?"cancel_pending":c.operation==="deny"?"denied":"cancelled");r.set("fulfillment",pending?"cancel_pending":c.operation==="deny"?"denied":"cancelled");if(!pending)r.set("completed_day",day(now));}
  else if(c.operation==="correct"){if(!safe(c.name,200,true)||!safe(c.affiliation,200))fail("invalid_input");set(r,{name:c.name,affiliation:c.affiliation});}
  else if(c.operation==="observe"){
   const p=currentPrint(),t=terminal(p);if(!["printed","not_printed"].includes(c.outcome)||!t.settled)fail("conflict",409);
   const prior=find(app,"checkin_recovery_observations","print_id = {:id}",{id:p.id});
   if(prior){if(prior.getString("outcome")!==c.outcome)fail("conflict",409);}else{const o=new Record(app.findCollectionByNameOrId("checkin_recovery_observations"));set(o,{workflow_id:w.id,print_id:p.id,agent_attempt_id:t.a.id,command_id:command.id,outcome:c.outcome});app.save(o);}
   set(r,{fulfillment:c.outcome==="printed"?"printed":"not_printed",completed_day:c.outcome==="printed"?day(now):""});
  }else if(c.operation==="replace"){
   const p=currentPrint(),t=terminal(p);if(!R.permitted(app,w)||R.isolated(app,w.getString("station_id"))||!t.settled||!["completed","uncertain"].includes(p.getString("state"))||(!find(app,"checkin_recovery_observations","print_id = {:id}",{id:p.id})&&p.getString("state")!=="completed"))fail("conflict",409);
   createPrint("replacement");
  }else if(c.operation==="handwrite"){
   if(!R.permitted(app,w)&&r.getString("fulfillment")!=="handwrite_pending")fail("conflict",409);if(["denied","cancel_pending","cancelled","reset_pending","reset"].includes(r.getString("decision")))fail("conflict",409);const pending=cancel();
   if(typeof c.physicallyIsolated!=="boolean")fail("invalid_input");
   if(last&&["dispatched","uncertain"].includes(last.getString("state"))&&!find(app,"checkin_recovery_observations","print_id = {:id}",{id:last.id})&&!c.physicallyIsolated)fail("conflict",409);
   // First request establishes safe fallback. Only a separate operator handwrite
   // command attests the physical label; isolation alone is not that fact.
   const confirming=r.getString("fulfillment")==="handwrite_pending";
   if(c.physicallyIsolated&&!R.isolated(app,w.getString("station_id"))){const isolation=new Record(app.findCollectionByNameOrId("checkin_recovery_isolations"));set(isolation,{station_id:w.getString("station_id"),workflow_id:w.id,command_id:command.id});app.save(isolation);}
   if(confirming&&(!pending||c.physicallyIsolated)){set(r,{fulfillment:"handwritten",completed_day:day(now)});}
   else{set(r,{fulfillment:"handwrite_pending",completed_day:""});}
  }else if(c.operation==="release_isolation"){
   if(c.confirmed!==true)fail("invalid_input");const station=w.getString("station_id");if(find(app,"checkin_recovery_cancellations","station_id = {:id} && state != 'acknowledged'",{id:station}))fail("conflict",409);
   const agent=find(app,"checkin_agents","station = {:id}",{id:station});if(!agent||agent.getBool("quarantined")||now-Date.parse(agent.getString("last_heartbeat_at"))>=15000)fail("conflict",409);
   for(const i of app.findRecordsByFilter("checkin_recovery_isolations","station_id = {:id} && released_at = ''","",1000,0,{id:station})){i.set("released_at",iso);app.save(i);}
  }else if(c.operation==="park"||c.operation==="resume"){r.set("parked",c.operation==="park");}
  else if(c.operation==="reset"){
   const read=exactRead();if(c.confirmed!==true||c.producersQuiescent!==true||c.checkinId!==read.getString("checkin_id")||system.getBool("enabled")||runtime.getString("owner")||!["erroneous_checkin","duplicate","wrong_attendee"].includes(c.reason)||find(app,"checkin_arrival_attempts","workflow_id = {:id} && (state = 'claimed' || state = 'possibly_sent')",{id:w.id})||cancel())fail("conflict",409);
   const reset=new Record(app.findCollectionByNameOrId("checkin_recovery_resets"));set(reset,{workflow_id:w.id,command_id:command.id,read_id:read.id,checkin_id:read.getString("checkin_id"),fingerprint:read.getString("fingerprint"),state:"queued"});app.save(reset);r.set("decision","reset_pending");
  }else fail("invalid_input");
  set(r,{version:c.expectedVersion+1,updated_at:iso});app.save(r);
  const commandOutcome={decision:r.getString("decision"),fulfillment:r.getString("fulfillment"),printId:r.getString("latest_print_id")};
  result={operationId:c.operationId,workflow:dto(w),replayed:false,commandId:command.id,commandVersion:r.getInt("version"),commandOutcome};
  // Immutable bounded receipt: response.workflow is a current projection on replay, not a historical snapshot.
  command.set("result",{operationId:c.operationId,workflowId:w.id,commandId:command.id,commandVersion:r.getInt("version"),operation:c.operation,commandOutcome});app.save(command);
  const audit=new Record(app.findCollectionByNameOrId("checkin_recovery_audit"));set(audit,{command_id:command.id,workflow_id:w.id,station_id:w.getString("station_id"),actor_id:actor.id,actor_role:actor.getString("role"),actor_name:safe(actor.getString("name"),80,true)?actor.getString("name"):"Authorized User",operation:c.operation,reason:truth?c.reason:"",note:truth?c.note:"",before:{admissionReadRetryEligible:before.admissionReadRetryEligible,version:before.version,decision:before.decision,fulfillment:before.fulfillment},after:{admissionReadRetryEligible:result.workflow.admissionReadRetryEligible,version:result.workflow.version,decision:result.workflow.decision,fulfillment:result.workflow.fulfillment}});app.save(audit);
 });return e.json(200,result);
},$apis.requireSuperuserAuth());
onRecordCreateRequest(()=>{throw new ForbiddenError("Use recovery commands.");},"checkin_recovery_workflows","checkin_recovery_commands","checkin_recovery_audit","checkin_recovery_reads","checkin_recovery_observations","checkin_recovery_cancellations","checkin_recovery_isolations","checkin_recovery_resets","checkin_print_attempts");
onRecordUpdateRequest(()=>{throw new ForbiddenError("Use recovery commands.");},"checkin_recovery_workflows","checkin_recovery_commands","checkin_recovery_audit","checkin_recovery_reads","checkin_recovery_observations","checkin_recovery_cancellations","checkin_recovery_isolations","checkin_recovery_resets","checkin_print_attempts");
onRecordUpdate(()=>{throw new ForbiddenError("Recovery evidence is immutable.");},"checkin_recovery_audit","checkin_recovery_reads","checkin_recovery_observations");
onRecordUpdate(e=>{const old=e.record.original();for(const k of ["operation_id","actor_id","workflow_id","payload_hash","operation","created"])if(e.record.getString(k)!==old.getString(k))throw new ForbiddenError("Command identity is immutable.");if(old.getString("result")&&old.getString("result")!=="null"&&old.getString("result")!==e.record.getString("result"))throw new ForbiddenError("Command result is immutable.");e.next();},"checkin_recovery_commands");
onRecordUpdate(e=>{for(const k of ["workflow_id","station_id","purpose","profile_id","profile_config","profile_snapshot","name","affiliation","payload_hash","predecessor_attempt_id","created"])if(e.record.getString(k)!==e.record.original().getString(k))throw new ForbiddenError("Print payload is immutable.");e.next();},"checkin_print_attempts");
onRecordDelete(()=>{throw new ForbiddenError("Recovery history requires explicit lifecycle purge.");},"checkin_recovery_workflows","checkin_recovery_commands","checkin_recovery_audit","checkin_recovery_reads","checkin_recovery_observations","checkin_recovery_cancellations","checkin_recovery_isolations","checkin_recovery_resets","checkin_print_attempts");
