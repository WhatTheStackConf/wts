import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { AgentJournal } from '../.output/checkin-runtime/runtime/checkin/journal.js';
import { loadHostConfiguration } from '../.output/checkin-runtime/runtime/checkin/host-configuration.js';
import { printPayloadHash } from '../.output/checkin-runtime/runtime/checkin/protocol.js';

function fixture(url) {
 const root=realpathSync(mkdtempSync(join(tmpdir(),'wts-host-')));const unique=randomUUID();
 const write=(path,data)=>{writeFileSync(path,typeof data==='string'?data:JSON.stringify(data),{mode:0o600});return path;};
 const configs=[1,2].map(n=>{
  const dir=join(root,`station${n}`);mkdirSync(dir,{mode:0o700});
  const identity={stationId:`station${n}-${unique}`,agentIdentity:`agent${n}-${unique}`,printerIdentity:`printer${n}-${unique}`,journalIdentity:`journal${n}-${unique}`,profileId:`profile${n}`};
  const journalPath=join(dir,'journal.sqlite');AgentJournal.provision(journalPath,identity);
  const config={identity,journalPath,coordinatorUrl:url,agentCredentialFile:write(join(dir,'token'),`wts_agent_${String(n).repeat(64)}`),printerMode:'simulated',pollIntervalMs:100};
  return {config,path:write(join(dir,'agent.json'),config)};
 });
 const manifest=write(join(root,'host.json'),{version:1,stations:configs.map(c=>({configFile:c.path}))});
 return {root,configs,manifest,write,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}

void test('host validates all assignments and rejects shared station/state/credential before startup',()=>{
 const f=fixture('http://127.0.0.1:9999');
 try {
  assert.equal(loadHostConfiguration(f.manifest).length,2);
  f.write(f.configs[1].path,{...f.configs[1].config,agentCredentialFile:f.configs[0].config.agentCredentialFile});
  assert.throws(()=>loadHostConfiguration(f.manifest),{category:'duplicate_assignment'});
  f.write(f.configs[1].path,f.configs[1].config);
  chmodSync(f.manifest,0o644);assert.throws(()=>loadHostConfiguration(f.manifest),{category:'invalid_config'});
 } finally {f.cleanup();}
});

void test('compiled host routes two simulated printers independently and reconciles a lost start without reprinting', {timeout:25000}, async()=>{
 const observed=[];const outcomes=[];const starts=new Map();let f;let child;let lost=true;
 const replies={
  policy:({station,config})=>({edition:'WTS2026',stationId:station,journalIdentity:config.identity.journalIdentity,mode:'active'}),
  cancellations:()=>({cancellations:[]}),
  heartbeat:({station,number})=>({station:{stationId:station,agentId:`agent${number}`,readyForAuthorization:true,operationsEnabled:false,connection:'connected',journal:'healthy',authorizationTtlMs:10000}}),
  work:({station,work})=>({attempts:outcomes.some(o=>o.station===station)?[]:[work]}),
  ack:({work})=>({attemptId:work.attemptId,acknowledged:true}),
  authorize:({station,number,work})=>({attemptId:work.attemptId,stationId:station,agentId:`agent${number}`,payloadHash:work.payloadHash,expiresAt:new Date(Date.now()+9000).toISOString(),stationGeneration:1,systemGeneration:1,coordinatorGeneration:1}),
  start:({station,number,work,req})=>{starts.set(station,(starts.get(station)||0)+1);if(number===1 && lost){lost=false;req.socket.destroy();return;}return {attemptId:work.attemptId,started:true,reportUntil:''};},
  outcome:({station,work,payload})=>{outcomes.push({station,outcome:payload.outcome});return {attemptId:work.attemptId,outcome:payload.outcome};},
 };
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  const {operation,payload}=JSON.parse(body); const station=payload.stationId;
  observed.push({station,operation});
  const config=f.configs.find(c=>c.config.identity.stationId===station).config;
  const number=f.configs.indexOf(f.configs.find(c=>c.config.identity.stationId===station))+1;
  const printPayload={purpose:'initial',text:{name:`Person ${number}`,affiliation:'Fixture'},profile:{config:{printerRef:config.identity.printerIdentity}},rendererVersion:'test',fontVersion:'test'};
  const work={attemptId:`attempt${number}`,profileId:config.identity.profileId,payload:printPayload,payloadHash:printPayloadHash(config.identity.profileId,printPayload)};
  if(!Object.hasOwn(replies,operation))throw new Error(`Unexpected operation ${operation}`);
  const reply=replies[operation]({station,number,config,work,payload,req});
  if(!reply)return;
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(reply));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 f=fixture(`http://127.0.0.1:${server.address().port}`);
 let output='';
 try{
  child=spawn(process.execPath,['.output/checkin-runtime/runtime/checkin/print-host.js','run',f.manifest],{stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);
  const deadline=Date.now()+15000;
  while(outcomes.length<2 && Date.now()<deadline && child.exitCode===null)await new Promise(r=>setTimeout(r,30));
  assert.equal(outcomes.length,2,output);
  assert.deepEqual(outcomes.find(o=>o.station===f.configs[0].config.identity.stationId),{station:f.configs[0].config.identity.stationId,outcome:'output_uncertain'});
  assert.equal(outcomes.find(o=>o.station===f.configs[1].config.identity.stationId).outcome,'protocol_complete');
  assert.equal(starts.get(f.configs[0].config.identity.stationId),1);
  assert.ok(output.includes('agent_reconnecting'),output);
  const duplicate=spawn(process.execPath,['.output/checkin-runtime/runtime/checkin/print-host.js','run',f.manifest],{stdio:['ignore','pipe','pipe']});
  let duplicateOutput='';duplicate.stdout.on('data',c=>duplicateOutput+=c);duplicate.stderr.on('data',c=>duplicateOutput+=c);
  const [duplicateCode]=await once(duplicate,'exit');
  assert.equal(duplicateCode,78,duplicateOutput);assert.ok(duplicateOutput.includes('resource_owned'),duplicateOutput);
  assert.equal(outcomes.length,2);
  const legacy=spawn(process.execPath,['.output/checkin-runtime/runtime/checkin/cli.js','agent',f.configs[0].path],{stdio:['ignore','pipe','pipe']});
  let legacyOutput='';legacy.stderr.on('data',c=>legacyOutput+=c);
  const [legacyCode]=await once(legacy,'exit');
  assert.equal(legacyCode,78,legacyOutput);assert.ok(legacyOutput.includes('resource_owned'),legacyOutput);
  const exit=once(child,'exit');child.kill('SIGTERM');await exit;
  assert.equal(child.exitCode,0,output);
  for(const [i,c] of f.configs.entries()){
   const journal=new AgentJournal(c.config.journalPath,c.config.identity);
   try{assert.equal(journal.get(`attempt${i+1}`).payload.text.name,`Person ${i+1}`);assert.equal(journal.get(`attempt${i+1}`).state,'reported');}finally{journal.close();}
  }
 }finally{if(child?.exitCode===null){child.kill('SIGKILL');await once(child,'exit');}server.closeAllConnections();await new Promise(r=>server.close(r));f.cleanup();}
});
