// Exercise the real Solid client runtime, not the server's inert effects.
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../", import.meta.url));
const moduleId = `${root}tests/__polling-resource-test.ts`;
const fixture = `
import { createRoot, createSignal, flush } from 'solid-js';
import { createCheckinPollingResource } from '~/components/checkin/checkin-polling-resource';
window.runResourceTests = async () => {
 const check = (value, message) => { if (!value) throw Error(message); };
 const settle = async () => { for (let i=0;i<12;i++) { await Promise.resolve(); flush(); } };
 let dispose, setSource, resource, actions;
 const pending = [];
 createRoot(d => {
  dispose=d;
  const [source, setter] = createSignal('a'); setSource=setter;
  [resource, actions] = createCheckinPollingResource(source, key => new Promise((resolve,reject) => pending.push({key,resolve,reject})));
 });
 await settle();
 check(pending.length===1 && resource.loading, 'initial read must verify');
 pending[0].resolve({rows:[{id:'one',name:'first'}],revision:1}); await settle();
 const first=resource();
 const poll=actions.poll(); await settle();
 check(resource()===first && !resource.loading && resource.refreshing, 'quiet poll must retain ready presentation');
 const duplicate=actions.poll(); await settle();
 check(poll===duplicate && pending.length===2, 'overlapping polls must dedupe');
 // A completed mutation calls refetch while an older poll is still pending.
 const explicit=actions.refetch(); await settle();
 check(pending.length===3 && resource.loading, 'explicit post-mutation verification must not reuse pre-mutation poll');
 pending[2].resolve({rows:[{id:'one',name:'first'}],revision:2}); await explicit; await settle();
 check(resource().revision===2 && resource().rows===first.rows, 'fresh data updates; unchanged subtrees retain identity');
 pending[1].resolve({rows:[],revision:0}); await poll; await settle();
 check(resource().revision===2, 'obsolete poll must not overwrite fresh verification');
 const denied=actions.poll().catch(e=>e); await settle();
 pending[3].reject(Error('denied')); await denied; await settle();
 check(resource()===undefined && resource.error?.message==='denied', 'denial must redact ready data');
 const retry=actions.poll().catch(e=>e); await settle();
 check(resource()===undefined && resource.error?.message==='denied', 'retry start must not resurrect denied data');
 pending[4].resolve({rows:[],revision:3}); await retry; await settle();
 check(resource().revision===3 && !resource.error, 'successful retry recovers');
 const oldPoll=actions.poll(); await settle();
 setSource('b'); await settle();
 check(resource()===undefined && resource.loading && pending[6].key==='b', 'changed authority must redact and verify');
 pending[6].resolve({rows:[],revision:4}); await settle();
 pending[5].resolve({rows:[],revision:99}); await oldPoll; await settle();
 check(resource().revision===4, 'obsolete authority must not publish');
 setSource(undefined); await settle();
 check(resource()===undefined && !resource.loading, 'disabled source redacts');
 dispose();
 return 'PASS resource: quiet refresh, deduplication, forced verification, structural sharing, denial/retry, source fencing';
};`;
const server=await createServer({configFile:false,root,plugins:[{name:'polling-resource-test',resolveId(id){if(id==='/__polling-resource-test.ts')return moduleId;},load(id){if(id===moduleId)return fixture;},configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url!=='/__resource-test')return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/', '<!doctype html><script type="module" src="/__polling-resource-test.ts"></script>'));});}}],resolve:{alias:{'~':`${root}src`}},server:{host:'127.0.0.1',port:0},logLevel:'error'});
let browser;
try {
 await server.listen(); browser=await chromium.launch({headless:true}); const page=await browser.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__resource-test`);
 await page.waitForFunction(()=>typeof window.runResourceTests==='function');
 console.log(await page.evaluate(()=>window.runResourceTests())); assert.deepEqual(errors,[]);
} finally {await browser?.close();await server.close();}
