import { test, expect, login } from "./checkin-fixtures";
import type { Page } from "@playwright/test";
import type { MonitoringDashboard, MonitoringConfigureCommand } from "../src/lib/checkin-monitoring-contract";
import { CheckinMonitoringWorker } from "../src/lib/checkin-monitoring-worker";
import { CheckinAgentService } from "../src/lib/checkin-agent-service";

const endpoint = "/api/checkin-monitoring";
async function command(page: Page, body: object) {
  const result = await page.evaluate(async (body) => {
    const response = await fetch("/api/checkin-monitoring", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }, body);
  expect(result.status).toBe(200);
  return result.body;
}
const panelFor = (page: Page) => page.getByRole("region", { name: "Check-in monitoring", exact: true });

test("monitoring conflict reloads latest version, preserves unsent edits on read failure, and cancels", async ({ page, state, actorPage }, info) => {
  await login(page, state.users.admin);
  await page.goto("/admin/checkin");
  const panel = panelFor(page);
  await panel.getByRole("button", { name: "Edit notification configuration", exact: true }).click();
  await panel.getByLabel("Waiting warning (seconds)", { exact: true }).fill("31");
  const other = await actorPage(state.users.admin);
  const original = await command(other, { operation: "dashboard" }) as MonitoringDashboard;
  await command(other, { operation: "configure", command: { ...original.config!, operationId: crypto.randomUUID(), expectedVersion: original.config!.version, version: undefined, waitingMs: 32000 } });
  const conflict = page.waitForResponse((r) => r.url().endsWith(endpoint) && r.request().postDataJSON().operation === "configure");
  await panel.getByRole("button", { name: "Save notification configuration", exact: true }).click();
  expect((await conflict).status()).toBe(409);
  await expect(panel.getByRole("button", { name: "Save notification configuration", exact: true })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Refresh monitoring", exact: true })).toBeEnabled();
  await panel.screenshot({ path: info.outputPath("monitoring-conflict.png") });
  await panel.getByRole("button", { name: "Discard edits and reload configuration", exact: true }).click();
  await expect(panel.getByLabel("Waiting warning (seconds)", { exact: true })).toHaveValue("32");
  await panel.getByLabel("Waiting warning (seconds)", { exact: true }).fill("33");
  const saved = page.waitForResponse((r) => r.url().endsWith(endpoint) && r.request().postDataJSON().operation === "configure");
  await panel.getByRole("button", { name: "Save notification configuration", exact: true }).click();
  const result = await saved;
  expect(result.status()).toBe(200);
  expect(result.request().postDataJSON().command.expectedVersion).toBe(original.config!.version + 1);
  await expect(panel.getByText("Notification configuration saved.", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Edit notification configuration", exact: true }).click();
  await panel.getByLabel("Waiting warning (seconds)", { exact: true }).fill("34");
  await page.route(`**${endpoint}`, async (route) => route.request().postDataJSON().operation === "dashboard" ? route.fulfill({ status: 503, body: "temporary read failure" }) : route.continue());
  await panel.getByRole("button", { name: "Refresh monitoring", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("Monitoring service unavailable");
  await expect(panel.getByLabel("Waiting warning (seconds)", { exact: true })).toHaveValue("34");
  await panel.getByRole("button", { name: "Cancel notification editing", exact: true }).click();
  await expect(panel.getByLabel("Waiting warning (seconds)", { exact: true })).toHaveCount(0);
  await page.unroute(`**${endpoint}`);
  await panel.getByRole("button", { name: "Refresh monitoring", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Edit notification configuration", exact: true })).toBeEnabled();
});

test("lost committed config response survives acknowledgement plus dashboard 503 and retries exact command", async ({ page, state, db }, info) => {
  const actor = { userId: state.users.admin.id, role: "admin" as const };
  const agents = new CheckinAgentService(db, actor);
  let now = Date.now();
  const worker = new CheckinMonitoringWorker(db, { now: () => now, readReadiness: async () => (await agents.adminList()).stations, transport: async () => { throw new Error("No test email may be sent"); } });
  await worker.observe(); now += 61000; await worker.observe();
  await login(page, state.users.admin);
  await page.goto("/admin/checkin");
  const panel = panelFor(page);
  await expect(panel.getByRole("list", { name: "Authoritative station readiness" }).getByRole("listitem")).toHaveCount(3);
  await panel.getByRole("button", { name: "Edit notification configuration", exact: true }).click();
  await panel.getByLabel("Waiting warning (seconds)", { exact: true }).fill("35");
  const commands: MonitoringConfigureCommand[] = [];
  let failReads = false;
  let committedVersion = 0;
  await page.route(`**${endpoint}`, async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation === "configure") {
      commands.push(body.command);
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (commands.length === 1) { committedVersion = (await response.json()).version; await route.abort("failed"); }
      else await route.fulfill({ response });
    } else if (body.operation === "dashboard" && failReads) await route.fulfill({ status: 503, body: "temporary read failure" });
    else await route.continue();
  });
  await panel.getByRole("button", { name: "Save notification configuration", exact: true }).click();
  const retry = panel.getByRole("button", { name: "Retry same notification configuration", exact: true });
  await expect(retry).toBeEnabled();
  expect(committedVersion).toBeGreaterThan(0);
  failReads = true;
  await panel.getByRole("button", { name: /^Acknowledge incident / }).first().click();
  await expect(panel.getByRole("alert")).toContainText("Monitoring service unavailable");
  await expect(panel.getByText("Incident acknowledged. Operational state is unchanged.", { exact: true })).toBeVisible();
  await expect(panel.getByLabel("Waiting warning (seconds)", { exact: true })).toHaveValue("35");
  await expect(panel.getByLabel("Waiting warning (seconds)", { exact: true })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Cancel notification editing", exact: true })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Discard edits and reload configuration", exact: true })).toBeDisabled();
  await expect(retry).toBeEnabled();
  await page.setViewportSize({ width: 360, height: 800 });
  await panel.screenshot({ path: info.outputPath("monitoring-frozen-after-ack-503.png") });
  await retry.click();
  await expect(panel.getByText("Notification configuration saved.", { exact: true })).toBeVisible();
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
  const config = (await db.collection("checkin_monitoring_config").getFullList())[0];
  expect(config.version).toBe(committedVersion);
  expect(config.waiting_ms).toBe(35000);
  failReads = false;
  await panel.getByRole("button", { name: "Refresh monitoring", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Edit notification configuration", exact: true })).toBeEnabled();
  await expect(panel.getByRole("list", { name: "Authoritative station readiness" }).getByRole("listitem")).toHaveCount(3);
});
