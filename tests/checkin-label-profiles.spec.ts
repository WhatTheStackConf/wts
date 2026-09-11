import type { Locator, Page } from "@playwright/test";
import type PocketBase from "pocketbase";
import { test, expect, login, status } from "./checkin-fixtures";
import type { CheckinAdminDTO, CheckinStationDTO } from "~/lib/checkin-contract";
import type { CheckinLabelCatalogue, LabelProfileMutation } from "~/lib/checkin-label-client";
import type { CheckinLabelProfileResult } from "~/lib/checkin-label-profile-contract";
import { LABEL_FONT_VERSION, LABEL_RENDERER_VERSION, type LabelProfileConfig, type LabelRasterResult } from "~/lib/checkin-label-render-contract";

// All values and attestations below are TEST-ONLY simulations in the generated
// disposable database. synthetic:false exercises the measured-mode contract; it
// is NOT evidence of a real measurement, physical print, or event-use approval.
const configurationNote = "Synthetic browser test only - simulated measured profile configuration";
const attestationNote = "TEST ONLY simulated owner check of legibility, bounds and gap feed; no physical printer was used";
const editNote = "Synthetic browser test only - changed measured horizontal offset";
const retryNote = "Synthetic browser loss-of-response test - preserve exact measured command";
const endpoint = "/api/checkin-labels";

async function command<T>(page: Page, url: string, body: object): Promise<T> {
  const result = await page.evaluate(async ({ url, body }) => {
    const response = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }, { url, body });
  expect(result.status, JSON.stringify(result.data)).toBe(200);
  return result.data;
}

/** Only prerequisite station setup uses the API; profiles use the real forms.
 * Read the live version so other sequential browser specs need no reset/seed. */
async function setPrinter(page: Page, printerRef: string, stationId?: string) {
  const overview = await command<CheckinAdminDTO>(page, "/api/checkin", { operation: "admin_list" });
  const station = stationId ? overview.stations.find((entry) => entry.id === stationId) : overview.stations[0];
  if (!station) throw new Error("Disposable station fixture missing");
  const result = await command<{ station: CheckinStationDTO }>(page, "/api/checkin", {
    operation: "admin_control", command: {
      operation: "configure_station", operationId: crypto.randomUUID(), expectedVersion: station.version,
      stationId: station.id, label: station.label, location: station.location, printerRef,
      reason: "configuration", note: "Synthetic browser fixture printer reference only - no device connection",
    },
  });
  const readback = await command<CheckinAdminDTO>(page, "/api/checkin", { operation: "admin_list" });
  expect(readback.stations.find((entry) => entry.id === station.id)).toEqual(result.station);
  expect(result.station.printerRef).toBe(printerRef);
  return result.station;
}

function controls(page: Page) {
  const region = page.getByRole("region", { name: "Name Label profiles", exact: true });
  return {
    region,
    station: region.getByLabel("Station for profile configuration", { exact: true }),
    editor: region.getByRole("form", { name: "Edit Name Label profile", exact: true }),
    confirmation: region.getByRole("form", { name: "Confirm Name Label profile action", exact: true }),
    approval: region.getByRole("button", { name: "Review physical profile approval", exact: true }),
  };
}

async function selectStation(page: Page, stationId: string) {
  const ui = controls(page);
  await expect(ui.station).toBeEnabled();
  await ui.station.selectOption(stationId);
  await expect(ui.editor).toBeVisible();
  return ui;
}

function simulatedMeasurements(printerRef: string): LabelProfileConfig {
  return {
    rendererVersion: LABEL_RENDERER_VERSION, fontVersion: LABEL_FONT_VERSION,
    printerRef, stockRef: "test-only-measured-50x30-gap", synthetic: false,
    media: { widthMm: 50, heightMm: 30, kind: "precut-gap" },
    raster: { width: 608, height: 368 }, printable: { x: 10, y: 14, width: 588, height: 340 },
    margins: { top: 26, right: 20, bottom: 28, left: 22 }, offset: { x: 2, y: -3 }, direction: 180,
    feed: { mode: "gap", gapDots: 26, advanceDots: 4 }, density: 4, threshold: 172,
  };
}

async function enterMeasurements(editor: Locator, config: LabelProfileConfig) {
  const mode = editor.getByLabel("Synthetic profile — tests and previews only", { exact: true });
  await mode.check();
  await mode.uncheck();
  await expect(editor.getByLabel("Raster width", { exact: true })).toHaveValue("");
  await expect(editor.getByLabel("Stock asset reference", { exact: true })).toHaveValue("");
  await editor.getByLabel("Stock asset reference", { exact: true }).fill(config.stockRef);
  const fields: [string, number][] = [
    ["Raster width", config.raster.width], ["Raster height", config.raster.height],
    ["Printable left", config.printable.x], ["Printable top", config.printable.y],
    ["Printable width", config.printable.width], ["Printable height", config.printable.height],
    ["Top safe margin", config.margins.top], ["Right safe margin", config.margins.right],
    ["Bottom safe margin", config.margins.bottom], ["Left safe margin", config.margins.left],
    ["Horizontal offset", config.offset.x], ["Vertical offset", config.offset.y],
    ["Gap feed", config.feed.gapDots], ["Additional feed", config.feed.advanceDots],
    ["Density (1–5)", config.density], ["Monochrome threshold (1–254)", config.threshold],
  ];
  for (const [name, value] of fields) await editor.getByLabel(name, { exact: true }).fill(String(value));
  await editor.getByLabel("Raster direction", { exact: true }).selectOption(String(config.direction));
}

async function review(page: Page, note: string, approve = false) {
  const ui = controls(page);
  await (approve ? ui.approval : ui.editor.getByRole("button", { name: "Review Name Label profile", exact: true })).click();
  const reason = ui.confirmation.getByLabel("Profile action reason (required)", { exact: true });
  await expect(reason).toBeFocused();
  await reason.selectOption("configuration");
  await ui.confirmation.getByLabel("Profile action note", { exact: true }).fill(note);
  return ui.confirmation;
}

async function submit(page: Page, operation: LabelProfileMutation["operation"], retry = false) {
  const response = page.waitForResponse((response) => response.url().endsWith(endpoint) && response.request().postDataJSON()?.operation === operation);
  await controls(page).confirmation.getByRole("button", { name: retry ? "Retry same profile action" : "Confirm profile action", exact: true }).click();
  const saved = await response;
  expect(saved.status(), await saved.text()).toBe(200);
  const mutation = saved.request().postDataJSON() as LabelProfileMutation;
  const result = await saved.json() as CheckinLabelProfileResult;
  await expect(controls(page).confirmation).toHaveCount(0);
  await expect(controls(page).station).toBeEnabled();
  return { mutation, result };
}

async function assertAudit(db: PocketBase, actor: string, mutation: LabelProfileMutation, result: CheckinLabelProfileResult) {
  const actions = await db.collection("admin_actions").getFullList({ filter: db.filter("actor_user = {:actor} && operation_id = {:uuid}", { actor, uuid: mutation.command.operationId }) });
  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({
    id: result.actionId, source: "admin_ui", status: "applied", actor_user: actor,
    operation_kind: `checkin.${mutation.operation === "configure" ? "configure" : "approve"}_label_profile`,
    target_collection: "checkin_label_profiles", target_id: result.profile.id, after_summary: result.profile,
  });
  const audits = await db.collection("checkin_audit_events").getFullList({ filter: db.filter("admin_action_id = {:id}", { id: result.actionId }) });
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    actor_user_id: actor, actor_role: "admin", operation: `${mutation.operation}_label_profile`,
    station_id: result.profile.stationId, label_profile_id: result.profile.id,
    reason: mutation.command.reason, note: mutation.command.note, outcome: "applied", state: { after: result.profile },
  });
}

async function approvals(db: PocketBase, profileId: string) {
  return db.collection("checkin_label_approvals").getFullList({ filter: db.filter("profile = {:id}", { id: profileId }) });
}

async function catalogue(page: Page) {
  const result = await command<CheckinLabelCatalogue>(page, endpoint, { operation: "list" });
  expect(result.operationsEnabled).toBe(false);
  return result;
}

async function noHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("test-only measured profile: actual admin approval, immutable edit, and printer mismatch", async ({ page, state, db }, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page, state.users.admin);
  const station = await setPrinter(page, "test-only-label-printer-measured");
  const before = (await catalogue(page)).profiles.find((profile) => profile.stationId === station.id);
  await page.goto("/admin/checkin");
  const ui = await selectStation(page, station.id);
  const config = simulatedMeasurements(station.printerRef);
  await enterMeasurements(ui.editor, config);
  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalOverflow(page);
  await ui.editor.screenshot({ path: info.outputPath("label-profile-measured-editor-390.png") });
  const form = await review(page, configurationNote);
  await page.setViewportSize({ width: 320, height: 740 });
  const reason = form.getByLabel("Profile action reason (required)", { exact: true });
  await reason.focus();
  await page.keyboard.press("Tab");
  await expect(form.getByLabel("Profile action note", { exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(reason).toBeFocused();
  await noHorizontalOverflow(page);
  await form.screenshot({ path: info.outputPath("label-profile-confirm-keyboard-320.png") });
  const configured = await submit(page, "configure");
  expect(configured.mutation).toMatchObject({ operation: "configure", command: {
    stationId: station.id, expectedStationVersion: station.version, expectedVersion: before?.version ?? 0,
    reason: "configuration", note: configurationNote, config,
  } });
  expect(configured.result.profile).toMatchObject({ stationId: station.id, version: (before?.version ?? 0) + 1, approval: "unapproved", config });
  const originalRecord = await db.collection("checkin_label_profiles").getOne(configured.result.profile.id);
  expect(originalRecord).toMatchObject({ station: station.id, station_version: station.version, version: configured.result.profile.version, config, admin_action_id: configured.result.actionId });
  expect(await approvals(db, configured.result.profile.id)).toEqual([]);
  await assertAudit(db, state.users.admin.id, configured.mutation, configured.result);

  // Real stored-profile preview stays unapproved; no synthetic approval response.
  await ui.region.getByLabel("Preview profile version", { exact: true }).selectOption(configured.result.profile.id);
  await ui.region.getByLabel("Attendee name", { exact: true }).fill("Synthetic Test Name");
  const previewResponse = page.waitForResponse((response) => response.url().endsWith(endpoint) && response.request().postDataJSON()?.operation === "preview");
  await ui.region.getByRole("button", { name: "Preview Name Label", exact: true }).click();
  const preview = await previewResponse;
  expect(preview.status()).toBe(200);
  expect((await preview.json() as LabelRasterResult).snapshot.profile).toEqual(configured.result.profile);
  expect(await approvals(db, configured.result.profile.id)).toEqual([]);
  expect((await catalogue(page)).profiles.find((profile) => profile.stationId === station.id)).toEqual(configured.result.profile);

  await page.reload();
  await selectStation(page, station.id);
  await expect(ui.editor.getByLabel("Horizontal offset", { exact: true })).toHaveValue("2");
  await expect(ui.editor.getByLabel("Raster direction", { exact: true })).toHaveValue("180");
  await expect(ui.region.getByText(`Station configuration version ${station.version} · Profile v${configured.result.profile.version}: unapproved`, { exact: true })).toBeVisible();
  await review(page, attestationNote, true);
  const attestation = ui.confirmation.getByRole("checkbox", { name: /^I physically verified printed legibility/ });
  await expect(attestation).not.toBeChecked();
  await expect(attestation).toHaveJSProperty("required", true);
  await ui.confirmation.getByRole("button", { name: "Confirm profile action", exact: true }).click();
  await expect(attestation).toBeFocused();
  expect(await approvals(db, configured.result.profile.id)).toEqual([]);
  // Explicit TEST-ONLY simulated human attestation, never physical evidence.
  await attestation.check();
  const approved = await submit(page, "approve");
  expect(approved.mutation).toMatchObject({ operation: "approve", command: {
    profileId: configured.result.profile.id, expectedVersion: configured.result.profile.version,
    expectedStationVersion: station.version, physicalConfirmation: true, note: attestationNote,
  } });
  expect(approved.result.profile).toEqual({ ...configured.result.profile, approval: "approved" });
  const approvalRecords = await approvals(db, configured.result.profile.id);
  expect(approvalRecords).toHaveLength(1);
  expect(approvalRecords[0]).toMatchObject({ profile: configured.result.profile.id, station_version: station.version, physical_confirmation: true, admin_action_id: approved.result.actionId });
  await assertAudit(db, state.users.admin.id, approved.mutation, approved.result);
  expect(await db.collection("checkin_label_profiles").getOne(originalRecord.id)).toEqual(originalRecord);
  await page.reload();
  await selectStation(page, station.id);
  expect((await catalogue(page)).profiles.find((profile) => profile.stationId === station.id)).toEqual(approved.result.profile);
  await expect(ui.approval).toBeDisabled();

  // A station configuration edit invalidates the original fence even when its
  // printer reference is unchanged. The UI must not invite an impossible approval.
  await setPrinter(page, station.printerRef, station.id);
  await page.reload();
  await selectStation(page, station.id);
  await expect(ui.region.getByText("Station configuration changed since this profile was saved. Save and physically verify a new profile version before approval, even if the printer reference is unchanged.", { exact: true })).toBeVisible();
  await expect(ui.approval).toBeDisabled();
  expect((await catalogue(page)).profileStationVersions[configured.result.profile.id]).toBe(station.version);

  await ui.editor.getByLabel("Horizontal offset", { exact: true }).fill("3");
  await review(page, editNote);
  const edited = await submit(page, "configure");
  expect(edited.result.profile.id).not.toBe(configured.result.profile.id);
  expect(edited.result.profile).toMatchObject({ version: configured.result.profile.version + 1, approval: "unapproved", config: { ...config, offset: { x: 3, y: -3 } } });
  expect(edited.mutation.command.expectedVersion).toBe(configured.result.profile.version);
  expect(await db.collection("checkin_label_profiles").getOne(originalRecord.id)).toEqual(originalRecord);
  expect(await approvals(db, configured.result.profile.id)).toEqual(approvalRecords);
  expect(await approvals(db, edited.result.profile.id)).toEqual([]);
  expect((await db.collection("checkin_label_profiles").getOne(edited.result.profile.id)).config).toEqual(edited.result.profile.config);
  await assertAudit(db, state.users.admin.id, edited.mutation, edited.result);
  await page.reload();
  await selectStation(page, station.id);
  await expect(ui.approval).toBeEnabled();
  await expect(ui.editor.getByLabel("Horizontal offset", { exact: true })).toHaveValue("3");
  await page.getByRole("button", { name: "Refresh administration", exact: true }).click();
  const audit = page.getByRole("region", { name: "Check-in audit", exact: true });
  await expect(audit.getByRole("listitem").filter({ hasText: attestationNote })).toContainText("approve_label_profile");
  await expect(audit.getByRole("listitem").filter({ hasText: editNote })).toContainText("configure_label_profile");

  await setPrinter(page, "test-only-label-printer-replacement", station.id);
  await page.reload();
  await selectStation(page, station.id);
  await expect(ui.region.getByText("Printer identity mismatch. This profile is unavailable for production use; configure and physically verify a new version.", { exact: true })).toBeVisible();
  await expect(ui.approval).toBeDisabled();
  const mismatched = await catalogue(page);
  expect(mismatched.profiles.find((profile) => profile.stationId === station.id)).toEqual(edited.result.profile);
  expect(mismatched.stations.find((entry) => entry.id === station.id)?.printerRef).toBe("test-only-label-printer-replacement");
  await noHorizontalOverflow(page);
  await page.goto("/checkin-tools");
  expect((await status(page)).operationsEnabled).toBe(false);
  await expect(page.getByRole("button", { name: "Arrivals", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Validate arrival", exact: true })).not.toBeVisible();
  expect(errors).toEqual([]);
});

test("synthetic profile configured in the admin UI can never acquire approval", async ({ page, state, db }) => {
  await login(page, state.users.admin);
  const station = await setPrinter(page, "test-only-label-printer-synthetic");
  await page.goto("/admin/checkin");
  const ui = await selectStation(page, station.id);
  await ui.editor.getByLabel("Synthetic profile — tests and previews only", { exact: true }).check();
  await review(page, "Synthetic profile browser test only");
  const saved = await submit(page, "configure");
  expect(saved.result.profile).toMatchObject({ approval: "unapproved", config: { synthetic: true, printerRef: station.printerRef } });
  await assertAudit(db, state.users.admin.id, saved.mutation, saved.result);
  await page.reload();
  await selectStation(page, station.id);
  await expect(ui.region.getByText("Synthetic profiles cannot be approved for production.", { exact: true })).toBeVisible();
  await expect(ui.approval).toBeDisabled();
  // Defense in depth: bypassing a disabled button still hits the REAL server.
  const operationId = crypto.randomUUID();
  const rejected = await page.evaluate(async ({ endpoint, profile, stationVersion, operationId, note }) => {
    const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "approve", command: {
      operationId, profileId: profile.id, expectedVersion: profile.version, expectedStationVersion: stationVersion,
      reason: "configuration", note, physicalConfirmation: true,
    } }) });
    return { status: response.status, body: await response.json() };
  }, { endpoint, profile: saved.result.profile, stationVersion: station.version, operationId, note: attestationNote });
  expect(rejected.status, JSON.stringify(rejected.body)).toBe(400);
  expect(await approvals(db, saved.result.profile.id)).toEqual([]);
  expect(await db.collection("admin_actions").getFullList({ filter: db.filter("operation_id = {:id}", { id: operationId }) })).toEqual([]);
  expect((await catalogue(page)).profiles.find((profile) => profile.stationId === station.id)).toEqual(saved.result.profile);
});

for (const failureMode of ["transport", "empty-json", "null-json", "error-json"] as const) test(`synthetic ${failureMode} response: failed catalogue refresh preserves the frozen measured profile retry`, async ({ page, state, db }, info) => {
  test.setTimeout(120_000);
  await login(page, state.users.admin);
  const station = await setPrinter(page, "test-only-label-printer-retry");
  const baseline = (await catalogue(page)).profiles.find((profile) => profile.stationId === station.id);
  await page.goto("/admin/checkin");
  const ui = await selectStation(page, station.id);
  const config = simulatedMeasurements(station.printerRef);
  await enterMeasurements(ui.editor, config);
  await review(page, retryNote);
  const submitted: LabelProfileMutation[] = [];
  let committed: CheckinLabelProfileResult | undefined;
  let failCatalogue = false;
  let failedCatalogueRequests = 0;
  await page.route(`**${endpoint}`, async (route) => {
    const body = route.request().postDataJSON();
    if (body?.operation === "list" && failCatalogue) {
      failedCatalogueRequests++;
      // Explicit synthetic browser transport failure; never substitute a profile.
      return route.abort("failed");
    }
    if (body?.operation !== "configure") return route.continue();
    submitted.push(body);
    if (submitted.length !== 1) return route.continue();
    const response = await route.fetch(); // The REAL server commits before the browser loses its response.
    expect(response.status(), await response.text()).toBe(200);
    committed = await response.json() as CheckinLabelProfileResult;
    if (failureMode === "transport") await route.abort("failed");
    else await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(failureMode === "null-json" ? null : failureMode === "error-json" ? { error: "Synthetic malformed success response" } : {}) });
  });
  await ui.confirmation.getByRole("button", { name: "Confirm profile action", exact: true }).click();
  const retry = ui.confirmation.getByRole("button", { name: "Retry same profile action", exact: true });
  await expect(retry).toBeEnabled();
  expect(submitted).toHaveLength(1);
  expect(submitted[0]).toMatchObject({ operation: "configure", command: {
    stationId: station.id, expectedStationVersion: station.version, expectedVersion: baseline?.version ?? 0,
    reason: "configuration", note: retryNote, config,
  } });
  expect(submitted[0].command.operationId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  if (!committed) throw new Error("Lost-response fixture did not commit a real profile");
  expect((await db.collection("checkin_label_profiles").getOne(committed.profile.id)).config).toEqual(config);
  await assertAudit(db, state.users.admin.id, submitted[0], committed);

  const confirmationNode = await ui.confirmation.elementHandle();
  if (!confirmationNode) throw new Error("Pending confirmation missing");
  failCatalogue = true;
  await ui.region.getByRole("button", { name: "Refresh Name Label profiles", exact: true }).click();
  await expect(ui.region.getByText("Name Label profiles unavailable. Refresh before configuring or previewing a stored profile.", { exact: true })).toBeVisible();
  expect(failedCatalogueRequests).toBe(1);
  expect(await confirmationNode.evaluate((node) => node.isConnected), "Failed catalogue refresh must not unmount the pending command").toBe(true);
  await expect(retry).toBeEnabled();
  await expect(ui.station).toBeDisabled();
  await expect(ui.station).toHaveValue(station.id);
  await expect(ui.confirmation.getByLabel("Profile action reason (required)", { exact: true })).toBeDisabled();
  await expect(ui.confirmation.getByLabel("Profile action reason (required)", { exact: true })).toHaveValue("configuration");
  await expect(ui.confirmation.getByLabel("Profile action note", { exact: true })).toBeDisabled();
  await expect(ui.confirmation.getByLabel("Profile action note", { exact: true })).toHaveValue(retryNote);
  await expect(ui.confirmation.getByRole("button", { name: "Cancel profile action", exact: true })).toBeDisabled();
  for (const name of ["Raster width", "Raster height", "Horizontal offset", "Raster direction", "Stock asset reference", "Synthetic profile — tests and previews only"]) {
    await expect(ui.editor.getByLabel(name, { exact: true })).toBeDisabled();
  }
  await expect(ui.editor.getByLabel("Raster width", { exact: true })).toHaveValue("608");
  await expect(ui.editor.getByLabel("Raster height", { exact: true })).toHaveValue("368");
  await expect(ui.region.getByRole("button", { name: "Preview Name Label", exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalOverflow(page);
  await retry.focus();
  await expect(retry).toBeFocused();
  await ui.confirmation.screenshot({ path: info.outputPath("label-profile-frozen-retry-390.png") });
  failCatalogue = false; // UI still has a failed catalogue; the frozen retry must remain usable.
  const replay = await submit(page, "configure", true);
  expect(submitted).toHaveLength(2);
  expect(submitted[1]).toEqual(submitted[0]);
  expect(replay.mutation).toEqual(submitted[0]);
  expect(replay.result).toEqual({ ...committed, replayed: true });
  await assertAudit(db, state.users.admin.id, submitted[0], replay.result);
  const versions = await db.collection("checkin_label_profiles").getFullList({ filter: db.filter("station = {:station} && version > {:version}", { station: station.id, version: baseline?.version ?? 0 }) });
  expect(versions).toHaveLength(1);
  expect(versions[0].id).toBe(committed.profile.id);
  expect(await approvals(db, committed.profile.id)).toEqual([]);
  expect((await catalogue(page)).profiles.find((profile) => profile.stationId === station.id)).toEqual(committed.profile);
  await page.reload();
  await selectStation(page, station.id);
  await expect(ui.editor.getByLabel("Raster width", { exact: true })).toHaveValue("608");
  await expect(ui.editor.getByLabel("Horizontal offset", { exact: true })).toHaveValue("2");
});
