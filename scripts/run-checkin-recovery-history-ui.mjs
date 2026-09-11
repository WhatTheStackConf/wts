// Mounted real component/client, loopback mock transport; no physical effects.
import { createServer } from "vite";
import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { chromium, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({ configFile: false, root, plugins: [tailwindcss(), solid({ ssr: false }), {
 name: "recovery-history-fixture", configureServer(server) { server.middlewares.use(async (req,res,next) => {
  if (new URL(req.url,"http://127.0.0.1").pathname !== "/") return next(); res.setHeader("Content-Type","text/html");
  res.end(await server.transformIndexHtml("/", '<!doctype html><html><body><div id="app"></div><script type="module" src="/tests/checkin-recovery-history-ui-fixture.tsx"></script></body></html>'));
 }); }
}], resolve: { alias: { "~": `${root}src` } }, server: { host:"127.0.0.1", port:0 }, logLevel:"error" });
await server.listen();
const profile={id:"ppppppppppppppp",stationId:"wts2026station1",version:1,approval:"unapproved",config:{rendererVersion:"wts-name-label-v1",fontVersion:"noto-sans-2.008-latin-cyrillic-v1",printerRef:"synthetic-preview",stockRef:"synthetic-50x30-gap",synthetic:true,media:{widthMm:50,heightMm:30,kind:"precut-gap"},raster:{width:600,height:360},printable:{x:12,y:12,width:576,height:336},margins:{top:24,right:18,bottom:24,left:18},offset:{x:0,y:0},direction:0,feed:{mode:"gap",gapDots:24,advanceDots:0},density:3,threshold:160}};
const attempts=Array.from({length:51},(_,i)=>({id:`history${String(i).padStart(8,"0")}`,purpose:i?"replacement":"initial",state:"completed",name:`Private Ж ${i}`,affiliation:"界",predecessorId:i?`history${String(i-1).padStart(8,"0")}`:"",observation:null,cancellation:null}));
const workflow={workflowId:"aaaaaaaaaaaaaaa",stationId:"wts2026station1",eventId:"eeeeeeeeeeeeeee",eventTitle:"Synthetic event",admissionState:"accepted",version:0,name:"Private attendee",affiliation:"界",decision:"",fulfillment:"protocol_complete",parked:false,completedDay:"2026-09-11",isolated:false,profile,admissionReadRetryEligible:false,attempts:attempts.slice(-25),attemptsTruncated:true,reads:[],admissionAttempts:[],resets:[],operationsEnabled:false};
let browser;
try {
 browser=await chromium.launch({headless:true});
 for(const mode of ["pages","401","403","rebind","compact"]) {
  const page=await browser.newPage(); const errors=[];page.on("pageerror",e=>errors.push(e.message));
  let held, denying=false;const commands=[];
  await page.route("**/api/checkin-recovery", async route=>{
   const body=route.request().postDataJSON();
   if(body.operation==="command") {commands.push(body.command);return route.abort("failed");}
   if(body.operation==="get") return denying?route.fulfill({status:403,json:{error:"denied"}}):route.fulfill({json:workflow});
   if(body.operation==="attempt_history") {
    if(denying) return route.fulfill({status:Number(mode)||403,json:{error:"denied"}});
    if(body.offset===25 && mode==="rebind") {held=route;return;}
    const items=attempts.slice(body.offset,body.offset+25);return route.fulfill({json:{workflowId:workflow.workflowId,items,nextOffset:body.offset+items.length<attempts.length?body.offset+items.length:null}});
   }
   return route.fulfill({json:{items:mode==="compact"?[workflow]:[],nextOffset:null}});
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}${mode==="compact"?"/?compact":"/"}`);
  const panel=page.getByRole("region",{name:"Station label recovery",exact:true});
  if(mode==="compact") {
   await expect(panel.getByRole("heading",{name:"Recent work",exact:true})).toBeVisible();
   await expect(panel.getByText("Parking does not make uncertain printing safe",{exact:false})).toHaveCount(0);
   await panel.locator(".recovery-list-row").click();
   await expect(panel.getByLabel("Label-only name",{exact:true})).not.toBeVisible();
   await panel.getByText("Edit label text",{exact:true}).click();
   await expect(panel.getByLabel("Label-only name",{exact:true})).toHaveValue("Private attendee");
   await panel.getByLabel("Label-only name",{exact:true}).fill("Corrected attendee");
   await panel.getByText("Edit label text",{exact:true}).click();
   await panel.getByText("Edit label text",{exact:true}).click();
   await expect(panel.getByLabel("Label-only name",{exact:true})).toHaveValue("Corrected attendee");
   await panel.getByRole("button",{name:"Park this work",exact:true}).click();
   await expect(page.getByLabel("Recovery busy",{exact:true})).toHaveText("busy");
   await expect(panel.getByRole("button",{name:"Back to recent work",exact:true})).toBeDisabled();
   await page.getByRole("button",{name:"Verify unavailable",exact:true}).click();
   await expect(panel.getByText("Private attendee",{exact:true})).toHaveCount(0);
   await expect(panel.getByLabel("Label-only name",{exact:true})).toHaveCount(0);
   const retry=panel.getByRole("button",{name:"Retry exact saved recovery command",exact:true});
   await expect(retry).toBeDisabled();
   await expect(panel.getByLabel("Saved recovery command ID")).toHaveText(commands[0].operationId);
   await page.getByRole("button",{name:"Verify restored",exact:true}).click();
   await panel.getByRole("button",{name:"Reverify recovery access",exact:true}).click();
   await expect(retry).toBeEnabled();await retry.click();
   await expect.poll(()=>commands.length).toBe(2);assert.deepEqual(commands[1],commands[0]);
   assert.deepEqual(errors,[]);console.log("PASS compact recovery progressive disclosure, draft retention, busy fence, redaction and exact retry");await page.close();continue;
  }
  await expect(panel.getByLabel("Label-only name",{exact:true})).toHaveValue("Private attendee");
  await panel.getByText("Immutable label attempt history",{exact:true}).click();await expect(panel).toContainText("Showing only the latest 25 attempts");
  const history=panel.getByRole("region",{name:"Paginated label attempt history"});
  await history.getByRole("button",{name:"Load first attempt page"}).click();await expect(history.locator("li")).toHaveCount(25);
  await expect(history.locator("li").first()).toContainText("Private Ж 0");
  if(mode==="pages") {
   await history.getByRole("button",{name:"Next attempt page"}).click();await expect(history.locator("li").first()).toContainText("Private Ж 25");
   await history.getByRole("button",{name:"Next attempt page"}).click();await expect(history.locator("li")).toHaveCount(1);await expect(history.getByRole("button",{name:"Next attempt page"})).toBeDisabled();
   await history.getByRole("button",{name:"Previous attempt page"}).click();await expect(history.locator("li")).toHaveCount(25);
  } else if(mode==="rebind") {
   await history.getByRole("button",{name:"Next attempt page"}).click();await expect.poll(()=>!!held).toBe(true);
   denying=true;await page.getByRole("button",{name:"Rebind test station"}).click();
   await held.fulfill({json:{workflowId:workflow.workflowId,items:attempts.slice(25,50),nextOffset:50}});
   await expect(panel).not.toContainText("Private attendee");await expect(panel).not.toContainText("Private Ж");await expect(panel.getByLabel("Label-only name",{exact:true})).toHaveCount(0);
  } else {
   await panel.getByRole("button",{name:"Park this work",exact:true}).click();
   const retry=panel.getByRole("button",{name:"Retry exact saved recovery command"});await expect(retry).toBeEnabled();
   denying=true;await history.getByRole("button",{name:"Next attempt page"}).click();
   await expect(panel).not.toContainText("Private attendee");await expect(panel).not.toContainText("Private Ж");await expect(retry).toBeDisabled();
   await expect(panel.getByLabel("Saved recovery command ID")).toHaveText(commands[0].operationId);
  }
  assert.deepEqual(errors,[]);console.log(`PASS mounted recovery history ${mode}`);await page.close();
 }
} finally {await browser?.close();await server.close();}
