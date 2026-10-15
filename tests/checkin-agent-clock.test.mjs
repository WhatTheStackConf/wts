import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AgentJournal} from '../.output/checkin-runtime/runtime/checkin/journal.js';
import {AgentRuntime,HttpAgentTransport} from '../.output/checkin-runtime/runtime/checkin/agent.js';

function setup(t,{expiry=10500,elapsed=50,rollback=false}={}){
 const root=mkdtempSync(join(tmpdir(),'wts-clock-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const identity={stationId:'wts2026station1',agentIdentity:'clock-agent',printerIdentity:'clock-printer',journalIdentity:'clock-journal',profileId:'clock-profile'};
 const path=join(root,'journal.sqlite');AgentJournal.provision(path,identity);const journal=new AgentJournal(path,identity);t.after(()=>journal.close());
 const base=Date.parse('2026-09-17T12:00:00.000Z');let clock=base+250,mono=0,starts=0;
 const work={attemptId:'clock-attempt',profileId:identity.profileId,payloadHash:'a'.repeat(64)};
 const transport=new HttpAgentTransport('http://127.0.0.1:9999','wts_agent_'+'a'.repeat(64),{fetch:async(_url,options)=>{
  const {operation}=JSON.parse(options.body);
  if(operation==='authorize'){
   clock+=rollback?-1:elapsed;mono+=elapsed;
   return new Response(JSON.stringify({attemptId:work.attemptId,stationId:identity.stationId,agentId:'clock-agent',payloadHash:work.payloadHash,expiresAt:new Date(base+expiry).toISOString(),stationGeneration:1,systemGeneration:1,coordinatorGeneration:1}),{headers:{'content-type':'application/json','date':new Date(base+500).toUTCString()}});
  }
  if(operation==='start'){starts++;return new Response(JSON.stringify({attemptId:work.attemptId,started:true,reportUntil:''}),{headers:{'content-type':'application/json'}});}
  throw new Error('Unexpected operation');
 }});
 const agent=new AgentRuntime(identity,journal,transport,{now:()=>clock,monotonic:()=>mono});
 return {agent,journal,work,setTime:(wall,monotonic)=>{clock=base+wall;mono=monotonic;},starts:()=>starts};
}
void test('small client/server clock skew accepts a fresh grant but uses a conservative monotonic deadline',async t=>{
 const f=setup(t);await f.agent.authorize(f.work);assert.equal(f.journal.get(f.work.attemptId).state,'authorized');
 // HTTP Date is second precision: use its upper bound and subtract the entire
 // request duration, rather than extending the server grant for clock skew.
 f.setTime(9750,9500);
 await assert.rejects(f.agent.start(f.work.attemptId),{category:'authorization_expired'});assert.equal(f.starts(),0);
});
void test('a fresh skewed grant can start before that conservative deadline',async t=>{
 const f=setup(t);await f.agent.authorize(f.work);await f.agent.start(f.work.attemptId);assert.equal(f.starts(),1);
});
for(const options of [{expiry:1000},{expiry:12000},{elapsed:9500},{rollback:true}])await test(`reject unsafe clock/grant evidence ${JSON.stringify(options)}`,async t=>{
 const f=setup(t,options);await assert.rejects(f.agent.authorize(f.work),{category:'authorization_expired'});assert.equal(f.starts(),0);
});
