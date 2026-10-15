import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { collectRuntimeGraph } from "../scripts/package-checkin-host.mjs";

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), "checkin-package-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
}

void test("distribution follows imports and worker URLs, not the build directory contents", async t => {
  const root = fixture(t, {
    "runtime/checkin/print-host.js": 'import "node:fs"; import "serialport"; new URL("./worker.js", import.meta.url);',
    "runtime/checkin/worker.js": 'export { x } from "../../src/lib/helper.js";',
    "runtime/checkin/cli.js": 'import "pocketbase";',
    "src/lib/helper.js": 'import "@mmote/niimblue-node"; export const x = () => import("zod");',
    "runtime/checkin/secret.json": '{"must":"not ship"}',
    "runtime/checkin/stale.test.js": 'import "vite-plus/test";',
    "runtime/checkin/unreferenced.js": 'import "unwanted-dependency";',
  });
  const graph = await collectRuntimeGraph(root);
  assert.deepEqual(graph.files, ["runtime/checkin/cli.js", "runtime/checkin/print-host.js", "runtime/checkin/worker.js", "src/lib/helper.js"]);
  assert.deepEqual(graph.dependencies, ["@mmote/niimblue-node", "pocketbase", "serialport", "zod"]);
});

void test("distribution recognizes prefix-only built-ins on the supported Node 22 baseline", async t => {
  const root = fixture(t, {
    "runtime/checkin/cli.js": 'import { DatabaseSync } from "node:sqlite";',
    "runtime/checkin/print-host.js": 'import "node:test"; import "node:fs";',
  });
  assert.deepEqual((await collectRuntimeGraph(root)).dependencies, []);
});

void test("distribution refuses missing host output rather than packaging an old agent-only build", async t => {
  const root = fixture(t, { "runtime/checkin/cli.js": "export {};" });
  await assert.rejects(() => collectRuntimeGraph(root), /Missing compiled module/);
});

void test("distribution refuses symlinked modules and import paths outside its allowlist", async t => {
  const root = fixture(t, {
    "runtime/checkin/cli.js": "export {};",
    "runtime/checkin/print-host.js": 'import "../../private.js";',
    "private.js": "export {};",
  });
  await assert.rejects(() => collectRuntimeGraph(root), /outside the runtime allowlist/);
  writeFileSync(join(root, "runtime/checkin/print-host.js"), 'import "./linked.js";');
  symlinkSync(join(root, "private.js"), join(root, "runtime/checkin/linked.js"));
  await assert.rejects(() => collectRuntimeGraph(root), /symlink/);
});

void test("distribution discovers package-local createRequire dependencies", async t => {
  const root = fixture(t, {
    "runtime/checkin/cli.js": "export {};",
    "runtime/checkin/print-host.js": 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url); const dependencyRequire = createRequire(require.resolve("@mmote/niimbluelib")); dependencyRequire("serialport");',
  });
  assert.deepEqual((await collectRuntimeGraph(root)).dependencies, ["@mmote/niimbluelib", "serialport"]);
});

void test("distribution fails closed for nonliteral dynamic imports", async t => {
  const root = fixture(t, {
    "runtime/checkin/cli.js": "export {};",
    "runtime/checkin/print-host.js": "const name = './hidden.js'; import(name);",
  });
  await assert.rejects(() => collectRuntimeGraph(root), /Nonliteral module/);
});
