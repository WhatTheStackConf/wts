import { expect, type Page } from "@playwright/test";
/** Call from the real disposable-app suite AFTER parent wires the panel and
 * generates uncertainty with CheckinMonitoringWorker using test transport.
 * This helper does not mock routes, log in, or produce fixture incidents. */
export async function assertCheckinMonitoringBrowser(page: Page, options: { incidentId: string; foreignIncidentId: string; privateStrings: string[]; emailOutcome: "failed" | "unknown" }) {
  const panel = page.getByRole("region", { name: "Check-in monitoring", exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(`Email delivery: ${options.emailOutcome}`, { exact: false })).toBeVisible();
  await expect(panel.getByText(options.foreignIncidentId, { exact: false })).toHaveCount(0);
  for (const text of options.privateStrings) await expect(panel.getByText(text, { exact: false })).toHaveCount(0);
  await panel.getByRole("button", { name: `Acknowledge incident ${options.incidentId}`, exact: true }).click();
  await expect(panel.getByText("Incident acknowledged. Operational state is unchanged.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(panel.getByRole("button", { name: `Acknowledge incident ${options.incidentId}`, exact: true })).toHaveCount(0);
  await expect(panel.getByText("Operational state is unchanged.", { exact: false }).first()).toBeVisible();
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
}
