import { test, expect, login, toolsView, status } from "./checkin-fixtures";
import { arrivalCommand, arrivalPrerequisites, bindArrivalPhone } from "./checkin-arrival-fixture";
import type { CheckinEventCatalogue } from "~/lib/checkin-event-contract";
import { installSyntheticCamera, showSyntheticQr } from "./checkin-camera-fixture";
import type { CheckinArrivalInput } from "~/lib/checkin-arrival-contract";
import { checkinArrivalResultSchema } from "~/lib/checkin-arrival-client";
import type { Page } from "@playwright/test";

test.use({ channel: "chromium", launchOptions: { args: ["--use-fake-device-for-media-stream"] } });
const camera = (page: Page) => page.getByRole("region", { name: "Camera arrival", exact: true });
test("manual QR polls actual bounded worker status from reservation through acceptance and hides denied details", async ({page,db,state,actorPage}) => {
  await login(page,state.users.admin);
  const setup=await arrivalPrerequisites(page,db);
  const phone=await actorPage(state.users.operator);
  const result=phone.getByRole("region",{name:"Arrival result",exact:true});
  const statuses: any[]=[];
  let operationId="";
  phone.on("response",async response=>{
    if(response.url().endsWith("/api/checkin-arrivals") && response.request().postDataJSON()?.operation==="status" && response.ok()) statuses.push(await response.json());
  });
  try {
    await bindArrivalPhone(phone,setup.stations[0].provisionCode,setup.events[0].id);
    await phone.getByLabel("Attendee QR identity",{exact:true}).fill("A-CAM0001");
    const received=phone.waitForResponse(r=>r.url().endsWith("/api/checkin-arrivals") && r.request().postDataJSON()?.operation==="preflight");
    await phone.getByRole("button",{name:"Validate arrival",exact:true}).click();
    const actual=checkinArrivalResultSchema.parse(await (await received).json()); operationId=actual.operationId;
    expect(actual.state).toBe("reserved");
    if (actual.state!=="reserved") throw new Error("Expected a fresh reserved fixture");
    await expect(result.getByText("Arrival reserved",{exact:true})).toBeVisible();
    const owner=(await db.collection("checkin_coordinator").getOne("wts2026coord000")).owner;
    const machine=(operation:string,rest:object={})=>db.send<any>("/api/wts/checkin-arrivals",{method:"POST",requestKey:null,body:{operation,owner,...rest}});
    // Earlier specs intentionally retain unsubmitted arrivals. Release their
    // safe-read claims without fencing/sending; do not assume ours is queue head.
    let {job}=await machine("machine_admission_claim");
    for (let skipped=0; job && job.workflowId!==actual.workflow.id && skipped<100; skipped++) {
      await machine("machine_admission_release",{attemptId:job.attemptId});
      ({job}=await machine("machine_admission_claim"));
    }
    expect(job?.workflowId).toBe(actual.workflow.id);
    await machine("machine_admission_fence",{attemptId:job.attemptId,coordinatorGeneration:job.coordinatorGeneration});
    await expect(result.getByText("Admission pending",{exact:true})).toBeVisible();
    await machine("machine_admission_result",{attemptId:job.attemptId,outcome:{state:"newly_checked_in",fingerprint:"a".repeat(64)}});
    await expect(result.getByText("Name Label queued for the owning station agent.",{exact:true})).toBeVisible();
    expect(statuses.some(s=>s.operationId===operationId && s.result?.state==="admission_pending")).toBe(true);
    expect(statuses.some(s=>s.operationId===operationId && s.result?.state==="accepted")).toBe(true);
    await phone.route("**/api/checkin-arrivals",async route=>{
      if(route.request().postDataJSON()?.operation==="status") return route.fulfill({status:403,contentType:"application/json",body:JSON.stringify({error:"Denied"})});
      await route.continue();
    });
    await expect(result).toContainText("Cannot verify live arrival progress");
    await expect(result.getByText("Ана O’Neill",{exact:true})).toHaveCount(0);
    await expect(phone.getByLabel("Attendee QR identity",{exact:true})).toHaveValue("");
    await phone.unroute("**/api/checkin-arrivals");
    let releaseStatus!:()=>void;
    let receivedStatus!:()=>void;
    const waiting=new Promise<void>(resolve=>{receivedStatus=resolve;});
    const release=new Promise<void>(resolve=>{releaseStatus=resolve;});
    await phone.route("**/api/checkin-arrivals",async route=>{
      if(route.request().postDataJSON()?.operation!=="status") return route.continue();
      const response=await route.fetch(); expect(response.ok()).toBe(true);
      receivedStatus(); await release; await route.fulfill({response});
    });
    await waiting;
    await result.getByRole("button",{name:"New arrival",exact:true}).click();
    const late=phone.waitForResponse(r=>r.url().endsWith("/api/checkin-arrivals") && r.request().postDataJSON()?.operation==="status");
    releaseStatus(); await late;
    await expect(result.getByText("Accepted by Hi.Events",{exact:true})).toHaveCount(0);
    await expect(result.getByText("Ана O’Neill",{exact:true})).toHaveCount(0);
    expect((await db.collection("checkin_arrival_commands").getFullList()).filter(c=>c.operation_id===operationId)).toHaveLength(1);
    expect(await db.collection("checkin_print_attempts").getFullList()).toHaveLength(1);
  } finally {await setup.cleanup();}
});
const held = (page: Page) => page.getByRole("region", { name: "Held camera arrival", exact: true });
async function start(page: Page) {

  await camera(page).getByRole("button", { name: "Start attendee camera", exact: true }).click();
  await expect(camera(page).getByText("Camera scanning. Show one QR at a time.", { exact: true })).toBeVisible();
}

test("camera synthetic media: real permission, decode, immediate hold, repeated frames, exact repeat and reload history", async ({ page, db, state, actorPage }, info) => {
  test.setTimeout(180000);
  await login(page, state.users.admin);
  const setup = await arrivalPrerequisites(page, db);
  const phone = await actorPage(state.users.operator);
  const inputs: CheckinArrivalInput[] = [];
  const errors: string[] = [];
  phone.on("pageerror", (error) => errors.push(error.message));
  phone.on("request", (request) => { if (request.url().endsWith("/api/checkin-arrivals") && request.postDataJSON()?.operation === "preflight") inputs.push(request.postDataJSON().command); });
  try {
    await installSyntheticCamera(phone);
    await phone.context().grantPermissions(["camera"]);
    await bindArrivalPhone(phone, setup.stations[0].provisionCode, setup.events[0].id);
    await phone.setViewportSize({ width: 320, height: 740 });
    await start(phone);
    await showSyntheticQr(phone, "A-CAM0001");
    await expect(held(phone).getByText("Ана O’Neill", { exact: true })).toBeVisible();
    await expect(held(phone)).toBeFocused();
    await expect(camera(phone).getByText("Camera paused — attendee held", { exact: true })).toBeVisible();
    await expect.poll(() => inputs.length).toBe(1);
    await showSyntheticQr(phone, "A-CAM0002");
    // Observe multiple real frame intervals while held; no timer-based decode injection.
    const frameStart = await phone.evaluate(() => (document.querySelector('video[aria-label="attendee camera preview"]') as HTMLVideoElement).currentTime);
    await expect.poll(async () => phone.evaluate(() => (document.querySelector('video[aria-label="attendee camera preview"]') as HTMLVideoElement).currentTime)).toBeGreaterThan(frameStart + 1);
    expect(inputs).toHaveLength(1);
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await camera(phone).screenshot({ path: info.outputPath("camera-held-synthetic-320.png") });
    const stored = await phone.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("wts:camera-held:")));
    expect(stored).toHaveLength(1);
    expect(stored[0][1]).toBe(inputs[0].operationId);
    expect(JSON.stringify(stored)).not.toMatch(/A-CAM|Ана|O’Neill|qrIdentity/);
    await showSyntheticQr(phone, "A-CAM0001");
    await held(phone).getByRole("button", { name: "Park exception and scan unrelated attendee", exact: true }).click();
    await expect(camera(phone).getByText("Camera scanning. Show one QR at a time.", { exact: true })).toBeVisible();
    await expect(phone.getByRole("region", { name: "Last camera result", exact: true })).toContainText("Ана O’Neill");
    await showSyntheticQr(phone, "A-CAM0002");
    await expect.poll(() => inputs.length).toBe(2);
    await expect(held(phone).getByText("Arrival reserved", { exact: true })).toBeVisible();
    await held(phone).getByRole("button", { name: "Park exception and scan unrelated attendee", exact: true }).click();
    await showSyntheticQr(phone, "A-CAM0001");
    await expect.poll(() => inputs.length).toBe(3);
    expect(inputs[2]).toEqual(inputs[0]);
    await expect(held(phone).getByText("Ана O’Neill", { exact: true })).toBeVisible();
    await phone.reload();
    await phone.getByRole("button", { name: "Review held scan", exact: true }).click();
    await expect(held(phone).getByText("Ана O’Neill", { exact: true })).toBeVisible();
    await expect(held(phone)).toContainText("Recovered through station history");
    expect(inputs).toHaveLength(3);
    await expect(camera(phone).getByRole("button", { name: "Start attendee camera", exact: true })).toBeDisabled();
    await camera(phone).screenshot({ path: info.outputPath("camera-reload-synthetic-320.png") });
    expect(errors).toEqual([]);
  } catch (error) {
    await camera(phone).screenshot({ path: info.outputPath("actual-camera-failure.png"), timeout: 3000 }).catch(() => undefined);
    throw error;
  } finally { await setup.cleanup(); }
});

test("camera unreadable held storage blocks both new camera and manual intake", async ({ page, db, state, actorPage }) => {
  await login(page, state.users.admin);
  const setup = await arrivalPrerequisites(page, db);
  const phone = await actorPage(state.users.operator);
  let preflights = 0;
  phone.on("request", request => { if (request.url().endsWith("/api/checkin-arrivals") && request.postDataJSON()?.operation === "preflight") preflights++; });
  try {
    await bindArrivalPhone(phone, setup.stations[0].provisionCode, setup.events[0].id);
    await phone.addInitScript(() => {
      const read = Storage.prototype.getItem;
      Storage.prototype.getItem = function(key: string) {
        if (key.startsWith("wts:camera-held:")) throw new DOMException("Synthetic storage unavailable", "SecurityError");
        return read.call(this, key);
      };
    });
    await phone.reload();
    await phone.getByRole("button", { name: "Review held scan", exact: true }).click();
    await expect(held(phone)).toContainText("held work is unreadable");
    await expect(camera(phone).getByRole("button", { name: "Start attendee camera" })).toBeDisabled();
    await phone.getByLabel("Attendee QR identity", { exact: true }).fill("A-CAM0001");
    await expect.poll(() => phone.getByRole("button", { name: "Validate arrival", exact: true }).evaluate((button: HTMLButtonElement) => {
      if (document.body.innerText.includes("Verify the current station and event before starting new arrival work.")) return "waiting for current context";
      return button.disabled ? "blocked with current context" : "enabled with current context";
    })).toBe("blocked with current context");
    expect(preflights).toBe(0);
  } finally { await setup.cleanup(); }
});

test("camera permission denial and recovery; station QR authority is separate from attendee admission", async ({ page, db, state, actorPage }, info) => {
  test.setTimeout(180000);
  await login(page, state.users.admin);
  const setup = await arrivalPrerequisites(page, db);
  const phone = await actorPage(state.users.handoff);
  const errors: string[] = [];
  phone.on("pageerror", error => errors.push(error.message));
  try {
    await installSyntheticCamera(phone);
    await bindArrivalPhone(phone, setup.stations[0].provisionCode, setup.events[0].id);
    const session = await phone.context().newCDPSession(phone);
    const { targetInfo } = await session.send("Target.getTargetInfo");
    await session.send("Browser.setPermission", { permission: { name: "camera" }, setting: "denied", origin: state.baseURL, browserContextId: targetInfo.browserContextId });
    await camera(phone).getByRole("button", { name: "Start attendee camera", exact: true }).click();
    await expect(camera(phone).getByRole("alert")).toContainText("Camera permission denied");
    await camera(phone).screenshot({ path: info.outputPath("camera-permission-denied.png") });
    await session.send("Browser.setPermission", { permission: { name: "camera" }, setting: "granted", origin: state.baseURL, browserContextId: targetInfo.browserContextId });
    await start(phone);
    await showSyntheticQr(phone, `${state.baseURL}/checkin#provision=${setup.stations[0].provisionCode}`);
    await expect(held(phone)).toContainText("Not an attendee QR");
    await expect(held(phone)).toBeFocused();
    await held(phone).getByRole("button", { name: "Dismiss invalid QR" }).click();
    await camera(phone).getByRole("button", { name: "Stop attendee camera" }).click();
    await expect.poll(() => phone.evaluate(() => (window as unknown as { __wtsSyntheticCamera: { stopped: number } }).__wtsSyntheticCamera.stopped)).toBe(1);
    await toolsView(phone, "Phone");
    const station = phone.getByRole("region", { name: "Station camera", exact: true });
    await station.getByRole("button", { name: "Start scanning", exact: true }).click();
    await expect(station.getByText("Ready for your station QR", { exact: true })).toBeVisible();
    await showSyntheticQr(phone, "A-CAM0001");
    await expect(phone.getByText("Not a station provisioning QR for this site. Attendee QRs cannot bind a phone.", { exact: true })).toBeVisible();
    await phone.getByRole("button", { name: "Dismiss message", exact: true }).click();
    await showSyntheticQr(phone, `${state.baseURL}/checkin#provision=${setup.stations[0].provisionCode}`);
    await expect(phone.getByRole("button", { name: "Confirm station binding", exact: true })).toBeVisible();
    await phone.getByRole("button", { name: "Confirm station binding", exact: true }).click();
    await expect(phone.getByRole("button", { name: "Confirm station binding", exact: true })).toHaveCount(0);
    await expect.poll(async () => (await status(phone)).binding.stationId).toBe(setup.stations[0].stationId);
    expect(errors).toEqual([]);
  } catch (error) {
    await camera(phone).screenshot({ path: info.outputPath("actual-camera-failure.png"), timeout: 3000 }).catch(() => undefined);
    throw error;
  } finally { await setup.cleanup(); }
});


test("camera opaque recovery: phone reload affiliation continuation, history Resume, and context fence", async ({ page, db, state, actorPage }, info) => {
  test.setTimeout(120000);
  await login(page, state.users.admin);
  const setup = await arrivalPrerequisites(page, db);
  const phone = await actorPage(state.users.operator);
  const submissions: object[] = [];
  const errors: string[] = [];
  phone.on("pageerror", error => errors.push(error.message));
  phone.on("request", request => {
    if (request.url().endsWith("/api/checkin-arrivals") && request.postDataJSON()?.operation === "preflight") submissions.push(request.postDataJSON());
    if (request.url().endsWith("/api/checkin-arrival-resume") && request.postDataJSON()?.operation === "resume") submissions.push(request.postDataJSON());
  });
  async function fault(mode: string) {
    const response = await fetch(`${state.upstreamURL}/__test/control`, { method: "POST", headers: { Authorization: `Bearer ${state.upstreamToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ synthetic: true, forbiddenEffects: 0 });
  }
  const reference = () => phone.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("wts:camera-held:")));
  try {
    await installSyntheticCamera(phone);
    await phone.context().grantPermissions(["camera"]);
    await bindArrivalPhone(phone, setup.stations[0].provisionCode, setup.events[0].id);
    await phone.setViewportSize({ width: 320, height: 740 });
    await fault("affiliation_failure");
    await start(phone);
    await showSyntheticQr(phone, "A-CAM0005");
    await expect(held(phone)).toContainText("Affiliation read failed");
    const original = await reference();
    expect(original).toHaveLength(1);
    await phone.reload();
    await expect(phone.getByRole("button", { name: "Recent work", exact: true })).toHaveAttribute("aria-pressed", "true");
    await phone.getByRole("button", { name: "Review held scan", exact: true }).click();
    await expect(held(phone)).toContainText("Affiliation read failed");
    await expect(held(phone).getByRole("button", { name: "Use blank camera affiliation", exact: true })).toBeDisabled();
    await held(phone).getByRole("button", { name: "Reacquire held QR with camera" }).click();
    await start(phone);
    await showSyntheticQr(phone, "A-CAM0005");
    await expect(held(phone)).toContainText("QR reacquired in memory only");
    await expect(held(phone)).toBeFocused();
    await camera(phone).getByRole("button", { name: "Stop attendee camera" }).click();
    const blank = phone.waitForResponse(response => response.url().endsWith("/api/checkin-arrival-resume") && response.request().postDataJSON()?.operation === "resume");
    await held(phone).getByRole("button", { name: "Use blank camera affiliation", exact: true }).click();
    const response = await blank;
    expect(response.status(), await response.text()).toBe(200);
    const outcome = await response.json();
    expect(outcome).toMatchObject({ state: "reserved", workflow: { affiliation: "", eventId: setup.events[0].id } });
    expect(outcome.operationId).not.toBe(original[0][1]);
    await expect(held(phone)).toContainText("Arrival reserved");
    expect(await reference()).toEqual([[original[0][0], outcome.operationId]]);
    expect(JSON.stringify(await reference())).not.toMatch(/A-CAM|qrIdentity|affiliation|Ана/);
    const work = await db.collection("checkin_arrival_workflows").getFullList({ filter: `event_id = "${setup.events[0].id}" && upstream_attendee_id = "925"` });
    expect(work).toHaveLength(1);
    expect(submissions).toHaveLength(2);
    await held(phone).getByRole("button", { name: "Park exception and scan unrelated attendee" }).click();
    await expect(phone.getByRole("region", { name: "Last camera result", exact: true })).toContainText("Arrival reserved");
    expect(await reference()).toEqual([]);
    const history = phone.getByRole("region", { name: "Station arrival work", exact: true });
    await history.getByRole("button", { name: "Refresh arrival work", exact: true }).click();
    expect(outcome.workflow.id).toMatch(/^[a-z0-9]{15}$/);
    await history.getByRole("listitem").filter({ hasText: `Work ${outcome.workflow.id}` }).getByRole("button", { name: "Resume held arrival" }).click();
    await expect(held(phone)).toContainText(outcome.operationId);
    await expect(held(phone)).toContainText("Recovery is read-only");
    expect(await reference()).toEqual([[original[0][0], outcome.operationId]]);
    expect(submissions).toHaveLength(2);
    // Explicitly park existing work, acquire a separate failed-read exception.
    await held(phone).getByRole("button", { name: "Park exception and scan unrelated attendee" }).click();
    await start(phone);
    await showSyntheticQr(phone, "A-CAM0006");
    await expect(held(phone)).toContainText("Affiliation read failed");
    await camera(phone).getByRole("button", { name: "Stop attendee camera" }).click();
    const changedReference = await reference();
    await expect(phone.getByRole("button", { name: "Phone", exact: true })).toBeDisabled();
    // A held camera operation blocks local navigation. An external selection
    // change must still invalidate its original context without losing the hold.
    const catalogue = await arrivalCommand<CheckinEventCatalogue>(phone, "/api/checkin-events", { operation: "catalogue" });
    await arrivalCommand(phone, "/api/checkin-events", { operation: "select", selection: { eventId: setup.events[1].id, eventGeneration: setup.events[1].generation, ...catalogue.fence } });
    await held(phone).getByRole("button", { name: "Refresh held arrival" }).click();
    await expect(held(phone)).toContainText("Recovery blocked: originating context changed");
    await expect(held(phone).getByRole("button", { name: "Use blank camera affiliation", exact: true })).toHaveCount(0);
    await expect(camera(phone).getByRole("button", { name: "Start attendee camera" })).toBeDisabled();
    expect(await reference()).toEqual(changedReference);
    expect(submissions).toHaveLength(3);
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await camera(phone).screenshot({ path: info.outputPath("opaque-recovery-context-blocked-320.png") });
    expect(errors).toEqual([]);
  } finally { await fault("complete"); await setup.cleanup(); }
});
