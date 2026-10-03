import { fileURLToPath } from "node:url";
import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { fileRoutes } from "filesystem-routing/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: process.env.VITEST ? [] : [
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
    plugins: [fileURLToPath(new URL("./src/lib/runtime-plugin.ts", import.meta.url))],
    inlineDynamicImports: true,
    routeRules: {
      "/assets/**": { headers: { "cache-control": "public, max-age=31536000, immutable" } },
      "/fonts/**": { headers: { "cache-control": "public, max-age=31536000" } },
    },
  },
  resolve: { alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) } },
});
