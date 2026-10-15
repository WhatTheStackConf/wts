import { defineConfig } from "@playwright/test";
import base from "./playwright.live-qa.config";

export default defineConfig({
  ...base,
  testMatch: "auth-registration.spec.ts",
  outputDir: "test-results/auth-registration",
});
