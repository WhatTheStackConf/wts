import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import PocketBase from 'pocketbase';
import {installCoordinatorAuthRecovery} from '../.output/checkin-runtime/runtime/checkin/coordinator-auth.js';

async function fixture(t, respond){
 const server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const response=await respond(req,body?JSON.parse(body):null);res.writeHead(response.status,{'content-type':'application/json'});res.end(JSON.stringify(response.body??{}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const pb=new PocketBase(`http://127.0.0.1:${server.address().port}`);pb.autoCancellation(false);pb.authStore.save('old-auth');return pb;
}
void test('401 before command execution reauthenticates once and preserves owner/body',async t=>{
 const calls=[];let applied=0;
 const pb=await fixture(t,(req,body)=>{calls.push({auth:req.headers.authorization,body});if(req.headers.authorization!=='fresh-auth')return {status:401};applied++;return {status:200,body:{claimed:0}};});
 let logins=0;installCoordinatorAuthRecovery(pb,async()=>{logins++;pb.authStore.save('fresh-auth');});
 const body={operation:'machine_print_claim',owner:'unchanged-owner'};
 assert.deepEqual(await pb.send('/api/wts/checkin-agents',{method:'POST',body,headers:{Authorization:'stale-explicit-header'},requestKey:null}),{claimed:0});
 assert.equal(logins,1);assert.equal(applied,1);assert.deepEqual(calls,[{auth:'old-auth',body},{auth:'fresh-auth',body}]);
});
void test('concurrent authentication rejections share login without replacing the lease',async t=>{
 let logins=0,applied=0;
 const pb=await fixture(t,req=>{if(req.headers.authorization!=='fresh-auth')return {status:401};applied++;return {status:200};});
 installCoordinatorAuthRecovery(pb,async()=>{logins++;await new Promise(r=>setTimeout(r,25));pb.authStore.save('fresh-auth');});
 await Promise.all(['/api/wts/checkin-agents','/api/wts/checkin-arrivals','/api/wts/checkin-recovery'].map(path=>pb.send(path,{method:'POST',body:{owner:'same-owner'},requestKey:null})));
 assert.equal(logins,1);assert.equal(applied,3);
});
for(const status of [403,409,500,503])await test(`does not replay status ${status}`,async t=>{
 let requests=0,logins=0;const pb=await fixture(t,()=>{requests++;return {status};});
 installCoordinatorAuthRecovery(pb,async()=>{logins++;});
 await assert.rejects(pb.send('/api/wts/checkin-agents',{method:'POST',body:{operation:'machine_start'},requestKey:null}),e=>e.status===status);
 assert.equal(requests,1);assert.equal(logins,0);
});
void test('repeated 401 is bounded and unrelated endpoints never trigger login',async t=>{
 let requests=0,logins=0;const pb=await fixture(t,()=>{requests++;return {status:401};});
 installCoordinatorAuthRecovery(pb,async()=>{logins++;pb.authStore.save('still-rejected');});
 await assert.rejects(pb.send('/api/wts/checkin-agents',{method:'POST',body:{},requestKey:null}),e=>e.status===401);
 assert.equal(requests,2);assert.equal(logins,1);
 await assert.rejects(pb.send('/api/collections/users/records',{requestKey:null}),e=>e.status===401);
 assert.equal(requests,3);assert.equal(logins,1);
});
