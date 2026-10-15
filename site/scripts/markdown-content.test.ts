import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { markdownContent } from "./markdown-content.ts";

type Load = (this: unknown, id: string) => Promise<{ code: string; map: null } | null>;

function fixture(t: test.TestContext, files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "markdown-content-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
}

async function load(id: string) {
  const watched: string[] = [];
  const context = {
    addWatchFile: (file: string) => watched.push(file),
    error: (message: string) => { throw new Error(message); },
  };
  const plugin = markdownContent();
  const result = await (plugin.load as Load).call(context, id);
  return { result, watched };
}

const helloBody = `"use strict";
const {jsx: _jsx, jsxs: _jsxs} = arguments[0];
function _createMdxContent(props) {
  const _components = {
    p: "p",
    strong: "strong",
    ...props.components
  };
  return _jsxs(_components.p, {
    children: [_jsx(_components.strong, {
      children: "Hi"
    }), " | a |"]
  });
}
function MDXContent(props = {}) {
  const {wrapper: MDXLayout} = props.components || ({});
  return MDXLayout ? _jsx(MDXLayout, {
    ...props,
    children: _jsx(_createMdxContent, {
      ...props
    })
  }) : _createMdxContent(props);
}
return {
  default: MDXContent
};
`;

void test("ignores ids without a content query on a markdown file", async t => {
  const root = fixture(t, { "post.md": "---\ntitle: Hello\n---\n" });
  for (const id of [join(root, "post.md"), `${join(root, "post.md")}?raw`, `${join(root, "post.txt")}?content`, `${join(root, "post.mdxx")}?content`]) {
    const { result, watched } = await load(id);
    assert.equal(result, null);
    assert.deepEqual(watched, []);
  }
});

void test("compiles frontmatter title and markdown body into a default export", async t => {
  const root = fixture(t, { "post.md": "---\ntitle: Hello\n---\n\n**Hi** | a |\n" });
  const file = join(root, "post.md");
  const { result, watched } = await load(`${file}?content`);
  assert.deepEqual(watched, [file]);
  assert.deepEqual(result, { code: `export default ${JSON.stringify({ title: "Hello", content: helloBody })};`, map: null });
});

void test("keeps an optional slug and requires one on legal pages", async t => {
  const root = fixture(t, {
    "blog/with-slug.mdx": "---\ntitle: Hello\nslug: hello-world\n---\n\n**Hi** | a |\n",
    "content/pages/terms.md": "---\ntitle: Terms\nslug: terms\n---\n\n**Hi** | a |\n",
    "content/pages/missing.md": "---\ntitle: Missing\n---\n",
    "blog/blank-slug.md": "---\ntitle: Blank\nslug: \"  \"\n---\n",
    "blog/numeric-slug.md": "---\ntitle: Numeric\nslug: 5\n---\n",
  });
  const withSlug = await load(`${join(root, "blog/with-slug.mdx")}?content&x=1`);
  assert.deepEqual(withSlug.result, { code: `export default ${JSON.stringify({ title: "Hello", slug: "hello-world", content: helloBody })};`, map: null });
  const legal = await load(`${join(root, "content/pages/terms.md")}?content`);
  assert.deepEqual(legal.result, { code: `export default ${JSON.stringify({ title: "Terms", slug: "terms", content: helloBody })};`, map: null });
  for (const name of ["content/pages/missing.md", "blog/blank-slug.md", "blog/numeric-slug.md"]) {
    const file = join(root, name);
    await assert.rejects(load(`${file}?content`), { message: `${file}: Frontmatter slug must be a nonempty string.` });
  }
});

void test("rejects a missing, blank or non-string title", async t => {
  const root = fixture(t, {
    "missing.md": "---\nslug: x\n---\n",
    "blank.md": "---\ntitle: \"   \"\n---\n",
    "number.md": "---\ntitle: 7\n---\n",
  });
  for (const name of ["missing.md", "blank.md", "number.md"]) {
    const file = join(root, name);
    await assert.rejects(load(`${file}?content`), { message: `${file}: Frontmatter title must be a nonempty string.` });
  }
});
