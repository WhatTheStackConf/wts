import { readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
const path = process.env.WTS_FEEDBACK_BROWSER_STATE;
const state = path ? JSON.parse(readFileSync(path, "utf8")) : undefined;
if (!state?.disposable || new URL(state.baseURL).hostname !== "127.0.0.1") throw new Error("Use disposable feedback runner --admin");
export default defineConfig({
  testDir: "./tests", testMatch: "feedback-admin.spec.ts", fullyParallel: false, workers: 1, retries: 0,
  forbidOnly: Boolean(process.env.CI), timeout: 60_000, expect: { timeout: 15_000 }, reporter: "list",
  outputDir: "test-results/feedback-admin",
  use: { ...devices["Desktop Chrome"], baseURL: state.baseURL, trace: "off", screenshot: "only-on-failure", serviceWorkers: "block" },
});
