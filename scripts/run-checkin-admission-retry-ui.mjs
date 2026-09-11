// Mounted real component/client, loopback mock transport; no physical effects.
import { createServer } from "vite";
import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { chromium, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({ configFile: false, root, plugins: [tailwindcss(), solid({ ssr: false }), {
 name: "admission-retry-fixture", configureServer(server) { server.middlewares.use(async (req,res,next) => {
  if (req.url !== "/") return next(); res.setHeader("Content-Type","text/html");
  res.end(await server.transformIndexHtml("/", '<!doctype html><html><body><div id="app"></div><script type="module" src="/tests/checkin-recovery-history-ui-fixture.tsx"></script></body></html>'));
 }); }
}], resolve: { alias: { "~": `${root}src` } }, server: { host:"127.0.0.1", port:0 }, logLevel:"error" });
await server.listen();
const profile={id:"ppppppppppppppp",stationId:"wts2026station1",version:1,approval:"unapproved",config:{rendererVersion:"wts-name-label-v1",fontVersion:"noto-sans-2.008-latin-cyrillic-v1",printerRef:"synthetic-preview",stockRef:"synthetic-50x30-gap",synthetic:true,media:{widthMm:50,heightMm:30,kind:"precut-gap"},raster:{width:600,height:360},printable:{x:12,y:12,width:576,height:336},margins:{top:24,right:18,bottom:24,left:18},offset:{x:0,y:0},direction:0,feed:{mode:"gap",gapDots:24,advanceDots:0},density:3,threshold:160}};
const attempts=Array.from({length:51},(_,i)=>({id:`history${String(i).padStart(8,"0")}`,purpose:i?"replacement":"initial",state:"completed",name:`Private Ж ${i}`,affiliation:"界",predecessorId:i?`history${String(i-1).padStart(8,"0")}`:"",observation:null,cancellation:null}));
const workflow={workflowId:"aaaaaaaaaaaaaaa",stationId:"wts2026station1",eventId:"eeeeeeeeeeeeeee",eventTitle:"Synthetic event",admissionState:"not_submitted",version:0,name:"Private attendee",affiliation:"界",decision:"",fulfillment:"",parked:false,completedDay:"2026-09-11",isolated:false,profile,admissionReadRetryEligible:true,attempts:[],attemptsTruncated:false,reads:[],admissionAttempts:[],resets:[],operationsEnabled:false};

let browser;
try {
 browser=await chromium.launch({headless:true});
 for(const mode of ["ineligible", "eligible", "denied"]) {
  const page=await browser.newPage(); const errors=[],commands=[],requests=[];page.on("pageerror",e=>errors.push(e.message));
  let current={...workflow, admissionReadRetryEligible:mode!=="ineligible"}, deny=false;
  await page.route("**/api/**", async route=>{
   requests.push(new URL(route.request().url()).pathname);
   assert.equal(requests.at(-1),"/api/checkin-recovery");
   const body=route.request().postDataJSON();
   if(body.operation==="get") return route.fulfill({status:deny?403:200,json:deny?{error:"denied"}:current});
   assert.equal(body.operation,"command");commands.push(body.command);
   assert.equal(body.command.operation,"retry_admission_reads");
   if(commands.length===1) {current={...current,version:1,admissionReadRetryEligible:false};return route.abort("failed");}
   if(commands.length===2) return route.fulfill({status:mode==="denied"?403:409,json:{error:"unknown original result"}});
   return route.fulfill({json:{operationId:body.command.operationId,workflow:current,replayed:true,commandId:"ccccccccccccccc",commandVersion:1,commandOutcome:{decision:"",fulfillment:"",printId:""}}});
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  const panel=page.getByRole("region",{name:"Station label recovery",exact:true});
  await expect(panel.getByLabel("Label-only name",{exact:true})).toHaveValue("Private attendee");
  const button=panel.getByRole("button",{name:"Retry admission safe reads",exact:true});
  if(mode==="ineligible") {await expect(button).toHaveCount(0);assert.equal(commands.length,0);}
  else {
   await expect(button).toBeDisabled();
   const confirmation=panel.getByRole("checkbox",{name:/I confirm a new bounded admission safe-read retry/});
   await confirmation.check();await expect(button).toBeEnabled();await button.click();
   const retry=panel.getByRole("button",{name:"Retry exact saved recovery command"});
   await expect(retry).toBeEnabled();await expect(button).toBeDisabled();
   const saved=panel.getByLabel("Saved recovery command ID");await expect(saved).toHaveText(commands[0].operationId);
   assert.match(commands[0].operationId,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
   assert.deepEqual(Object.keys(commands[0]).sort(),["expectedVersion","operation","operationId","workflowId"]);
   assert.equal(commands[0].expectedVersion,0);
   await retry.click();await expect(saved).toHaveText(commands[0].operationId);
   if(mode==="denied") {
    await expect(retry).toBeDisabled();await expect(button).toHaveCount(0);
    await expect(panel).not.toContainText("Private attendee");
    await panel.getByRole("button",{name:"Reverify recovery access"}).click();await expect(retry).toBeEnabled();
   } else {await expect(retry).toBeEnabled();}
   await panel.getByRole("button",{name:"Refresh selected evidence"}).isEnabled().then(async enabled=>{if(enabled)await panel.getByRole("button",{name:"Refresh selected evidence"}).click();});
   await retry.click();await expect(saved).toHaveCount(0);await expect(button).toHaveCount(0);
   assert.equal(commands.length,3);for(const c of commands)assert.deepEqual(c,commands[0]);
   // A later independently exhausted budget requires fresh confirmation and UUID.
   current={...current,admissionReadRetryEligible:true};
   await panel.getByRole("button",{name:"Refresh selected evidence"}).click();
   await expect(button).toBeDisabled();await expect(confirmation).not.toBeChecked();
   await confirmation.check();await button.click();await expect.poll(()=>commands.length).toBe(4);
   assert.notEqual(commands[3].operationId,commands[0].operationId);assert.equal(commands[3].expectedVersion,1);
  }
  assert.deepEqual(errors,[]);console.log(`PASS mounted admission retry ${mode}`);await page.close();
 }
} finally {await browser?.close();await server.close();}
