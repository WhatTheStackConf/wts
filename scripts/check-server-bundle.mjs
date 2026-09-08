import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

// Check emitted code, not source: bundlers can report success while generating
// invalid cross-chunk namespace exports that fail only when SSR is imported.
const root = resolve(process.argv[2] ?? ".output/server");
async function modules(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : modules(path);
    return /\.(?:mjs|cjs|js)$/.test(entry.name) ? [path] : [];
  }));
  return paths.flat();
}
const files = await modules(root);
if (files.length === 0) throw new Error(`No server JavaScript found in ${root}`);
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    failed = true;
    console.error(result.error ?? result.stderr);
  }
}
if (failed) process.exitCode = 1;
else console.log(`Server bundle syntax verified (${files.length} JavaScript modules).`);
