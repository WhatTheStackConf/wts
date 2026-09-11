import { expect, it } from "vite-plus/test";
import { createCheckinRecoverySource } from "./checkin-recovery-upstream";
import { createCheckinEventSource } from "./checkin-event-source";
const base="https://synthetic.example.invalid/api";
const config={apiUrl:base,apiKey:`e30.${Buffer.from('{"account_id":77}').toString("base64url")}.c3ludGhldGlj`,accountId:"77"};
const target={workflowId:"a".repeat(15),sourceKey:createCheckinEventSource(config).sourceKey,upstreamEventId:"501",upstreamListId:"701",upstreamAttendeeId:"901"};
const product={id:601,event_id:501,title:"Synthetic admission"};
const list={id:701,name:"Synthetic list",short_id:"cil_SYNTHETIC",is_active:true,is_expired:false,products:[product]};
const row={id:901,event_id:501,public_id:"A-ABC1234",product_id:601,order_id:1001};
const checkin={id:1101,attendee_id:901,check_in_list_id:701,order_id:1001,checked_in_at:"2026-09-09T10:00:00Z",short_id:"ci_SYNTHETIC"};
function page(path:string,data:unknown[]){return {data,links:{first:`${base}/${path}?page=1`,last:`${base}/${path}?page=1`,prev:null,next:null},meta:{current_page:1,last_page:1,per_page:25,total:data.length,from:data.length?1:null,to:data.length||null,path:`${base}/${path}`}};}
function attendeePage(data:unknown[]){const p=page("public/check-in-lists/cil_SYNTHETIC/attendees",data);return {...p,links:{...p.links,last:null},meta:{current_page:1,per_page:25,from:data.length?1:null,to:data.length||null,path:p.meta.path}};}
function fixture(data:unknown=attendeePage([{...row,check_in:checkin}]),deletion:Response|Error=new Response(null,{status:204})){
 const calls:{url:string;method:string}[]=[];
 const fetcher:typeof fetch=async(input,init)=>{const url=String(input);calls.push({url,method:init?.method??"GET"});
  if(init?.method==="DELETE"){if(deletion instanceof Error)throw deletion;return deletion;}
  if(url.includes("/check-in-lists?page="))return Response.json(page("events/501/check-in-lists",[list]));
  if(url.endsWith("/questions"))return Response.json({data:[]});
  if(url.includes("/products?page="))return Response.json(page("events/501/products",[product]));
  if(url.endsWith("events/501/attendees/901"))return Response.json({data:row});
  if(url.includes("/attendees?page=")){if(data instanceof Error)throw data;return data instanceof Response?data:Response.json(data);}
  throw new Error("unexpected fixture URL");
 };
 return {calls,adapter:createCheckinRecoverySource(config,fetcher)};
}
it("reads exact original list and distinguishes absent, malformed and unavailable without effects",async()=>{
 for(const [body,state] of [[attendeePage([row]),"absent"],[attendeePage([]),"malformed"],[attendeePage([{...row,check_in:null}]),"malformed"],[attendeePage([{...row,check_in:{...checkin,check_in_list_id:702}}]),"malformed"],[new Error("synthetic disconnect"),"unavailable"]] as const){const f=fixture(body);expect(await f.adapter.reconcile(target)).toEqual({state});expect(f.calls.every(c=>c.method==="GET")).toBe(true);}
 const f=fixture();const result=await f.adapter.reconcile(target);expect(result).toMatchObject({state:"existing",checkinId:"1101"});expect(JSON.stringify(result)).not.toMatch(/ci_SYNTHETIC|cil_SYNTHETIC|A-ABC1234/);
 const bad=fixture();expect(await bad.adapter.reconcile({...target,sourceKey:"wrong"})).toEqual({state:"unavailable"});expect(bad.calls).toEqual([]);
});
it("missing or rejected send authorization never reaches DELETE",async()=>{
 for(const authorize of [undefined,async()=>{throw new Error("Synthetic denied or lost grant");}]){
  const f=fixture();const read=await f.adapter.reconcile(target);if(read.state!=="existing")throw new Error("fixture failed");
  const resetTarget={...target,resetId:"b".repeat(15),checkinId:read.checkinId,fingerprint:read.fingerprint};
  const result=authorize ? await f.adapter.reset(resetTarget,authorize) :
    // @ts-expect-error Deliberately exercise a legacy runtime caller without the required callback.
    await f.adapter.reset(resetTarget);
  expect(result).toBe("uncertain");expect(f.calls.some(c=>c.method==="DELETE")).toBe(false);
 }
});
it("guarded DELETE uses fresh exact check-in capability once, never retries lost/ambiguous response",async()=>{
 for(const response of [new Response(null,{status:204}),new Response(null,{status:409}),new Error("synthetic lost DELETE")]){
  const f=fixture(undefined,response);const read=await f.adapter.reconcile(target);if(read.state!=="existing")throw new Error("fixture failed");
  const result=await f.adapter.reset({...target,resetId:"b".repeat(15),checkinId:read.checkinId,fingerprint:read.fingerprint},async()=>{ expect(f.calls.at(-1)?.url).toContain("/attendees?page="); });
  expect(result).toBe(response instanceof Response&&response.status===204?"deleted":"uncertain");
  expect(f.calls.filter(c=>c.method==="DELETE")).toEqual([{url:`${base}/public/check-in-lists/cil_SYNTHETIC/check-ins/ci_SYNTHETIC`,method:"DELETE"}]);expect(f.calls.some(c=>c.method==="POST")).toBe(false);
 }
 const f=fixture();expect(await f.adapter.reset({...target,resetId:"b".repeat(15),checkinId:"1102",fingerprint:"c".repeat(64)},async()=>{ throw new Error("must not fence changed identity"); })).toBe("identity_changed");expect(f.calls.every(c=>c.method==="GET")).toBe(true);
});
