/** @type {import('vite').UserConfig} */
import { defineConfig } from "vite";
import solidSvg from "vite-plugin-solid-svg";
import { solidStart } from "@solidjs/start/config";
import { nitroV2Plugin } from "@solidjs/vite-plugin-nitro-2";
import { fileURLToPath } from "node:url";

export default defineConfig({
  envPrefix: ["VITE_", "PUBLIC_"],
  plugins: [
    solidStart({ middleware: "./src/middleware.ts" }),
    solidSvg(),
    nitroV2Plugin({
      preset: "node-server",
      routeRules: {
        "/_build/**": {
          headers: { "cache-control": "public, max-age=31536000, immutable" },
        },
        "/fonts/**": {
          headers: { "cache-control": "public, max-age=31536000" },
        },
        "/blog/iceberg-meme.jpg": {
          headers: { "cache-control": "public, max-age=604800" },
        },
        "/press-kit/**": {
          headers: { "cache-control": "public, max-age=604800" },
        },
        "/static/**": {
          headers: { "cache-control": "public, max-age=604800" },
        },
        "/bg.webp": {
          headers: { "cache-control": "public, max-age=604800" },
        },
        "/bg.png": {
          headers: { "cache-control": "public, max-age=604800" },
        },
        "/favicon.svg": {
          headers: { "cache-control": "public, max-age=604800" },
        },
        "/wts-square-web.webm": {
          headers: { "cache-control": "public, max-age=31536000" },
        },
        "/llms.txt": {
          headers: { "cache-control": "public, max-age=86400" },
        },
        "/wts-community-partnership-2026.pdf": {
          headers: { "cache-control": "public, max-age=604800" },
        },
        "/wts-partnership-proposal-2026.pdf": {
          headers: { "cache-control": "public, max-age=604800" },
        },
      },
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
