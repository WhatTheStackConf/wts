import { test, expect, login } from "./checkin-fixtures";
import { arrivalPrerequisites } from "./checkin-arrival-fixture";
import { installSyntheticCamera, showSyntheticQr } from "./checkin-camera-fixture";

test.use({ channel: "chromium", launchOptions: { args: ["--use-fake-device-for-media-stream"] } });

test("failed preflight stays visibly held across status and readiness polls", async ({ page, db, state, actorPage }, info) => {
  test.setTimeout(90000);
  await login(page, state.users.admin);
  const setup = await arrivalPrerequisites(page, db);
  const phone = await actorPage(state.users.operator);
  let command: { operationId: string; context: object } | undefined;
  const counts = { preflight: 0, status: 0, resume: 0, writes: 0, authority: 0, readiness: 0 };
  try {
    await installSyntheticCamera(phone);
    await phone.addInitScript(() => {
      Object.assign(window, { __failedCues: { audio: 0, vibration: 0 } });
      const cues = (window as any).__failedCues;
      const create = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function () { cues.audio++; return create.call(this); };
      Object.defineProperty(navigator, "vibrate", { configurable: true, value: () => { cues.vibration++; return true; } });
    });
    await phone.context().grantPermissions(["camera"]);
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.goto(`/checkin#provision=${setup.stations[0].provisionCode}`);
    await phone.getByRole("button", { name: "Review station", exact: true }).click();
    await phone.getByRole("button", { name: "Confirm station", exact: true }).click();
    await phone.getByLabel("Event", { exact: true }).selectOption(setup.events[0].id);
    await phone.getByRole("button", { name: "Use event", exact: true }).click();
    // Explicit UI-only failure fixture; real login, authority, readiness and QR decoder.
    await phone.route("**/api/checkin-arrivals", async route => {
      const body = route.request().postDataJSON();
      if (body.operation === "preflight") {
        counts.preflight++; command = body.command;
        return route.fulfill({ json: { state: "dependency_unavailable", operationId: command!.operationId, replayed: false, operationsEnabled: false } });
      }
      if (body.operation === "status" && command) {
        counts.status++; expect(body.operationId).toBe(command.operationId);
        await new Promise(resolve => setTimeout(resolve, 180));
        return route.fulfill({ json: { operationId: command.operationId, result: { state: "dependency_unavailable" }, operationsEnabled: false } });
      }
      return route.continue();
    });
    await phone.route("**/api/checkin-arrival-resume", async route => {
      const body = route.request().postDataJSON();
      if (body.operation !== "get") { counts.writes++; return route.abort(); }
      counts.resume++; expect(body.operationId).toBe(command!.operationId);
      await new Promise(resolve => setTimeout(resolve, 180));
      return route.fulfill({ json: { operationId: command!.operationId, context: command!.context, status: "final", state: "dependency_unavailable", affiliationChoice: "fetch", recovery: "available", actions: ["retry"], operationsEnabled: false } });
    });
    for (const endpoint of ["checkin", "checkin-agents"]) await phone.route(`**/api/${endpoint}`, async route => {
      if (route.request().postDataJSON()?.operation !== "status") return route.continue();
      if (endpoint === "checkin") counts.authority++; else counts.readiness++;
      const response = await route.fetch();
      await new Promise(resolve => setTimeout(resolve, 300));
      return route.fulfill({ response });
    });
    await phone.getByRole("button", { name: "Start scanning", exact: true }).click();
    await expect(phone.locator("video").first()).toBeVisible();
    await showSyntheticQr(phone, "A-UXS0001");
    await expect(phone.getByRole("heading", { name: "Check unavailable", exact: true })).toBeVisible();
    await expect(phone.getByRole("button", { name: "Retry check", exact: true })).toBeEnabled();
    const before = { ...counts };
    // Exercise the parent scanner's focus-triggered event verification too.
    await phone.route("**/api/checkin-events", async route => {
      if (route.request().postDataJSON()?.operation !== "catalogue") return route.continue();
      const response = await route.fetch();
      await new Promise(resolve => setTimeout(resolve, 300));
      return route.fulfill({ response });
    });
    const observation = await phone.evaluate(async () => {
      const focusPoll = window.setInterval(() => window.dispatchEvent(new Event("focus")), 5000);
      const w = window as any;
      const video = document.querySelector("video")!;
      const initial = { cues: { ...w.__failedCues }, requests: w.__wtsSyntheticCamera.requests, stopped: w.__wtsSyntheticCamera.stopped, time: video.currentTime, held: Object.entries(localStorage).filter(([key]) => key.startsWith("wts:camera-held:")) };
      const bad: object[] = [];
      const until = performance.now() + 16200;
      await new Promise<void>(resolve => {
        const frame = () => {
          const title = document.querySelector<HTMLElement>(".checkin-result-title");
          const retry = Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Retry check");
          if (title?.textContent !== "Check unavailable" || !title.offsetParent || !retry?.offsetParent || video !== document.querySelector("video") || video.paused || !video.srcObject) {
            if (bad.length < 10) bad.push({ title: title?.textContent, visible: !!title?.offsetParent, retry: !!retry?.offsetParent, paused: video.paused });
          }
          if (performance.now() < until) requestAnimationFrame(frame); else resolve();
        }; frame();
      });
      window.clearInterval(focusPoll);
      return { initial, bad, final: { cues: { ...w.__failedCues }, requests: w.__wtsSyntheticCamera.requests, stopped: w.__wtsSyntheticCamera.stopped, time: video.currentTime, held: Object.entries(localStorage).filter(([key]) => key.startsWith("wts:camera-held:")) } };
    });
    await info.attach("failed-preflight-observation", { body: JSON.stringify({ counts, before, observation }), contentType: "application/json" });
    expect(counts.status - before.status).toBeGreaterThanOrEqual(3);
    expect(counts.resume - before.resume).toBeGreaterThanOrEqual(3);
    expect(counts.authority - before.authority).toBeGreaterThanOrEqual(3);
    expect(counts.readiness - before.readiness).toBeGreaterThanOrEqual(3);
    expect(counts.preflight).toBe(1); expect(counts.writes).toBe(0);
    expect(observation.final.time).toBeGreaterThan(observation.initial.time + 10);
    expect({ ...observation.final, time: 0 }).toEqual({ ...observation.initial, time: 0 });
    expect(observation.initial.held).toHaveLength(1);
    expect(observation.initial.held[0][1]).toBe(command!.operationId);
    expect(observation.bad).toEqual([]);
    // Identical polls stay stable; actual authority denial must still hide the
    // result and disable recovery without deleting the opaque held reference.
    await phone.unroute("**/api/checkin");
    await phone.route("**/api/checkin", route => route.request().postDataJSON()?.operation === "status"
      ? route.fulfill({ status: 403, json: { error: "Synthetic authority denial" } }) : route.continue());
    await expect(phone.getByRole("heading", { name: "Check unavailable", exact: true })).not.toBeVisible();
    await expect(phone.getByRole("button", { name: "Retry check", exact: true })).not.toBeVisible();
    expect(await phone.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("wts:camera-held:")))).toEqual(observation.initial.held);
    expect(counts.preflight).toBe(1); expect(counts.writes).toBe(0);
  } finally { await setup.cleanup(); }
});

test("Tools URL variants keep operational headers and exclude marketing scripts", async ({ page }) => {
  for (const path of ["/checkin-tools", "/checkin-tools/", "/CHECKIN-TOOLS", "/CHECKIN/"]) {
    const response = await page.request.get(path);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect(response.headers()["content-security-policy"]).toContain("connect-src 'self'");
    expect(await response.text()).not.toMatch(/googletagmanager\.com|google-analytics\.com|umami\.foundry\.mk|dataset\.websiteId|connect\.facebook\.net|facebook\.com\/tr|fbq\(/);
  }
});

test("station QR recovery, lost event selection and lookup rejection stay actionable", async ({ page, db, state, actorPage }, info) => {
  test.setTimeout(90000);
  await login(page, state.users.admin);
  const setup = await arrivalPrerequisites(page, db);
  const phone = await actorPage(state.users.operator);
  try {
    await installSyntheticCamera(phone); await phone.context().grantPermissions(["camera"]);
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.goto("/checkin");
    await phone.getByRole("button", { name: "Start scanning", exact: true }).click();
    await expect(phone.getByText("Ready for your station QR", { exact: true })).toBeVisible();
    await showSyntheticQr(phone, "A-UXS0001");
    await expect(phone.getByRole("alert")).toContainText("not a station QR");
    await showSyntheticQr(phone, state.baseURL + "/checkin#provision=" + setup.stations[0].provisionCode);
    await expect(phone.getByRole("button", { name: "Confirm station", exact: true })).toBeVisible();
    await phone.getByRole("button", { name: "Scan a different station", exact: true }).click();
    await expect(phone.getByRole("button", { name: "Start scanning", exact: true })).toBeVisible();
    await phone.getByRole("button", { name: "Start scanning", exact: true }).click();
    await expect(phone.getByText("Ready for your station QR", { exact: true })).toBeVisible();
    await showSyntheticQr(phone, state.baseURL + "/checkin#provision=" + setup.stations[0].provisionCode);
    await phone.getByRole("button", { name: "Confirm station", exact: true }).click();
    await phone.getByLabel("Event", { exact: true }).selectOption(setup.events[0].id);
    await phone.getByRole("button", { name: "Use event", exact: true }).click();
    await expect(phone.getByRole("button", { name: "Start scanning", exact: true })).toBeEnabled();
    await phone.getByRole("button", { name: "Tools", exact: true }).click();
    await phone.getByRole("button", { name: "Change event", exact: true }).click();
    await phone.route("**/api/checkin-events", async route => {
      if (route.request().postDataJSON()?.operation !== "select") return route.continue();
      const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort("failed");
    });
    await phone.getByLabel("Event", { exact: true }).selectOption(setup.events[1].id);
    await phone.getByRole("button", { name: "Use event", exact: true }).click();
    await expect(phone.locator(".wts-operator-context")).toContainText("Synthetic workshop");
    await expect(phone.getByRole("button", { name: "Start scanning", exact: true })).toBeEnabled();
    await phone.unroute("**/api/checkin-events");
    await phone.getByRole("button", { name: "Find attendee", exact: true }).click();
    await phone.getByLabel("Attendee name or email", { exact: true }).fill("Scanner UX");
    await phone.getByRole("button", { name: "Search attendees", exact: true }).click();
    await phone.getByRole("button", { name: "Select Јана Scanner UX", exact: true }).click();
    // Explicit UI-only response fixture for a terminal rejection. Backend
    // rejection/identity semantics are covered by the persistence suites.
    await phone.route("**/api/checkin-lookup", async route => {
      if (route.request().postDataJSON()?.operation !== "confirm") return route.continue();
      const input = route.request().postDataJSON().input;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: "rejected", reason: "not_in_list", operationId: input.operationId, replayed: false, operationsEnabled: false }) });
    });
    await phone.getByRole("button", { name: "Confirm check-in", exact: true }).click();
    const result = phone.getByRole("region", { name: "Lookup result", exact: true });
    await expect(result.getByRole("heading", { name: "Ticket not accepted", exact: true })).toBeVisible();
    await expect(result).toContainText("not on this event’s list");
    await expect(result.getByRole("button", { name: "Back to scanner", exact: true })).toBeVisible();
    await phone.screenshot({ path: info.outputPath("lookup-rejection.png"), fullPage: true });
    await result.getByRole("button", { name: "Back to scanner", exact: true }).click();
    await phone.setViewportSize({ width: 844, height: 390 });
    let failed = true;
    await phone.route("**/api/checkin", route => route.request().postDataJSON()?.operation === "status" && failed ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic connection failure" }) }) : route.continue());
    await expect(phone.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    failed = false;
    await phone.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(phone.getByRole("button", { name: "Start scanning", exact: true })).toBeEnabled();
    await phone.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    const layout = await phone.evaluate(() => { const context = document.querySelector(".wts-operator-context")!.getBoundingClientRect(); const status = document.querySelector(".wts-operator-status")!.getBoundingClientRect(); return { separate: context.bottom <= status.top + 1, noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth }; });
    expect(layout).toEqual({ separate: true, noHorizontalOverflow: true });
  } finally { await setup.cleanup(); }
});
