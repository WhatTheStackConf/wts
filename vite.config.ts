import { fileURLToPath } from "node:url";
import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { fileRoutes } from "filesystem-routing/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  envPrefix: ["VITE_", "PUBLIC_"],
  plugins: [
    tailwindcss(),
    solid({
      start: { middleware: "./src/middleware.ts" },
      ssr: true,
      serverFunctions: true,
      extensions: [".jsx", ".tsx"],
    }),
    fileRoutes({ httpMethods: true, types: true }),
    nitro({ serverEntry: false }),
  ],
  nitro: {
    preset: "node-server",
    routeRules: {
      "/assets/**": {
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
  },
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
      ".velite": fileURLToPath(new URL("./.velite", import.meta.url)),
    },
  },
  test: {
    environment: "node",
  },
  lint: {
    ignorePatterns: [
      ".nitro/**",
      ".output/**",
      ".scratch/**",
      ".velite/**",
      "dist/**",
      "file-routes.d.ts",
      "node_modules/**",
      "pocketbase/**",
      "public/**",
      "research/**",
      "scripts/**",
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  check: {
    fmt: false,
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
