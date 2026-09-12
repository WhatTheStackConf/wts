import { readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
const path = process.env.WTS_LIVE_QA_BROWSER_STATE;
const state = path ? JSON.parse(readFileSync(path, "utf8")) as { baseURL: string; disposable: boolean } : undefined;
if (!state?.disposable || new URL(state.baseURL).hostname !== "127.0.0.1") throw new Error("Run pnpm test:live-qa-browser with its disposable fixture.");
export default defineConfig({
  testDir: "./tests", testMatch: "live-qa.spec.ts", fullyParallel: false, workers: 1, retries: 0,
  forbidOnly: Boolean(process.env.CI), timeout: 90_000, expect: { timeout: 15_000 }, reporter: "list",
  outputDir: "test-results/live-qa",
  use: { ...devices["Desktop Chrome"], baseURL: state.baseURL, trace: "retain-on-failure", screenshot: "only-on-failure", serviceWorkers: "block" },
});
