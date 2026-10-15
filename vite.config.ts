import { fileURLToPath } from "node:url";
import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { fileRoutes } from "filesystem-routing/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite-plus";
import { markdownContent } from "./scripts/markdown-content";

export default defineConfig({
  envPrefix: ["VITE_", "PUBLIC_"],
  plugins: [
    markdownContent(),
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
    plugins: [fileURLToPath(new URL("./src/lib/public-api-plugin.ts", import.meta.url))],
    // Nitro's second Rolldown pass can emit an undefined namespace export when
    // splitting the Solid SSR/API graph. Keep server imports together until the
    // upstream chunk-linking bug is fixed; client route splitting is unchanged.
    traceDeps: ["harfbuzzjs", "harfbuzzjs*"],
    inlineDynamicImports: true,
    routeRules: {
      "/assets/**": {
        headers: { "cache-control": "public, max-age=31536000, immutable" },
      },
      "/fonts/**": {
        headers: { "cache-control": "public, max-age=31536000" },
      },
      "/bg.webp": {
        headers: { "cache-control": "public, max-age=604800" },
      },
      "/favicon.svg": {
        headers: { "cache-control": "public, max-age=604800" },
      },
      "/llms.txt": {
        headers: { "cache-control": "public, max-age=86400" },
      },
    },
  },
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "runtime/**/*.test.ts"],
  },
  lint: {
    ignorePatterns: [
      "auth/**",
      "blog/**",
      ".audit/**",
      ".hermes/**",
      ".hallmark/**",
      ".impeccable/**",
      ".planning/**",
      ".playwright-mcp/**",
      ".vinxi/**",
      ".nitro/**",
      ".output/**",
      ".scratch/**",
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
      external: ["fsevents", "../pkg", "harfbuzzjs"],
    },
  },
  ssr: {
    noExternal: ["fsevents"],
    external: ["../pkg"],
  },
});
