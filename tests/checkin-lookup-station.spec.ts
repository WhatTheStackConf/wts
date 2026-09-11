import { test, expect, login } from "./checkin-fixtures";
import { arrivalPrerequisites, bindArrivalPhone } from "./checkin-arrival-fixture";
import type { Page } from "@playwright/test";

const lookup = (page: Page) => page.getByRole("region", { name: "Find attendee", exact: true });
const cameraHeld = (page: Page) => page.getByRole("region", { name: "Held camera arrival", exact: true });
const hold = (page: Page) => page.evaluate(() => localStorage.getItem("wts.checkin.lookup.held-operation"));
async function search(page: Page, query: string, name: string) {
  await lookup(page).getByRole("button", { name: "Open attendee lookup", exact: true }).click();
  await page.getByLabel("Attendee name or email", { exact: true }).fill(query);
  await lookup(page).getByRole("button", { name: "Search attendees", exact: true }).click();
  await expect(lookup(page).getByRole("button", { name: "Confirm check-in", exact: true })).toHaveCount(0);
  await lookup(page).getByRole("button", { name: `Select ${name}`, exact: true }).click();
}
async function privateStorage(page: Page) {
  const stored = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
  expect(stored).not.toMatch(/private-arrival|A-TEST|A-LOOK|Ана|qrIdentity|O’Neill/);
}

for (const scenario of ["name", "email committed response lost", "affiliation reload blank", "handoff storage failure"] as const) {
  test(`station lookup ${scenario}: actual authenticated lookup and durable handoff`, async ({ page, db, state, actorPage }) => {
    test.setTimeout(120000);
    await login(page, state.users.admin);
    const setup = await arrivalPrerequisites(page, db);
    const phone = await actorPage(state.users.operator);
    const submissions: any[] = [];
    const errors: string[] = [];
    const urls: string[] = [];
    phone.on("pageerror", error => errors.push(error.message));
    phone.on("request", request => {
      urls.push(request.url());
      if (request.url().endsWith("/api/checkin-lookup")) {
        const body = request.postDataJSON();
        if (["confirm", "recover"].includes(body.operation)) submissions.push(body);
      }
    });
    async function fault(mode: string) {
      const response = await fetch(`${state.upstreamURL}/__test/control`, { method: "POST", headers: { Authorization: `Bearer ${state.upstreamToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ synthetic: true, forbiddenEffects: 0 });
    }
    try {
      await bindArrivalPhone(phone, setup.stations[0].provisionCode, setup.events[1].id);
      await phone.setViewportSize({ width: 320, height: 800 });
      const handoffFailure = scenario === "handoff storage failure";
      const failedRead = scenario === "affiliation reload blank";
      const lost = scenario === "email committed response lost";
      const attendeeId = handoffFailure ? "902" : failedRead ? "915" : lost ? "906" : "911";
      const name = handoffFailure ? "Synthetic Missing affiliation" : failedRead ? "Synthetic Lookup affiliation" : lost ? "Synthetic Response loss" : "Ана Lookup only";
      await search(phone, lost ? "private-arrival@example.test" : name, name);
      expect(submissions).toHaveLength(0);
      await expect(phone.getByRole("button", { name: "Validate arrival", exact: true })).toBeDisabled();
      await expect(phone.getByRole("button", { name: "Start attendee camera", exact: true })).toBeDisabled();
      await privateStorage(phone);
      if (failedRead) await fault("affiliation_failure");
      if (handoffFailure) await phone.evaluate(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key: string, value: string) {
          if (key.startsWith("wts:camera-held:")) throw new DOMException("Synthetic receiving queue failure", "SecurityError");
          return original.call(this, key, value);
        };
        (window as any).__restoreLookupStorage = () => { Storage.prototype.setItem = original; };
      });
      let committed: any;
      if (lost) await phone.route("**/api/checkin-lookup", async route => {
        if (route.request().postDataJSON()?.operation !== "confirm") return route.continue();
        const response = await route.fetch();
        expect(response.status(), await response.text()).toBe(200);
        committed = await response.json();
        expect(committed.state).toBe("reserved");
        await route.abort("failed");
      });
      await lookup(phone).getByRole("button", { name: "Confirm check-in", exact: true }).click();
      if (handoffFailure) {
        // Unknown is set before the request finishes. Keep the fault installed
        // until the receiving queue actually rejects the committed handoff.
        await expect(lookup(phone).getByRole("alert")).toContainText("Lookup unavailable. Retry the same request.");
        await expect(lookup(phone).getByRole("button", { name: "Retry same confirmation", exact: true })).toBeEnabled();
        await expect(lookup(phone)).toContainText("outcome is unknown");
        expect(await hold(phone)).toBe(submissions[0].input.operationId);
        await expect(cameraHeld(phone)).not.toContainText("attendee held");
        await phone.evaluate(() => (window as any).__restoreLookupStorage());
        await lookup(phone).getByRole("button", { name: "Retry same confirmation", exact: true }).click();
        await expect.poll(() => submissions.length).toBe(2);
        expect(submissions[1]).toEqual(submissions[0]);
      }
      if (lost || failedRead) {
        if (lost) await expect(lookup(phone)).toContainText("outcome is unknown");
        else await expect(lookup(phone).getByRole("button", { name: "Continue with blank affiliation", exact: true })).toBeEnabled();
        const original = await hold(phone);
        expect(original).toBe(submissions[0].input.operationId);
        await privateStorage(phone);
        await phone.reload();
        await phone.getByRole("button", { name: "Review held scan", exact: true }).click();
        await expect(lookup(phone)).toContainText(original!);
        await expect(lookup(phone)).not.toContainText("private-arrival@example.test");
        await lookup(phone).getByRole("button", { name: "Recover held lookup", exact: true }).click();
        if (failedRead) {
          await expect(lookup(phone)).toContainText("Saved lookup state: needs_affiliation_choice");
          expect(await hold(phone)).toBe(original);
          await fault("complete");
          const recoveryBodies: string[] = [];
          await phone.route("**/api/checkin-lookup", async route => {
            if (route.request().postDataJSON()?.operation !== "recover") return route.continue();
            recoveryBodies.push(route.request().postData()!);
            if (recoveryBodies.length !== 1) return route.continue();
            const saved = await route.fetch();
            expect(saved.status(), await saved.text()).toBe(200);
            expect(await saved.json()).toMatchObject({ state: "reserved" });
            await route.abort("failed");
          });
          await lookup(phone).getByRole("button", { name: "Continue with blank affiliation", exact: true }).click();
          await expect(lookup(phone)).toContainText("outcome is unknown");
          await lookup(phone).getByRole("button", { name: "Retry same recovery", exact: true }).click();
          await expect.poll(() => submissions.length).toBe(3);
          expect(submissions[2]).toEqual(submissions[1]);
          expect(recoveryBodies[1]).toBe(recoveryBodies[0]);
          expect(submissions[1]).toEqual({ operation: "recover", input: { operationId: original, action: "blank", nextOperationId: submissions[1].input.nextOperationId } });
          expect(submissions[1].input.nextOperationId).not.toBe(original);
        } else expect(submissions).toHaveLength(1);
      }
      await expect(cameraHeld(phone)).toContainText("Arrival reserved");
      await expect(cameraHeld(phone)).toContainText(name);
      await expect.poll(() => hold(phone)).toBeNull();
      const work = await db.collection("checkin_arrival_workflows").getFullList({ filter: `event_id = "${setup.events[1].id}" && upstream_attendee_id = "${attendeeId}"` });
      expect(work).toHaveLength(1);
      if (lost) expect(work[0].id).toBe(committed.workflow.id);
      if (failedRead) expect(work[0].affiliation).toBe("");
      const reference = await phone.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("wts:camera-held:")));
      expect(reference).toHaveLength(1);
      expect(reference[0][1]).toBe(failedRead ? submissions[1].input.nextOperationId : submissions[0].input.operationId);
      await phone.reload();
      await phone.getByRole("button", { name: "Review held scan", exact: true }).click();
      await expect(cameraHeld(phone)).toContainText(name);
      await privateStorage(phone);
      expect(urls.some(url => /private-arrival|%40/.test(url))).toBe(false);
      expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await fault("complete"); await setup.cleanup(); }
  });
}
