/** @type {import('vite').UserConfig} */
import { defineConfig } from "vite";
import solidSvg from "vite-plugin-solid-svg";
import { solidStart } from "@solidjs/start/config";
import { nitroV2Plugin } from "@solidjs/vite-plugin-nitro-2";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [
    solidStart(),
    solidSvg(),
    nitroV2Plugin({
      preset: "node-server",
    }),
  ],
  resolve: {
    alias: {
      ".velite": fileURLToPath(new URL("./.velite", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      external: ["fsevents", "../pkg"],
    },
  },
  ssr: {
    noExternal: ["fsevents"],
    external: ["../pkg"],
  },
});
