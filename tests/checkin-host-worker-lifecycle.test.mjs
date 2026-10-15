import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { AgentJournal } from '../.output/checkin-runtime/runtime/checkin/journal.js';

for (const rejected of [false,true]) await test(`worker lifecycle: clean one-shot completion; rejection=${rejected}`, {timeout:10000},async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'host-worker-')));const token=randomUUID();let child;const heartbeats=[];
 const server=createServer(async(req,res)=>{
  let body='';for await(const c of req)body+=c;
  const {operation,payload}=JSON.parse(body);
  if(rejected && payload.stationId.startsWith('station1')){res.writeHead(403);res.end('{}');return;}
  let result;
  if(operation==='policy')result={edition:'WTS2026',stationId:payload.stationId,journalIdentity:payload.journalIdentity,mode:'active'};
  else if(operation==='cancellations')result={cancellations:[]};
  else if(operation==='heartbeat'){heartbeats.push(payload.stationId);result={station:{stationId:payload.stationId,agentId:'test-agent',readyForAuthorization:false,operationsEnabled:false,connection:'connected',journal:'healthy',authorizationTtlMs:10000}};}
  else throw new Error('Unexpected operation');
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const stations=[1,2].map(n=>{
   const dir=join(root,String(n));mkdirSync(dir,{mode:0o700});
   const identity={stationId:`station${n}-${token}`,agentIdentity:`agent${n}-${token}`,printerIdentity:`printer${n}-${token}`,journalIdentity:`journal${n}-${token}`,profileId:''};
   const journalPath=join(dir,'journal.sqlite');AgentJournal.provision(journalPath,identity);
   const credential=join(dir,'token');writeFileSync(credential,`wts_agent_${String(n).repeat(64)}`,{mode:0o600});
   const configFile=join(dir,'agent.json');writeFileSync(configFile,JSON.stringify({identity,journalPath,coordinatorUrl:`http://127.0.0.1:${server.address().port}`,agentCredentialFile:credential,printerMode:'simulated',once:true}),{mode:0o600});
   return {configFile};
  });
  const manifest=join(root,'host.json');writeFileSync(manifest,JSON.stringify({version:1,stations}),{mode:0o600});
  child=spawn(process.execPath,['.output/checkin-runtime/runtime/checkin/print-host.js','run',manifest],{stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);
  const [code]=await once(child,'exit');
  assert.equal(code,rejected?78:0,output);assert.equal(heartbeats.length,rejected?1:2,output);
  assert.ok(output.includes('worker_finished'),output);
  if(rejected)assert.ok(output.includes('request_rejected'),output);
 }finally{if(child?.exitCode===null){child.kill('SIGKILL');await once(child,'exit');}server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(root,{recursive:true,force:true});}
});
