# Content

Use this when changing Markdown, MDX, conference facts, or content-driven routes.

- Keep legal Markdown files under `content/pages/`.
- Keep the protected speaker guide in `content/speaker-guide.mdx`.
- Import Markdown with the explicit `?content` query. Vite compiles these imports through `scripts/markdown-content.ts`.
- Provide a nonempty title in YAML frontmatter. Legal pages also require a nonempty slug.
- Keep legal page imports in `src/lib/markdown-pages.ts`.
- Import conference facts from `content/conference-guide.json` through `src/lib/conference-guide-content.ts`.
- Keep conference fact validation and its type in `src/lib/conference-guide-schema.ts`.
- Keep speaker guide content behind the existing server function and password check.
- The blog lives at `https://blog.wts.sh`. This app only links to it.
