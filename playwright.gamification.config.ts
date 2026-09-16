import { defineConfig } from "@playwright/test";
import liveQaConfig from "./playwright.live-qa.config";

export default defineConfig({
  ...liveQaConfig,
  testMatch: "gamification.spec.ts",
  timeout: 120_000,
  outputDir: "test-results/gamification",
  // Codes and answers are transient private inputs. Capture only explicit safe screenshots.
  use: { ...liveQaConfig.use, actionTimeout: 15_000, trace: "off", screenshot: "off", timezoneId: "Europe/Skopje" },
});
