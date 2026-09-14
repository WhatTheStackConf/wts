import { defineConfig } from "@playwright/test";
import liveQaConfig from "./playwright.live-qa.config";

// The same isolated production build and real PocketBase fixture cover both
// Q&A invariants and the rest of the signed-in workspace. No live credentials.
export default defineConfig({
  ...liveQaConfig,
  testMatch: ["live-qa.spec.ts", "workspace-usability.spec.ts"],
  outputDir: "test-results/workspace-usability",
});
