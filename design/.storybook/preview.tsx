import type { Preview } from "storybook-solidjs-vite";
import "../src/styles/storybook.css";
import auth from "../src/styles/auth.css?inline";
import blog from "../src/styles/blog.css?inline";
import cfp from "../src/styles/cfp.css?inline";
import site from "../src/styles/site.css?inline";
import { APP_ROOT_CLASS, type App } from "../src/app";
import { wtsTheme } from "./theme";

const STYLES: Record<App, string> = { site, cfp, auth, blog };

/** Stories never subscribe anyone: a request to Listmonk gets a local 200 answer. */
const LISTMONK = "https://listmonk.wts.sh";
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  return url.startsWith(LISTMONK) ? Promise.resolve(new Response("{}", { status: 200 })) : realFetch(input, init);
};

/**
 * Each app ships its own global CSS with its own DaisyUI theme.
 * Only the stylesheet of the current story's app stays in the page.
 */
function useApp(app: App): void {
  let tag = document.getElementById("wts-app-css") as HTMLStyleElement | null;
  if (!tag) {
    tag = document.createElement("style");
    tag.id = "wts-app-css";
    // First in <head>, as in production: app CSS loads before the CSS that components import.
    document.head.prepend(tag);
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
    docs: { theme: wtsTheme },
    /* A story is a part of a page, so the page-level landmark and h1 rules do not apply. */
    a11y: {
      test: "error",
      config: { rules: [{ id: "region", enabled: false }, { id: "landmark-one-main", enabled: false }, { id: "page-has-heading-one", enabled: false }] },
    },
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
