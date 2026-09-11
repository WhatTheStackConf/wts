// Run: node --test tests/checkin-lifecycle-component.test.mjs
// Isolated browser/component contract test; transport is an explicit test double.
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

let server, browser, origin;
before(async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  server = await createServer({
    configFile: false, root, plugins: [solid({ ssr: false }), tailwindcss(), {
      name: "lifecycle-component-fixture",
      configureServer(server) {
        server.middlewares.use("/lifecycle-fixture", async (_req, res) => {
          res.setHeader("Content-Type", "text/html");
          res.end(await server.transformIndexHtml("/lifecycle-fixture", '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/fixtures/checkin-lifecycle-component.tsx"></script></body></html>'));
        });
      },
    }],
    resolve: { alias: { "~": `${root}/src` } },
    server: { host: "127.0.0.1", port: 0 },
    logLevel: "error",
  });

  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await server?.close(); });

for (const restore of [false, true]) {
  // Register both before yielding; node:test owns their lifetime and after hook.
  void test(`${restore ? "restore generation" : "closure UUID"} survives failed and already-applied reads; focus and narrow layout`, async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.setDefaultTimeout(8000);
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
    // Even an accidental fallback to the production client cannot contact an API.
    await page.route("**/api/**", route => route.abort());
    try {
      expect((await page.goto(`${origin}/lifecycle-fixture${restore ? "?restore" : ""}`))?.ok()).toBe(true);
      const panel = page.getByRole("region", { name: "Edition lifecycle — WTS2026" });
      const refresh = panel.getByRole("button", { name: "Refresh lifecycle", exact: true });
      await panel.getByRole("button", { name: restore ? "Review restore approval" : "Close WTS2026 permanently", exact: true }).click();
      const input = panel.getByLabel("Type WTS2026 exactly to confirm");
      const form = panel.getByRole("form", { name: "Confirm edition lifecycle action" });
      await expect(input).toBeFocused();
      const submit = form.getByRole("button", { name: restore ? "Confirm restore approval" : "Confirm permanent closure", exact: true });
      await expect(submit).toBeDisabled();
      await input.fill("WTS2026");
      await submit.click();
      await expect(panel.getByRole("alert")).toContainText("Outcome unknown");
      const retry = form.getByRole("button", { name: restore ? "Confirm restore approval" : "Retry same closure command", exact: true });
      await expect(retry).toBeEnabled();
      await expect(form.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);
      await page.evaluate(() => { window.lifecycleHarness.failRead = true; });
      await refresh.click();
      await expect(panel.getByRole("alert")).toContainText("state is unavailable");
      await expect(retry).toBeEnabled();
      await page.evaluate(() => { window.lifecycleHarness.failRead = false; });
      await refresh.click();
      await expect(panel.getByRole("alert")).toHaveCount(0);
      await expect(form).toBeVisible();
      await expect(input).toHaveValue("WTS2026");
      if (restore) await expect(panel.getByText("No restore quarantine reported.", { exact: false })).toBeVisible();
      else await expect(panel.getByText("2026-10-19T18:00:00.000Z", { exact: true })).toBeVisible();
      await expect(retry).toBeEnabled();
      await retry.click();
      await expect(form).toHaveCount(0);
      await expect(panel.getByText(restore ? /Restore approval confirmed for this generation/ : /WTS2026 closure confirmed/)).toBeVisible();
      await expect(refresh).toBeFocused();
      const commands = await page.evaluate(() => window.lifecycleHarness.commands);
      expect(commands).toHaveLength(2);
      expect(commands[0]).toBe(commands[1]);
      if (restore) expect(JSON.parse(commands[0]).command).toEqual({ generation: 4, confirmEdition: "WTS2026" });
      else await expect(panel.getByRole("button", { name: "Close WTS2026 permanently", exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } catch (failure) {
      throw new Error(`${failure.message}\nBrowser errors: ${JSON.stringify(errors)}\nDOM: ${await page.locator("body").innerText()}`, { cause: failure });
    } finally { await page.close(); }
  });
}
