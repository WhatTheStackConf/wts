import type { StorybookConfig } from "storybook-solidjs-vite";

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
};

export default config;
