import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";

export default defineConfig({
	site: "https://blog.wts.sh",
	output: "server",
	adapter: node({
		mode: "standalone",
	}),
	image: {
		layout: "constrained",
		responsiveStyles: true,
	},
	vite: {
		ssr: {
			noExternal: [
				"zod",
				"entities",
				"@modelcontextprotocol/sdk",
				/^prosemirror-/,
			],
		},
	},
	integrations: [
		react(),
		emdash({
			database: sqlite({
				url: `file:${process.env.DATABASE_PATH || "./data.db"}`,
			}),
			storage: local({
				directory: process.env.UPLOADS_DIRECTORY || "./uploads",
				baseUrl: "/_emdash/api/media/file",
			}),
		}),
	],
	devToolbar: { enabled: false },
});
