import { test, expect, login } from "./checkin-fixtures";
import { arrivalPrerequisites } from "./checkin-arrival-fixture";
import { installSyntheticCamera, showSyntheticQr } from "./checkin-camera-fixture";
import { checkinArrivalResultSchema } from "~/lib/checkin-arrival-client";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

test.use({ channel: "chromium", launchOptions: { args: ["--use-fake-device-for-media-stream"] } });
declare global { interface Window { __uxBeeps: number; __uxVibrations: number; } }

test("primary scanner keeps login and operator role boundaries", async ({ page, state }) => {
  await page.goto("/checkin");
  await expect(page).toHaveURL(/\/login(?:[?#]|$)/);
  await login(page, state.users.ordinary);
  await page.goto("/checkin");
  await expect(page).not.toHaveURL(/\/checkin(?:[?#]|$)/);
  await expect(page.getByRole("button", { name: "Start scanning", exact: true })).toHaveCount(0);
});

test("scanner-first phone flow: no document scroll, capture feedback, stable refresh and held result", async ({ page, actorPage, db, state }, info) => {
  test.setTimeout(90000);
  await login(page, state.users.admin);
  const setup = await arrivalPrerequisites(page, db);
  const phone = await actorPage(state.users.operator);
  const initialPrints = (await db.collection("checkin_print_attempts").getList(1, 1)).totalItems;
  try {
    await phone.addInitScript(() => {
      window.__uxBeeps = 0; window.__uxVibrations = 0;
      if (window.AudioContext) {
        const create = AudioContext.prototype.createOscillator;
        AudioContext.prototype.createOscillator = function () { window.__uxBeeps++; return create.call(this); };
      }
      Object.defineProperty(navigator, "vibrate", { configurable: true, value: () => { window.__uxVibrations++; return true; } });
    });
    await phone.setViewportSize({ width: 390, height: 844 });
    await installSyntheticCamera(phone);
    await phone.context().grantPermissions(["camera"]);
    await phone.goto(`/checkin#provision=${setup.stations[0].provisionCode}`);
    await expect(phone.getByRole("heading", { name: "Pair your station" })).toBeVisible();
    await phone.getByRole("button", { name: "Review station", exact: true }).click();
    await phone.getByRole("button", { name: "Confirm station", exact: true }).click();
    await expect(phone.getByRole("heading", { name: "Which event?" })).toBeVisible();
    await phone.getByLabel("Event", { exact: true }).selectOption(setup.events[0].id);
    await phone.getByRole("button", { name: "Use event", exact: true }).click();
    await expect(phone.getByRole("button", { name: "Start scanning", exact: true })).toBeEnabled();
    await phone.getByRole("button", { name: "Find attendee", exact: true }).click();
    await expect(phone.getByLabel("Attendee name or email", { exact: true })).toBeVisible();
    await phone.getByRole("button", { name: "Back to scanner", exact: true }).click();
    await expect(phone.getByRole("button", { name: "Start scanning", exact: true })).toBeEnabled();
    await expect(phone.getByText("Station provisioning code", { exact: true })).toHaveCount(0);
    await expect(phone.getByRole("heading", { name: "Station label recovery" })).toHaveCount(0);
    for (const size of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
      await phone.setViewportSize(size);
      expect(await phone.evaluate(() => ({ x: document.documentElement.scrollWidth <= innerWidth, y: document.documentElement.scrollHeight <= innerHeight + 1 }))).toEqual({ x: true, y: true });
    }
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.getByRole("button", { name: "Start scanning", exact: true }).click();
    await expect(phone.locator("video").first()).toBeVisible();
    // Slow ordinary status reads while the camera is running. The old page
    // moved hundreds of pixels here; new acquisition must retain its surface.
    await phone.route("**/api/checkin", async route => {
      if (route.request().postDataJSON()?.operation !== "status") return route.continue();
      const response = await route.fetch(); await new Promise(resolve => setTimeout(resolve, 300)); await route.fulfill({ response });
    });
    const geometry = await phone.evaluate(async () => {
      const result: { height: number; y: number; video: boolean }[] = [];
      const end = performance.now() + 6200;
      await new Promise<void>(resolve => { const sample = () => { const v = document.querySelector("video"); result.push({ height: document.documentElement.scrollHeight, y: scrollY, video: !!v?.srcObject && !v.paused }); if (performance.now() < end) requestAnimationFrame(sample); else resolve(); }; sample(); });
      return result;
    });
    expect(Math.max(...geometry.map(v => v.height)) - Math.min(...geometry.map(v => v.height))).toBeLessThanOrEqual(1);
    expect(geometry.every(v => v.y === 0 && v.video)).toBe(true);
    const submitted = phone.waitForResponse(r => r.url().endsWith("/api/checkin-arrivals") && r.request().postDataJSON()?.operation === "preflight");
    await showSyntheticQr(phone, "A-UXS0001");
    const outcome = checkinArrivalResultSchema.parse(await (await submitted).json());
    expect(outcome.state).toBe("reserved");
    if (outcome.state !== "reserved") throw new Error("Expected a fresh test attendee");
    await expect(phone.getByText("Јана Scanner UX", { exact: true })).toBeVisible();
    await expect.poll(() => phone.evaluate(() => window.__uxBeeps)).toBeGreaterThan(0);
    await expect.poll(() => phone.evaluate(() => window.__uxVibrations)).toBeGreaterThan(0);
    const cues = await phone.evaluate(() => ({ beeps: window.__uxBeeps, vibrations: window.__uxVibrations }));
    const videoTime = await phone.locator("video").first().evaluate((v: HTMLVideoElement) => v.currentTime);
    await expect.poll(() => phone.locator("video").first().evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(videoTime + 1);
    expect(await phone.evaluate(() => ({ beeps: window.__uxBeeps, vibrations: window.__uxVibrations }))).toEqual(cues);
    expect(await phone.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
    await phone.screenshot({ path: info.outputPath("scanner-captured-390.png"), fullPage: true });
    await phone.getByRole("button", { name: "Tools", exact: true }).click();
    await expect(phone.getByRole("dialog", { name: "Station tools" })).toBeVisible();
    await expect(phone.getByRole("link", { name: "History & recovery" })).toHaveAttribute("href", "/checkin-tools");
    await phone.getByRole("button", { name: "Close", exact: true }).click();
    await expect(phone.getByText("Јана Scanner UX", { exact: true })).toBeVisible();
    expect(await db.collection("checkin_print_attempts").getList(1, 1)).toMatchObject({ totalItems: initialPrints });
    // Actual admission hooks, explicitly simulated upstream success and print
    // completion. This validates the UI, not physical output.
    const owner = (await db.collection("checkin_coordinator").getOne("wts2026coord000")).owner;
    const machine = (operation: string, rest: object = {}) => db.send<any>("/api/wts/checkin-arrivals", { method: "POST", requestKey: null, body: { operation, owner, ...rest } });
    let { job } = await machine("machine_admission_claim");
    for (let i = 0; job && job.workflowId !== outcome.workflow.id && i < 100; i++) {
      await machine("machine_admission_release", { attemptId: job.attemptId }); ({ job } = await machine("machine_admission_claim"));
    }
    expect(job?.workflowId).toBe(outcome.workflow.id);
    await machine("machine_admission_fence", { attemptId: job.attemptId, coordinatorGeneration: job.coordinatorGeneration });
    await machine("machine_admission_result", { attemptId: job.attemptId, outcome: { state: "newly_checked_in", fingerprint: "f".repeat(64) } });
    await expect(phone.getByText("Label queued…", { exact: true })).toBeVisible();
    const print = await db.collection("checkin_print_attempts").getFirstListItem(db.filter("workflow_id = {:id}", { id: outcome.workflow.id }));
    // Printer completion is fixture state, not an operator API capability.
    // The real API correctly forbids fabricating this transition.
    const fixtureDB = new DatabaseSync(join(state.root, "pb_data", "data.db"));
    try { fixtureDB.prepare("UPDATE checkin_print_attempts SET state='completed', fulfillment_completed_at=? WHERE id=?").run(new Date().toISOString(), print.id); }
    finally { fixtureDB.close(); }
    await expect(phone.getByRole("heading", { name: "Done", exact: true })).toBeVisible();
    await expect.poll(() => phone.evaluate(() => window.__uxBeeps)).toBe(cues.beeps + 2);
    await expect.poll(() => phone.evaluate(() => window.__uxVibrations)).toBe(cues.vibrations + 1);
    await phone.screenshot({ path: info.outputPath("scanner-done-390.png"), fullPage: true });
    await phone.setViewportSize({ width: 320, height: 568 });
    expect(await phone.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
    await expect(phone.getByRole("button", { name: "Scan next attendee" })).toBeInViewport();
    await phone.screenshot({ path: info.outputPath("scanner-done-320.png"), fullPage: true });
    const remains = await phone.evaluate(async () => { const samples: { name: string | null; visible: boolean; y: number; title: string | null }[] = []; const until = performance.now() + 6000; await new Promise<void>(resolve => { function tick() { const name = document.querySelector<HTMLElement>(".checkin-result-name"); samples.push({ name: name?.textContent ?? null, visible: !!name?.offsetParent, y: scrollY, title: document.querySelector(".checkin-result-title")?.textContent ?? null }); if (performance.now() < until) requestAnimationFrame(tick); else resolve(); } tick(); }); return samples; });
    const badFrames = remains.filter(frame => frame.name !== "Јана Scanner UX" || !frame.visible || frame.y !== 0);
    expect(badFrames.slice(0, 3)).toEqual([]);
    await showSyntheticQr(phone, null);
    await phone.getByRole("button", { name: "Scan next attendee" }).click();
    await expect(phone.locator("video").first()).toBeVisible();
    const clearFrom = await phone.locator("video").first().evaluate((video: HTMLVideoElement) => video.currentTime);
    // The real decoder must see the required clear frames before the same
    // ticket returns; merely changing a hidden canvas while held is not enough.
    await expect.poll(() => phone.locator("video").first().evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(clearFrom + 1);
    const replay = phone.waitForResponse(r => r.url().endsWith("/api/checkin-arrivals") && r.request().postDataJSON()?.operation === "preflight");
    await showSyntheticQr(phone, "A-UXS0001");
    expect(await (await replay).json()).toMatchObject({ operationId: outcome.operationId, replayed: true });
    await expect(phone.getByRole("heading", { name: "Done", exact: true })).toBeVisible();
    expect((await db.collection("checkin_print_attempts").getList(1, 1)).totalItems).toBe(initialPrints + 1);
    await phone.unroute("**/api/checkin");
    await phone.route("**/api/checkin", async route => route.request().postDataJSON()?.operation === "status" ? route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Synthetic denial" }) }) : route.continue());
    await expect(phone.getByText("Јана Scanner UX", { exact: true })).toHaveCount(0);
    expect(await phone.evaluate(() => !!localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith("wts:camera-held:"))!))).toBe(true);
  } finally { await setup.cleanup(); }
});
