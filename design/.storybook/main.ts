import { readFileSync } from "node:fs";
import type { StorybookConfig } from "storybook-solidjs-vite";

const managerHeadExtra = readFileSync(new URL("./manager-head.html", import.meta.url), "utf8");

const config: StorybookConfig = {
  framework: { name: "storybook-solidjs-vite", options: { docgen: false } },
  stories: ["../src/**/*.mdx", "../src/**/*.stories.tsx"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  staticDirs: [
    { from: "../../site/public/fonts", to: "/fonts" },
    { from: "../../site/public/fonts", to: "/assets/fonts" },
    { from: "../../auth/public", to: "/assets" },
  ],
  core: { disableTelemetry: true },
  /* Stories take no args, so the args panels stay empty. Paper is the only page background. */
  features: { controls: false, actions: false, interactions: false, backgrounds: false },
  managerHead: (head) => `${head ?? ""}${managerHeadExtra}`,
};

export default config;
