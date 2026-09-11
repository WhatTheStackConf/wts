import { afterEach, expect, it } from "vite-plus/test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { packageRuntime, verifyRuntimeManifest } from "../../scripts/package-checkin-runtime.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "wts-package-test-")); roots.push(root);
  const source = join(root, "source"); mkdirSync(source);
  for (const [path, content] of Object.entries({
    "package.json": JSON.stringify({ name: "test-fixture", type: "module", packageManager: "pnpm@11.24.0", engines: { node: ">=22.22.2" }, dependencies: {} }),
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "pnpm-workspace.yaml": "allowBuilds: {}\n",
    ".output/checkin-runtime/runtime/checkin/cli.js": "export const fixture = true;\n",
    ".output/checkin-runtime/src/lib/checkin-label-render-font-data.js": "export const fixtureFont = true;\n",
    ".output/checkin-runtime/runtime/checkin/private.test.js": "throw new Error('test must not ship');\n",
    "scripts/verify-checkin-runtime.mjs": "// fixture verifier\n",
    "scripts/package-checkin-runtime.mjs": "// fixture packager\n",
    "deployment/systemd/wts-checkin-agent.service": "[Service]\n",
    "deployment/systemd/wts-checkin-coordinator.service": "[Service]\n",
    "deployment/systemd/wts-checkin-maintenance.service": "[Service]\n",
    "docs/checkin-station-agents.md": "Fixture runtime instructions\n",
    "docs/checkin-central-maintenance.md": "Fixture maintenance instructions\n",
    "docs/checkin-lifecycle-retention.md": "Fixture lifecycle instructions\n",
    "docs/checkin-coordinator-processors.md": "Fixture processor instructions\n",
    "docs/checkin-operations-and-acceptance.md": "Fixture acceptance instructions\n",
    ".env": "DO_NOT_SHIP=synthetic-secret\n",
    "pocketbase/pb_data/data.db": "synthetic-db-not-for-shipping",
  })) {
    mkdirSync(join(source, path, ".."), { recursive: true }); writeFileSync(join(source, path), content);
  }
  return { source, destination: join(root, "package") };
}
it("packages the complete runtime/font tree with lockfile policy, but no tests, credentials or data", async () => {
  const { source, destination } = fixture();
  const manifest = await packageRuntime(source, destination);
  expect(manifest.files).toHaveProperty(".output/checkin-runtime/runtime/checkin/cli.js");
  expect(manifest.files).toHaveProperty(".output/checkin-runtime/src/lib/checkin-label-render-font-data.js");
  expect(manifest.files).toHaveProperty("pnpm-workspace.yaml");
  expect(manifest.files).toHaveProperty("deployment/systemd/wts-checkin-maintenance.service");
  expect(manifest.files).toHaveProperty("docs/checkin-lifecycle-retention.md");
  expect(manifest.files).not.toHaveProperty(".env");
  expect(manifest.files).not.toHaveProperty(".output/checkin-runtime/runtime/checkin/private.test.js");
  expect(existsSync(join(destination, "pocketbase/pb_data/data.db"))).toBe(false);
  await expect(verifyRuntimeManifest(destination)).resolves.toMatchObject({ formatVersion: 1, nativeDependenciesIncluded: false });
});
it("refuses to overwrite an existing release directory", async () => {
  const { source, destination } = fixture(); mkdirSync(destination); writeFileSync(join(destination, "sentinel"), "keep");
  await expect(packageRuntime(source, destination)).rejects.toThrow();
  expect(readFileSync(join(destination, "sentinel"), "utf8")).toBe("keep");
});
it("detects changed packaged code before runtime verification", async () => {
  const { source, destination } = fixture(); await packageRuntime(source, destination);
  writeFileSync(join(destination, ".output/checkin-runtime/runtime/checkin/cli.js"), "modified");
  await expect(verifyRuntimeManifest(destination)).rejects.toThrow("checksum");
});
