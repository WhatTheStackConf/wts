import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

const root = new URL("../", import.meta.url);
const parser = unified().use(remarkParse).use(remarkGfm);
let sequence = 0;
const key = () => `wts-${++sequence}`;

function inline(nodes, marks = [], markDefs = []) {
  return nodes.flatMap((node) => {
    switch (node.type) {
      case "text":
      case "inlineCode":
        return [{ _type: "span", _key: key(), text: node.value, marks: node.type === "inlineCode" ? [...marks, "code"] : marks }];
      case "strong":
      case "emphasis":
      case "delete":
        return inline(node.children, [...marks, { strong: "strong", emphasis: "em", delete: "strike-through" }[node.type]], markDefs);
      case "link": {
        const id = key();
        markDefs.push({ _type: "link", _key: id, href: node.url });
        return inline(node.children, [...marks, id], markDefs);
      }
      case "break":
        return [{ _type: "span", _key: key(), text: "\n", marks }];
      default:
        throw new Error(`Unsupported inline Markdown node: ${node.type}`);
    }
  });
}

function textBlock(node, properties = {}) {
  const markDefs = [];
  const children = inline(node.children, [], markDefs);
  return { _type: "block", _key: key(), style: "normal", ...properties, markDefs, children };
}

function blocks(nodes, listProperties = {}) {
  return nodes.flatMap((node) => {
    switch (node.type) {
      case "heading":
        return [textBlock(node, { style: `h${node.depth}` })];
      case "paragraph":
        if (node.children.length === 1 && node.children[0].type === "image") {
          const image = node.children[0];
          if (image.url !== "/blog/iceberg-meme.jpg") throw new Error(`Unknown source image: ${image.url}`);
          return [{ _type: "image", _key: key(), alt: image.alt, asset: { $media: {
            url: "https://raw.githubusercontent.com/WhatTheStackConf/wts/75718cb297362deaaf4d8993aac4036c999b63f6/public/blog/iceberg-meme.jpg",
            filename: "iceberg-meme.jpg", alt: image.alt,
          } } }];
        }
        return [textBlock(node, listProperties)];
      case "list":
        return node.children.flatMap((item) => blocks(item.children, { listItem: node.ordered ? "number" : "bullet", level: (listProperties.level ?? 0) + 1 }));
      case "table":
        return [{ _type: "table", _key: key(), hasHeaderRow: true, rows: node.children.map((row, index) => ({
          _type: "tableRow", _key: key(), cells: row.children.map((cell, column) => {
            const markDefs = [];
            return { _type: "tableCell", _key: key(), isHeader: index === 0, content: inline(cell.children, [], markDefs), markDefs, ...(node.align[column] ? { textAlign: node.align[column] } : {}) };
          }),
        })) }];
      default:
        throw new Error(`Unsupported Markdown block: ${node.type}`);
    }
  });
}

const posts = [];
const publicationDates = {};
for (const filename of (await readdir(new URL("seed/source/", root))).filter((name) => name.endsWith(".md")).sort()) {
  const { data, content } = matter(await readFile(new URL(`seed/source/${filename}`, root), "utf8"));
  const date = data.date instanceof Date ? data.date.toISOString() : new Date(`${data.date}T00:00:00.000Z`).toISOString();
  publicationDates[data.slug] = date;
  posts.push({ id: `post-${data.slug}`, slug: data.slug, status: "published", data: {
    title: data.title, excerpt: data.excerpt, content: blocks(parser.parse(content).children),
  }, bylines: [{ byline: "darko-from-wts" }] });
}

const seed = {
  $schema: "https://emdashcms.com/seed.schema.json", version: "1", defaultLocale: "en",
  meta: { name: "WTS Blog", description: "Original WhatTheStack posts with the 2027 public theme", author: "WhatTheStack" },
  settings: { title: "WTS Blog", tagline: "Stories, updates, and ideas from the WhatTheStack community.", url: "https://blog.wts.sh", dateFormat: "yyyy-MM-dd", timezone: "Europe/Skopje" },
  collections: [
    { slug: "posts", label: "Posts", labelSingular: "Post", urlPattern: "/posts/{slug}", supports: ["drafts", "revisions", "preview", "scheduling", "search", "seo"], commentsEnabled: false, fields: [
      { slug: "title", label: "Title", type: "string", required: true, searchable: true },
      { slug: "featured_image", label: "Featured image", type: "image" },
      { slug: "content", label: "Content", type: "portableText", searchable: true },
      { slug: "excerpt", label: "Excerpt", type: "text" },
    ] },
    { slug: "pages", label: "Pages", labelSingular: "Page", urlPattern: "/pages/{slug}", supports: ["drafts", "revisions", "preview", "search", "seo"], fields: [
      { slug: "title", label: "Title", type: "string", required: true, searchable: true },
      { slug: "content", label: "Content", type: "portableText", searchable: true },
    ] },
  ],
  taxonomies: [
    { name: "category", label: "Categories", labelSingular: "Category", hierarchical: true, collections: ["posts"], terms: [] },
    { name: "tag", label: "Tags", labelSingular: "Tag", hierarchical: false, collections: ["posts"], terms: [] },
  ],
  bylines: [{ id: "darko-from-wts", slug: "darko-from-whatthe-stack", displayName: "Darko from WhatTheStack" }],
  menus: [{ name: "primary", label: "Primary navigation", items: [
    { type: "custom", label: "Blog", url: "/" },
    { type: "custom", label: "All posts", url: "/posts" },
    { type: "custom", label: "Conference", url: "https://wts.sh" },
  ] }],
  widgetAreas: [{ name: "sidebar", label: "Sidebar", widgets: [{ type: "component", componentId: "core:search", title: "Search" }] }, { name: "footer", label: "Footer", widgets: [] }],
  redirects: posts.map((post) => ({ source: `/blog/${post.slug}`, destination: `/posts/${post.slug}`, type: 301, enabled: true })),
  content: { posts, pages: [] },
};
await writeFile(new URL("seed/seed.json", root), `${JSON.stringify(seed, null, 2)}\n`);
await writeFile(new URL("seed/publication-dates.json", root), `${JSON.stringify(publicationDates, null, 2)}\n`);
console.log(`Generated ${posts.length} original posts in ${fileURLToPath(new URL("seed/seed.json", root))}.`);
