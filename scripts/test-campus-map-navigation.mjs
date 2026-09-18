// Exercise hydrated routing: fetching the PNG alone cannot catch interception.
import { chromium, expect } from "@playwright/test";

const base = process.env.MAP_BASE || "http://127.0.0.1:3189";
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    try {
      await page.goto(base, { waitUntil: "networkidle" });
      // Prove hydration before following the static asset link.
      await page.getByRole("button", { name: "Campus map", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("button", { name: "Close campus map" }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible();
      await page.getByRole("link", { name: "Open the full-size campus map", exact: true }).click();
      await expect.poll(() => page.evaluate(() => document.contentType)).toBe("image/png");
      await expect.poll(() => page.locator("img").evaluate(image => image.complete && image.naturalWidth)).toBe(2005);
      console.log(`PASS hydrated map picture navigation at ${width}px`);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
