import { fileURLToPath } from "node:url";
import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

const repo = fileURLToPath(new URL("..", import.meta.url));
const APPS = ["site", "cfp"] as const;

/**
 * site and cfp both use the "~" alias for their own src folder.
 * The importer path picks the app, so components from both apps load in one Storybook.
 */
function appAlias(): Plugin {
  return {
    name: "wts:app-alias",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!source.startsWith("~/") || !importer) return null;
      const app = APPS.find((name) => importer.startsWith(`${repo}${name}/`));
      if (!app) return null;
      return this.resolve(`${repo}${app}/src/${source.slice(2)}`, importer, { ...options, skipSelf: true });
    },
  };
}

// Storybook reads this file. The Solid 2 plugin must be here, because the
// storybook-solidjs-vite preset adds the Solid 1 plugin when it finds no plugin named "solid".
export default defineConfig({
  plugins: [appAlias(), tailwindcss(), solid({ ssr: false, extensions: [".jsx", ".tsx"] })],
  resolve: { dedupe: ["solid-js", "@solidjs/web", "@solidjs/router", "@solidjs/meta"] },
  // The newsletter shows its normal form only with a list ID. .storybook/preview.tsx stops every
  // request to Listmonk, so this ID never reaches the real service.
  define: { "import.meta.env.VITE_LISTMONK_LIST_ID": JSON.stringify("storybook") },
});
