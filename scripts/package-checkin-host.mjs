#!/usr/bin/env node
/** Build after `pnpm build:checkin-runtime`. No repository state/config is copied. */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { isBuiltin, createRequire } from "node:module";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { vendorSerialLibrary } from "./checkin-serial-vendor.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const entries = ["runtime/checkin/cli.js", "runtime/checkin/print-host.js"];
const pinnedSerialport = "13.0.0";

const packageName = specifier => specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];

const createsRequire = node => node.type === "VariableDeclarator" && node.id.type === "Identifier" && node.init?.type === "CallExpression" && node.init.callee.name === "createRequire";
const requireCall = (callee, requireNames) => callee.type === "Identifier" && requireNames.has(callee.name) || callee.type === "MemberExpression" && requireNames.has(callee.object.name) && callee.property.name === "resolve";
// fork(new URL('./worker.js', import.meta.url)) is not an ESM import.
const workerUrl = (node, text) => node.callee.name === "URL" && node.arguments[1] && text.slice(node.arguments[1].start, node.arguments[1].end) === "import.meta.url";
const declarationSource = node => node.source ? [node.source] : [];
const MODULE_REFERENCES = {
  ImportDeclaration: declarationSource,
  ExportNamedDeclaration: declarationSource,
  ExportAllDeclaration: declarationSource,
  ImportExpression: node => [node.source],
  CallExpression: (node, requireNames) => requireCall(node.callee, requireNames) ? [node.arguments[0]] : [],
  NewExpression: (node, requireNames, text) => workerUrl(node, text) ? [node.arguments[0]] : [],
};
const moduleReferences = (node, requireNames, text) => Object.hasOwn(MODULE_REFERENCES, node.type) ? MODULE_REFERENCES[node.type](node, requireNames, text) : [];

/** Follow emitted ESM imports and URL-based child entrypoints; never copy a tree. */
export async function collectRuntimeGraph(buildRoot) {
  // MDX declares Acorn directly. Resolve from its package, not pnpm's hoisting
  // layout; TypeScript 7 no longer supplies the old JavaScript compiler AST API.
  const { parse } = createRequire(require.resolve("@mdx-js/mdx"))("acorn");
  const root = realpathSync(buildRoot);
  const files = new Set();
  const dependencies = new Set();
  const queue = [...entries];
  while (queue.length) {
    const name = queue.shift();
    if (files.has(name)) continue;
    if (!/^(runtime\/checkin|src\/lib)\/[A-Za-z0-9_./-]+\.js$/.test(name) || name.split("/").includes("..") || /\.(test|spec)\.js$/.test(name)) {
      throw new Error(`Compiled module outside the runtime allowlist: ${name}`);
    }
    const path = join(root, name);
    if (!existsSync(path)) throw new Error(`Missing compiled module: ${name}; run pnpm build:checkin-runtime first`);
    if (!lstatSync(path).isFile() || realpathSync(path) !== path) throw new Error(`Refusing nonregular or symlinked module: ${name}`);
    files.add(name);
    const text = readFileSync(path, "utf8");
    const source = parse(text, { ecmaVersion: "latest", sourceType: "module" });
    function dependency(value) {
      if (!value || value.type !== "Literal" || typeof value.value !== "string") throw new Error(`Nonliteral module reference in ${name}`);
      const specifier = value.value;
      if (isBuiltin(specifier)) return;
      if (specifier.startsWith(".")) {
        const target = resolve(dirname(path), specifier);
        const local = relative(root, target).split(sep).join("/");
        if (isAbsolute(local) || local.startsWith("../")) throw new Error(`Compiled module outside the runtime allowlist: ${local}`);
        queue.push(local);
      } else {
        if (!/^(@[a-z0-9_.-]+\/)?[a-z0-9_.-]+(?:\/[a-zA-Z0-9_./-]+)?$/.test(specifier)) throw new Error(`Unsupported module reference in ${name}`);
        dependencies.add(packageName(specifier));
      }
    }
    const requireNames = new Set(["require"]);
    function visit(node) {
      if (!node || typeof node !== "object") return;
      if (createsRequire(node)) requireNames.add(node.id.name);
      for (const reference of moduleReferences(node, requireNames, text)) dependency(reference);
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === "object") visit(value);
      }
    }
    visit(source);
  }
  return { files: [...files].sort(), dependencies: [...dependencies].sort() };
}

function installedVersion(name) {
  if (name === "serialport") return pinnedSerialport;
  let path = dirname(require.resolve(name));
  while (path !== dirname(path)) {
    const manifest = join(path, "package.json");
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, "utf8"));
      if (pkg.name === name) {
        if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(pkg.version)) throw new Error(`Unpinnable dependency: ${name}`);
        return pkg.version;
      }
    }
    path = dirname(path);
  }
  throw new Error(`Cannot pin installed dependency: ${name}`);
}

function run(command, args, cwd, timeout = 300000) {
  const env = { ...process.env, PATH: `${dirname(process.execPath)}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}` };
  delete env.NODE_PATH;
  delete env.NODE_OPTIONS;
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024 });
  // npm output may contain a configured registry URL. Keep build diagnostics bounded
  // and never echo private environment/configuration or installed credential values.
  if (result.error || result.status !== 0) throw new Error(`${command} ${args[0]} failed (${result.error?.code ?? result.status}); check local npm/native build prerequisites. ${result.stderr?.replace(/https?:\/\/[^\s]+/g, "[registry URL]").slice(-4000) ?? ""}`);
  return result.stdout;
}

const smokeSource = `// Offline, disposable smoke: no device enumeration/open, coordinator or printing.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "bundle-manifest.json"), "utf8"));
for (const dependency of Object.keys(manifest.dependencies)) await import(dependency);
await import(pathToFileURL(join(root, "runtime/checkin/cli.js")).href);
await import(pathToFileURL(join(root, "runtime/checkin/print-host.js")).href);
const { renderNameLabel, SYNTHETIC_LABEL_CONFIG: config } = await import("./src/lib/checkin-label-renderer.js");
const rendered = await renderNameLabel({
  mode: "preview", text: { name: "Тест Example", affiliation: "Offline smoke" },
  profile: { id: "smoke-profile", stationId: "smoke-station", version: 1, approval: "unapproved", config },
  expected: { profileId: "smoke-profile", profileVersion: 1, printerRef: config.printerRef, stockRef: config.stockRef, rendererVersion: config.rendererVersion, fontVersion: config.fontVersion },
});
assert.ok(rendered.pngBase64.startsWith("iVBORw0KGgo"));
assert.equal(rendered.width, 600); assert.equal(rendered.height, 360);
const { ImageEncoder, initClient, loadImageFromBase64 } = await import("@mmote/niimblue-node");
const encoded = await ImageEncoder.encodeImage(await loadImageFromBase64(rendered.pngBase64), "top");
assert.equal(encoded.cols, 600); assert.equal(encoded.rows, 360);
const serialClient = initClient("serial", "/dev/WTS-SMOKE-NEVER-OPENED", false);
assert.equal(typeof serialClient.connect, "function"); // Intentionally never connect.
const temporary = realpathSync(mkdtempSync(join(tmpdir(), "checkin-host-smoke-")));
chmodSync(temporary, 0o700);
function privateJson(path, value) { writeFileSync(path, JSON.stringify(value), { mode: 0o600 }); }
function cli(entry, args) {
  const result = spawnSync(process.execPath, [join(root, "runtime/checkin", entry), ...args], { cwd: temporary, encoding: "utf8", timeout: 15000 });
  assert.equal(result.error, undefined);
  return result;
}
try {
  const stations = [];
  for (const suffix of ["a", "b"]) {
    const stationDir = join(temporary, suffix); mkdirSync(stationDir, { mode: 0o700 });
    const configFile = join(stationDir, "agent.json");
    const journalPath = join(stationDir, "journal.sqlite");
    const agentCredentialFile = join(stationDir, "agent.credential");
    // Format-valid, distinct test-only values; never connect to a coordinator.
    writeFileSync(agentCredentialFile, "wts_agent_" + suffix.repeat(64), { mode: 0o600 });
    privateJson(configFile, {
      identity: { stationId: "smoke-station-" + suffix, agentIdentity: "smoke-agent-" + suffix, printerIdentity: "smoke-printer-" + suffix, journalIdentity: "smoke-journal-" + suffix, profileId: "smoke-profile-" + suffix },
      journalPath, agentCredentialFile, coordinatorUrl: "http://127.0.0.1:1", printerMode: "simulated",
    });
    const first = cli("cli.js", ["init-agent", configFile]);
    assert.equal(first.status, 0, "explicit fresh journal provisioning must succeed: " + first.stderr);
    assert.ok(existsSync(journalPath));
    const before = readFileSync(journalPath);
    assert.equal(cli("cli.js", ["init-agent", configFile]).status, 78, "existing journal must not be replaced");
    assert.deepEqual(readFileSync(journalPath), before);
    stations.push({ configFile });
  }
  const host = join(temporary, "host.json"); privateJson(host, { version: 1, stations });
  const journals = ["a", "b"].map(suffix => join(temporary, suffix, "journal.sqlite"));
  const snapshots = journals.map(path => readFileSync(path));
  const checked = cli("print-host.js", ["check", host]);
  assert.equal(checked.status, 0, "offline simulated host check must succeed: " + checked.stderr);
  journals.forEach((path, index) => assert.deepEqual(readFileSync(path), snapshots[index], "check must not mutate journals"));
  const invalid = join(temporary, "invalid.json"); privateJson(invalid, { version: 1, stations: [], unknown: true });
  assert.equal(cli("print-host.js", ["check", invalid]).status, 78, "invalid host must fail closed");
  unlinkSync(journals[0]);
  assert.equal(cli("print-host.js", ["check", host]).status, 78, "missing journal must fail closed");
  assert.equal(existsSync(journals[0]), false, "check must never create a replacement journal");
  console.log(JSON.stringify({ status: "ok", platform: process.platform, arch: process.arch, node: process.version, dependencies: Object.keys(manifest.dependencies).length, stations: 2, renderer: "bundled-font-preview", hardware: "not exercised", network: "not exercised" }));
} finally { rmSync(temporary, { recursive: true, force: true }); }
`;

export async function packageCheckinHost() {
  const build = join(repository, ".output/checkin-runtime");
  const graph = await collectRuntimeGraph(build);
  // Fail closed for stale tsc products in a shared checkout.
  for (const name of graph.files) {
    const source = join(repository, name.replace(/\.js$/, ".ts"));
    if (!existsSync(source) || lstatSync(source).mtimeMs > lstatSync(join(build, name)).mtimeMs) throw new Error(`Stale compiled module: ${name}; run pnpm build:checkin-runtime`);
  }
  const dependencies = Object.fromEntries(graph.dependencies.map(name => [name, installedVersion(name)]));
  if (dependencies.serialport !== pinnedSerialport) throw new Error("Host must import serialport 13.0.0; rebuild the implemented print host first");
  const output = join(repository, ".output");
  const work = mkdtempSync(join(output, ".checkin-host-build-"));
  const stage = join(work, "checkin-host"); mkdirSync(stage);
  let clean;
  try {
    dependencies["@mmote/niimbluelib"] = vendorSerialLibrary(stage);
    for (const name of graph.files) {
      mkdirSync(dirname(join(stage, name)), { recursive: true });
      copyFileSync(join(build, name), join(stage, name));
    }
    // Fonts are embedded in the compiled font-data module; preserve their license.
    mkdirSync(join(stage, "licenses"));
    copyFileSync(join(repository, "public/fonts/checkin-label/LICENSE"), join(stage, "licenses/Noto-Sans-LICENSE.txt"));
    copyFileSync(join(repository, "docs/checkin-print-host.md"), join(stage, "README.md"));
    const manifest = { name: "wts-checkin-host", version: "1.0.0", private: true, type: "module", engines: { node: ">=22.23.2" }, scripts: { devices: "node runtime/checkin/print-host.js devices", check: "node runtime/checkin/print-host.js check", start: "node runtime/checkin/print-host.js run", smoke: "node smoke.mjs" }, dependencies, overrides: { "@mmote/niimbluelib": "$@mmote/niimbluelib" } };
    writeFileSync(join(stage, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
    writeFileSync(join(stage, "smoke.mjs"), smokeSource);
    const hashes = Object.fromEntries(graph.files.map(name => [name, createHash("sha256").update(readFileSync(join(stage, name))).digest("hex")]));
    writeFileSync(join(stage, "bundle-manifest.json"), JSON.stringify({ format: 1, nodeMinimum: "22.23.2", dependencies, files: hashes }, null, 2) + "\n");
    run("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund", "--registry=https://registry.npmjs.org"], stage);
    const lock = JSON.parse(readFileSync(join(stage, "package-lock.json"), "utf8"));
    if (Object.keys(lock.packages).some(name => /@stoprocent|@capacitor-community/.test(name))) throw new Error("USB-only distribution unexpectedly includes Bluetooth dependencies");
    // Smoke the actual tarball outside the checkout: ancestor node_modules cannot
    // make a missing dependency appear installed. Never ship native node_modules.
    const archive = join(work, "checkin-host.tar.gz");
    run("tar", ["-czf", archive, "-C", work, "checkin-host"], work);
    clean = mkdtempSync(join(tmpdir(), "checkin-host-install-"));
    run("tar", ["-xzf", archive, "-C", clean], clean);
    const installed = join(clean, "checkin-host");
    run("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund", "--registry=https://registry.npmjs.org"], installed);
    const smoke = run(process.execPath, ["smoke.mjs"], installed);
    // Publish only after install and smoke succeeded. These are generated outputs;
    // station configs and journals belong elsewhere and are never accepted inputs.
    const target = join(output, "checkin-host");
    if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error("Refusing symlinked output directory");
    rmSync(target, { recursive: true, force: true }); renameSync(stage, target);
    const targetArchive = join(output, "checkin-host.tar.gz");
    renameSync(archive, targetArchive);
    const sha256 = createHash("sha256").update(readFileSync(targetArchive)).digest("hex");
    writeFileSync(join(output, "checkin-host.tar.gz.sha256"), `${sha256}  checkin-host.tar.gz\n`);
    console.log(smoke.trim());
    console.log(JSON.stringify({ directory: target, archive: targetArchive, sha256, modules: graph.files.length, dependencies }));
  } finally {
    rmSync(work, { recursive: true, force: true });
    if (clean) rmSync(clean, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) { console.error("Usage: node scripts/package-checkin-host.mjs (after pnpm build:checkin-runtime)"); process.exitCode = 1; }
  else await packageCheckinHost().catch(error => { console.error(error.message); process.exitCode = 1; });
}
