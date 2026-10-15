import { readFile } from "node:fs/promises";
import { compile } from "@mdx-js/mdx";
import matter from "gray-matter";
import remarkGfm from "remark-gfm";
import { normalizePath, type Plugin } from "vite";

const nonemptyString = (value: unknown) => typeof value === "string" && value.trim().length > 0;

function contentFilePath(id: string) {
  const queryIndex = id.indexOf("?");
  if (queryIndex === -1) return null;

  const filePath = id.slice(0, queryIndex);
  const query = new URLSearchParams(id.slice(queryIndex + 1));
  return /\.mdx?$/.test(filePath) && query.has("content") ? filePath : null;
}

export function markdownContent(): Plugin {
  return {
    name: "markdown-content",
    enforce: "pre",
    async load(id) {
      const filePath = contentFilePath(id);
      if (filePath === null) return null;

      this.addWatchFile(filePath);
      const { data, content } = matter(await readFile(filePath, "utf8"));
      const { title, slug } = data;
      if (!nonemptyString(title)) {
        this.error(`${filePath}: Frontmatter title must be a nonempty string.`);
      }

      const isLegalPage = normalizePath(filePath).includes("/content/pages/");
      if ((isLegalPage || slug !== undefined) && !nonemptyString(slug)) {
        this.error(`${filePath}: Frontmatter slug must be a nonempty string.`);
      }

      const compiled = await compile(
        { value: content, path: filePath },
        {
          outputFormat: "function-body",
          jsxImportSource: "@solidjs/web",
          remarkPlugins: [remarkGfm],
        },
      );
      return {
        code: `export default ${JSON.stringify({
          title,
          ...(slug === undefined ? {} : { slug }),
          content: String(compiled),
        })};`,
        map: null,
      };
    },
  };
}
