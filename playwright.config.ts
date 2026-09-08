import { readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// No arbitrary BASE_URL: the runner owns both services and their disposable data.
const statePath = process.env.WTS_CHECKIN_BROWSER_STATE;
const state = statePath ? JSON.parse(readFileSync(statePath, "utf8")) as { baseURL: string; disposable: boolean } : null;
if (state && (!state.disposable || new URL(state.baseURL).hostname !== "127.0.0.1")) {
  throw new Error("Refusing non-disposable browser target");
}
export default defineConfig({
  testDir: "./tests",
  testMatch: "checkin*.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results/checkin",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: state?.baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    serviceWorkers: "block",
  },
});
