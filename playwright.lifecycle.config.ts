import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// A separate runner owns a fresh database: permanent edition closure must never
// poison another browser scenario's fixture or rely on test-file ordering.
export default defineConfig({
  ...base,
  testMatch: "checkin-lifecycle.acceptance.ts",
  outputDir: "test-results/checkin-lifecycle",
});
