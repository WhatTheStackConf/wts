// Mounted component + real client validation, synthetic loopback transport only.
import { createServer } from "vite";
import solid from "@solidjs/vite-plugin";
import { chromium, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixtureId = `${root}tests/__recovery-compact-fixture.tsx`;
const fixture = `
import { createSignal } from "solid-js";
import { render } from "@solidjs/web";
import { CheckinOperatorRecovery, CheckinAdminRecovery } from "~/components/checkin/CheckinRecovery";
function Fixture() {
  const [scope, setScope] = createSignal("operator:binding-one");
  const [visible, setVisible] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  return <main>
    <output aria-label="Parent recovery busy">{String(busy())}</output>
    <button onClick={() => setScope("operator:binding-two")}>Rebind test station</button>
    <button onClick={() => setScope("")}>Unmount recovery</button>
    <CheckinOperatorRecovery scopeKey={scope()} unavailable={!visible()} compact onBusyChange={value => { setBusy(value); }} />
    <CheckinAdminRecovery scopeKey="admin:session" compact />
  </main>;
}
render(() => <Fixture />, document.getElementById("app"));
`;
const server = await createServer({ configFile: false, root, plugins: [solid({ ssr: false }), {
  name: "recovery-compact-fixture",
  resolveId(id) { if (id === "/__recovery-compact-fixture.tsx") return fixtureId; },
  load(id) { if (id === fixtureId) return fixture; },
  configureServer(server) { server.middlewares.use(async (req, res, next) => {
    if (req.url !== "/") return next();
    res.setHeader("Content-Type", "text/html");
    res.end(await server.transformIndexHtml("/", '<!doctype html><html><body><div id="app"></div><script type="module" src="/__recovery-compact-fixture.tsx"></script></body></html>'));
  }); },
}], resolve: { alias: { "~": `${root}src` } }, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
await server.listen();
const profile = { id: "ppppppppppppppp", stationId: "wts2026station1", version: 1, approval: "unapproved", config: { rendererVersion: "wts-name-label-v1", fontVersion: "noto-sans-2.008-latin-cyrillic-v1", printerRef: "synthetic-preview", stockRef: "synthetic-50x30-gap", synthetic: true, media: { widthMm: 50, heightMm: 30, kind: "precut-gap" }, raster: { width: 600, height: 360 }, printable: { x: 12, y: 12, width: 576, height: 336 }, margins: { top: 24, right: 18, bottom: 24, left: 18 }, offset: { x: 0, y: 0 }, direction: 0, feed: { mode: "gap", gapDots: 24, advanceDots: 0 }, density: 3, threshold: 160 } };
const workflow = { workflowId: "aaaaaaaaaaaaaaa", stationId: "wts2026station1", eventId: "eeeeeeeeeeeeeee", eventTitle: "Synthetic event", admissionState: "accepted", version: 0, name: "Private attendee", affiliation: "界", decision: "", fulfillment: "protocol_complete", parked: false, completedDay: "2026-09-11", isolated: false, profile, admissionReadRetryEligible: false, attempts: [{ id: "bbbbbbbbbbbbbbb", purpose: "initial", state: "uncertain", name: "Private attendee", affiliation: "界", predecessorId: "", observation: null, cancellation: null }], attemptsTruncated: false, reads: [], admissionAttempts: [], resets: [], operationsEnabled: false };
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  const commands = []; const offsets = [];
  let heldHistory, heldCommand, failPage = false, deny = false, acknowledge = false;
  await page.route("**/api/checkin-recovery", async route => {
    const body = route.request().postDataJSON();
    if (body.operation === "history") {
      offsets.push(body.offset);
      if (body.offset === 1 && !heldHistory) { heldHistory = route; return; }
      if (body.offset === 1 && failPage) return route.fulfill({ status: 503, json: { error: "offline" } });
      return route.fulfill({ json: body.offset === 0 ? { items: [workflow], nextOffset: 1 } : { items: [], nextOffset: null } });
    }
    if (body.operation === "get") return deny ? route.fulfill({ status: 403, json: { error: "denied" } }) : route.fulfill({ json: workflow });
    if (body.operation === "command") {
      commands.push(body.command);
      if (commands.length === 1) { heldCommand = route; return; }
      if (deny) return route.fulfill({ status: 403, json: { error: "denied" } });
      if (acknowledge) return route.fulfill({ json: { operationId: body.command.operationId, workflow: { ...workflow, version: 1, parked: true } } });
      return route.abort("failed");
    }
    return route.fulfill({ json: { workflowId: workflow.workflowId, items: [], nextOffset: null } });
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  const panel = page.getByRole("region", { name: "Station label recovery", exact: true });
  const busy = page.getByLabel("Parent recovery busy");
  await expect(panel.getByRole("heading", { name: "Recent work", exact: true })).toBeVisible();
  await expect(panel).not.toContainText("Parking does not make uncertain printing safe");
  await expect(panel).not.toContainText("wts2026station1");
  await expect(panel.getByLabel("Label-only name", { exact: true })).toHaveCount(0);
  const admin = page.getByRole("region", { name: "Admin recovery", exact: true });
  await expect(admin.getByRole("heading", { name: "Admission evidence and recovery" })).toBeVisible();
  await expect(admin).toContainText("Parking does not make uncertain printing safe");

  await panel.getByRole("button", { name: "Next recovery page", exact: true }).click();
  await expect.poll(() => !!heldHistory).toBe(true);
  await expect(panel).toContainText("Loading recent work");
  await expect(panel).not.toContainText("No work on this page");
  await expect(panel.getByRole("button", { name: /Private attendee/ })).toHaveCount(0);
  failPage = true; await heldHistory.fulfill({ status: 503, json: { error: "offline" } });
  await expect(panel.getByRole("alert")).toContainText("not an empty page");
  await expect(panel).not.toContainText("No work on this page");
  failPage = false;
  await panel.getByRole("button", { name: "Refresh recovery history", exact: true }).click();
  await expect(panel).toContainText("No work on this page");
  assert.equal(offsets.at(-1), 1, "refresh retries the failed page, not page one");
  await expect(panel.getByRole("button", { name: "Next recovery page", exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "Previous recovery page", exact: true }).click();
  await panel.getByRole("button", { name: /Private attendee/ }).click();
  await expect(panel.getByRole("button", { name: "I observed printed output", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Request a new replacement label", exact: true })).toBeDisabled();
  await expect(panel.getByLabel("Label-only name", { exact: true })).not.toBeVisible();
  await panel.locator("summary").filter({ hasText: "Edit label text" }).click();
  await expect(panel.getByLabel("Label-only name", { exact: true })).toHaveValue("Private attendee");
  await panel.locator("summary").filter({ hasText: "Handwrite instead" }).click();
  const handwriting = panel.getByRole("button", { name: "Request safe handwritten fulfillment", exact: true });
  await expect(handwriting).toBeDisabled();
  await panel.getByLabel("I confirm I have physically handwritten the label.", { exact: false }).check();
  await expect(handwriting).toBeEnabled();
  await panel.getByLabel("I confirm I have physically handwritten the label.", { exact: false }).uncheck();

  await panel.getByRole("button", { name: "Park this work", exact: true }).click();
  await expect.poll(() => !!heldCommand).toBe(true);
  await expect(busy).toHaveText("true");
  await heldCommand.abort("failed");
  const retry = panel.getByRole("button", { name: "Retry exact saved recovery command", exact: true });
  await expect(retry).toBeEnabled(); await expect(busy).toHaveText("true");
  await expect(panel.getByRole("button", { name: "Back to recent work", exact: true })).toBeDisabled();
  deny = true; await retry.click();
  await expect(retry).toBeDisabled(); await expect(busy).toHaveText("true");
  await expect(panel).not.toContainText("Private attendee");
  await expect(panel.getByLabel("Label-only name", { exact: true })).toHaveCount(0);
  deny = false; await panel.getByRole("button", { name: "Reverify recovery access" }).click();
  await expect(retry).toBeEnabled();
  acknowledge = true; await retry.click();
  await expect(panel.getByRole("button", { name: "Resume this work" })).toBeVisible();
  await expect(busy).toHaveText("false");
  assert.equal(commands.length, 3); assert.deepEqual(commands[1], commands[0]); assert.deepEqual(commands[2], commands[0]);
  acknowledge = false;
  await panel.getByRole("button", { name: "Resume this work" }).click();
  await expect(retry).toBeEnabled(); await expect(busy).toHaveText("true");
  await page.getByRole("button", { name: "Unmount recovery" }).click();
  await expect(panel).toHaveCount(0); await expect(busy).toHaveText("false");
  assert.deepEqual(errors, []);
  const safety = await browser.newPage();
  await safety.route("**/api/checkin-recovery", async route => {
    const body = route.request().postDataJSON();
    if (body.operation === "history") return route.fulfill({ json: { items: [{ ...workflow, parked: true }], nextOffset: null } });
    if (body.operation === "get") return route.fulfill({ json: { ...workflow, parked: true, isolated: true } });
    throw new Error("Safety disclosure verification must not mutate");
  });
  await safety.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  const safetyPanel = safety.getByRole("region", { name: "Station label recovery", exact: true });
  await expect(safetyPanel.getByRole("button", { name: /Private attendee/ })).toContainText("Check output · Set aside");
  await safetyPanel.getByRole("button", { name: /Private attendee/ }).click();
  await expect(safetyPanel.getByText("Finish handwriting & reconnect", { exact: true })).toBeVisible();
  await expect(safetyPanel.getByRole("button", { name: "Confirm safe queue and release isolation", exact: true })).toBeVisible();
  await expect(safetyPanel.getByRole("button", { name: "Request a new replacement label", exact: true })).toBeDisabled();
  await safety.close();
  console.log("PASS compact recovery: page states, disclosures, eligibility, exact retry, redaction, busy lifetime, cleanup, admin shell");
} finally { await browser?.close(); await server.close(); }