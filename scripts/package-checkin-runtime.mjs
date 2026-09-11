import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const runtimeDirectory = ".output/checkin-runtime";
const requiredFiles = [
  "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
  "scripts/package-checkin-runtime.mjs", "scripts/verify-checkin-runtime.mjs",
  "deployment/systemd/wts-checkin-agent.service", "deployment/systemd/wts-checkin-coordinator.service",
  "deployment/systemd/wts-checkin-maintenance.service",
  "docs/checkin-station-agents.md", "docs/checkin-central-maintenance.md", "docs/checkin-lifecycle-retention.md",
  "docs/checkin-coordinator-processors.md", "docs/checkin-operations-and-acceptance.md",
];
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
async function regularFile(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Release input must be a regular file");
  return path;
}
async function runtimeFiles(root, directory) {
  const found = [];
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const name = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Runtime symlinks cannot be packaged");
    if (entry.isDirectory()) found.push(...await runtimeFiles(root, name));
    else if (entry.isFile() && entry.name.endsWith(".js") && !entry.name.endsWith(".test.js")) found.push(name);
  }
  return found;
}

/** Fixed allowlist: never copies .env, credentials, node_modules or PocketBase data. */
export async function packageRuntime(source, destination) {
  source = resolve(source); destination = resolve(destination);
  if (destination === source || source.startsWith(destination + sep)) throw new Error("Invalid release destination");
  const selected = [...requiredFiles, ...await runtimeFiles(source, runtimeDirectory)].sort();
  if (!selected.includes(`${runtimeDirectory}/runtime/checkin/cli.js`)) throw new Error("Compile the check-in runtime before packaging");
  for (const name of selected) await regularFile(join(source, name));
  await mkdir(destination); // Deliberately refuses existing directories; never removes caller data.
  const files = {};
  for (const name of selected) {
    const input = join(source, name), output = join(destination, name);
    await mkdir(dirname(output), { recursive: true });
    await copyFile(input, output);
    files[name] = sha256(await readFile(output));
  }
  const pkg = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
  const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" });
  const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: source, encoding: "utf8" });
  const manifest = {
    formatVersion: 1,
    sourceRevision: revision.status === 0 ? revision.stdout.trim() : null,
    sourceDirty: status.status === 0 ? status.stdout.trim().length > 0 : null,
    artifactDigest: sha256(JSON.stringify(files)),
    recommendedNode: "22.23.2", minimumNode: pkg.engines?.node,
    packageManager: pkg.packageManager,
    nativeDependenciesIncluded: false,
    installInstruction: "Install production dependencies on the matching target architecture/libc with pnpm install --prod --frozen-lockfile, then node scripts/verify-checkin-runtime.mjs. Do not start a service until explicitly provisioned.",
    files,
  };
  await writeFile(join(destination, "checkin-runtime-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

/** Integrity verification only, not a signed-origin or physical-device assertion. */
export async function verifyRuntimeManifest(directory) {
  const root = resolve(directory);
  const manifest = JSON.parse(await readFile(join(root, "checkin-runtime-manifest.json"), "utf8"));
  if (manifest.formatVersion !== 1 || !manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)) throw new Error("Invalid runtime manifest");
  for (const [name, expected] of Object.entries(manifest.files)) {
    const path = resolve(root, name);
    if (isAbsolute(name) || relative(root, path).startsWith("..") || !path.startsWith(root + sep) || !/^[a-f0-9]{64}$/.test(String(expected))) throw new Error("Invalid runtime manifest path");
    // Reject symlink traversal in every directory, not only the leaf file.
    let current = root;
    for (const part of relative(root, path).split(sep)) {
      current = join(current, part);
      if ((await lstat(current)).isSymbolicLink()) throw new Error("Invalid runtime symlink");
    }
    await regularFile(path);
    if (sha256(await readFile(path)) !== expected) throw new Error("Runtime checksum mismatch");
  }
  for (const name of requiredFiles) if (!Object.hasOwn(manifest.files, name)) throw new Error("Incomplete runtime manifest");
  if (!Object.hasOwn(manifest.files, `${runtimeDirectory}/runtime/checkin/cli.js`) || sha256(JSON.stringify(manifest.files)) !== manifest.artifactDigest) throw new Error("Incomplete runtime manifest");
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw new Error("Usage: node scripts/package-checkin-runtime.mjs NEW_DESTINATION_DIRECTORY");
  const source = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const manifest = await packageRuntime(source, process.argv[2]);
  await verifyRuntimeManifest(process.argv[2]);
  console.log(JSON.stringify({ directory: resolve(process.argv[2]), artifactDigest: manifest.artifactDigest, files: Object.keys(manifest.files).length, nativeDependenciesIncluded: false }));
}
