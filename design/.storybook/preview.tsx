import type { Preview } from "storybook-solidjs-vite";
import "../src/styles/storybook.css";
import auth from "../src/styles/auth.css?inline";
import blog from "../src/styles/blog.css?inline";
import cfp from "../src/styles/cfp.css?inline";
import site from "../src/styles/site.css?inline";
import { APP_ROOT_CLASS, type App } from "../src/app";

const STYLES: Record<App, string> = { site, cfp, auth, blog };

/**
 * Each app ships its own global CSS with its own DaisyUI theme.
 * Only the stylesheet of the current story's app stays in the page.
 */
function useApp(app: App): void {
  let tag = document.getElementById("wts-app-css") as HTMLStyleElement | null;
  if (!tag) {
    tag = document.createElement("style");
    tag.id = "wts-app-css";
    document.head.append(tag);
  }
  if (tag.dataset.app !== app) {
    tag.textContent = STYLES[app];
    tag.dataset.app = app;
  }
  document.body.className = APP_ROOT_CLASS[app];
}

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    controls: { expanded: true },
    a11y: { test: "error" },
    options: { storySort: { order: ["Introduction", "Foundations", "Site", "CFP", "Auth", "Blog"] } },
  },
  decorators: [
    (Story, context) => {
      useApp((context.parameters.app as App | undefined) ?? "site");
      return <Story />;
    },
  ],
};

export default preview;
