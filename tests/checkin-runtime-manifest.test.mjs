import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { verifyRuntimeManifest } from "../scripts/package-checkin-runtime.mjs";

const sha256 = text => createHash("sha256").update(text).digest("hex");
const cli = ".output/checkin-runtime/runtime/checkin/cli.js";
const required = [
  "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
  "scripts/package-checkin-runtime.mjs", "scripts/verify-checkin-runtime.mjs",
  "deployment/systemd/wts-checkin-agent.service", "deployment/systemd/wts-checkin-coordinator.service",
  "deployment/systemd/wts-checkin-maintenance.service",
  "docs/checkin-station-agents.md", "docs/checkin-central-maintenance.md", "docs/checkin-lifecycle-retention.md",
  "docs/checkin-coordinator-processors.md", "docs/checkin-operations-and-acceptance.md",
];

function release(t, change = manifest => manifest) {
  const root = mkdtempSync(join(tmpdir(), "checkin-runtime-manifest-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = {};
  for (const name of [...required, cli]) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), `synthetic ${name}\n`);
    files[name] = sha256(`synthetic ${name}\n`);
  }
  const manifest = change({ formatVersion: 1, artifactDigest: sha256(JSON.stringify(files)), files });
  writeFileSync(join(root, "checkin-runtime-manifest.json"), JSON.stringify(manifest));
  return { root, manifest };
}
const withFiles = (files, digest) => manifest => ({ ...manifest, files, artifactDigest: digest ? sha256(JSON.stringify(files)) : manifest.artifactDigest });

void test("returns the verified manifest for a complete release", async t => {
  const { root, manifest } = release(t);
  assert.deepEqual(await verifyRuntimeManifest(root), manifest);
});

void test("rejects malformed manifest envelopes", async t => {
  for (const change of [m => ({ ...m, formatVersion: 2 }), m => ({ ...m, files: undefined }), m => ({ ...m, files: [] }), m => ({ ...m, files: "x" }), m => ({ ...m, files: null })]) {
    const { root } = release(t, change);
    await assert.rejects(verifyRuntimeManifest(root), { message: "Invalid runtime manifest" });
  }
});

void test("rejects escaping paths and malformed checksums before reading files", async t => {
  for (const [name, expected] of [["/etc/hostname", "a".repeat(64)], ["../outside.js", "a".repeat(64)], ["docs/../../outside.js", "a".repeat(64)], ["package.json", "A".repeat(64)], ["package.json", "abc"], ["package.json", 7]]) {
    const { root } = release(t, m => ({ ...m, files: { ...m.files, [name]: expected } }));
    await assert.rejects(verifyRuntimeManifest(root), { message: "Invalid runtime manifest path" });
  }
});

void test("rejects symlinks in any path segment, nonregular files, missing files and checksum drift", async t => {
  const linkedDirectory = release(t, m => ({ ...m, files: { "linked/package.json": m.files["package.json"], ...m.files } }));
  symlinkSync(linkedDirectory.root, join(linkedDirectory.root, "linked"));
  await assert.rejects(verifyRuntimeManifest(linkedDirectory.root), { message: "Invalid runtime symlink" });

  const linkedLeaf = release(t, m => ({ ...m, files: { "leaf.json": m.files["package.json"], ...m.files } }));
  symlinkSync(join(linkedLeaf.root, "package.json"), join(linkedLeaf.root, "leaf.json"));
  await assert.rejects(verifyRuntimeManifest(linkedLeaf.root), { message: "Invalid runtime symlink" });

  const directory = release(t, m => ({ ...m, files: { docs: "a".repeat(64), ...m.files } }));
  await assert.rejects(verifyRuntimeManifest(directory.root), { message: "Release input must be a regular file" });

  const missing = release(t, m => ({ ...m, files: { "absent.js": "a".repeat(64), ...m.files } }));
  await assert.rejects(verifyRuntimeManifest(missing.root), { code: "ENOENT" });

  const drift = release(t);
  writeFileSync(join(drift.root, "package.json"), "changed\n");
  await assert.rejects(verifyRuntimeManifest(drift.root), { message: "Runtime checksum mismatch" });
});

void test("requires every release file, the runtime entrypoint and the artifact digest", async t => {
  const changes = [
    m => { const files = { ...m.files }; delete files["docs/checkin-operations-and-acceptance.md"]; return withFiles(files, true)(m); },
    m => { const files = { ...m.files }; delete files[cli]; return withFiles(files, true)(m); },
    m => ({ ...m, artifactDigest: sha256("different") }),
    m => ({ ...m, artifactDigest: undefined }),
  ];
  for (const change of changes) {
    const { root } = release(t, change);
    await assert.rejects(verifyRuntimeManifest(root), { message: "Incomplete runtime manifest" });
  }
});

void test("checks file entries before release completeness", async t => {
  const { root } = release(t, m => { const files = { "../outside.js": "a".repeat(64), ...m.files }; delete files["package.json"]; return { ...m, files }; });
  await assert.rejects(verifyRuntimeManifest(root), { message: "Invalid runtime manifest path" });
});
