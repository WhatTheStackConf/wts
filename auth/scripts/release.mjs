import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = process.argv[2];
if (!output) throw new Error('Usage: node auth/scripts/release.mjs OUTPUT_DIRECTORY');
const destination = resolve(output);
if (destination === root || destination.startsWith(`${root}/`)) {
  throw new Error('Keep generated release files outside the repository.');
}

async function filesIn(directory, suffixes) {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const groups = await Promise.all(entries.map(async (entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Release input cannot be a symlink: ${path}`);
    if (entry.isDirectory()) return filesIn(path, suffixes);
    return suffixes.some((suffix) => entry.name.endsWith(suffix)) ? [path] : [];
  }));
  return groups.flat();
}

const files = [
  'auth/Dockerfile',
  'auth/package.json',
  'auth/tsconfig.json',
  'auth/scripts/provision-runtime.mjs',
  'public/favicon.svg',
  'public/fonts/space-grotesk-latin.woff2',
  'public/fonts/space-grotesk-latin-ext.woff2',
  ...await filesIn('auth/src', ['.ts']),
  ...await filesIn('auth/migrations', ['.sql']),
  ...await filesIn('auth/public', ['.js', '.css']),
  'src/assets/images/LogoSolo.svg',
].sort();
for (const required of ['auth/src/server.ts', 'auth/src/cli.ts', 'auth/public/account.js', 'auth/public/account.css']) {
  if (!files.includes(required)) throw new Error(`Missing release input: ${required}`);
}
const workspaceFiles = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'];
const sources = await Promise.all([...files, ...workspaceFiles].sort().map(async (path) => ({
  path,
  sha256: createHash('sha256').update(await readFile(join(root, path))).digest('hex'),
})));
const sourceDigest = createHash('sha256').update(JSON.stringify(sources)).digest('hex');
const remoteSources = sources.filter((source) => source.path.startsWith('public/fonts/')).map((source) => ({
  ...source,
  url: `https://wts.sh/${source.path.slice('public/'.length)}`,
}));

function checkedSpawn(result, failure) {
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(failure(result));
  return result;
}

async function exportLockfile(exported) {
  checkedSpawn(spawnSync('pnpm', [
    '--filter', '@wts/auth', 'deploy', '--lockfile-only', '--ignore-scripts', exported,
  ], { cwd: root, maxBuffer: 16 * 1024 * 1024 }), (deployment) => `Release lockfile export failed: ${deployment.stderr.toString()}`);
  const peerConfig = checkedSpawn(spawnSync('pnpm', ['config', 'get', 'autoInstallPeers', '--json'], { cwd: root }), () => 'pnpm could not read the workspace peer setting.');
  const autoInstallPeers = JSON.parse(peerConfig.stdout.toString());
  if (typeof autoInstallPeers !== 'boolean') throw new Error('pnpm did not return a Boolean peer setting.');
  return autoInstallPeers;
}

async function exportedSettings(exported, path) {
  try {
    return await readFile(join(exported, path), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return '';
  }
}

async function workspaceContent(exported, path, autoInstallPeers) {
  if (path !== 'pnpm-workspace.yaml') return readFile(join(exported, path));
  const settings = await exportedSettings(exported, path);
  return Buffer.from(`packages:\n  - .\nautoInstallPeers: ${autoInstallPeers}\n${settings}`);
}

async function writeWorkspaceFiles(exported, archiveRoot, autoInstallPeers) {
  const generatedSources = [];
  for (const path of workspaceFiles) {
    const content = await workspaceContent(exported, path, autoInstallPeers);
    await writeFile(join(archiveRoot, path), content);
    generatedSources.push({ path, sha256: createHash('sha256').update(content).digest('hex') });
  }
  return generatedSources;
}

async function copyEmbeddedFiles(archiveRoot) {
  const embeddedFiles = files.filter((path) =>
    path !== 'auth/Dockerfile' && path !== 'auth/package.json' &&
    !remoteSources.some((source) => source.path === path));
  for (const path of embeddedFiles) {
    await mkdir(dirname(join(archiveRoot, path)), { recursive: true });
    await copyFile(join(root, path), join(archiveRoot, path));
  }
  return embeddedFiles;
}

const workspacePackageCopies = new Set([
  'COPY auth/package.json ./auth/package.json',
  'COPY blog/package.json ./blog/package.json',
  'COPY site/package.json ./site/package.json',
  'COPY cfp/package.json ./cfp/package.json',
]);
const standaloneCommands = new Map([
  ['RUN pnpm --filter @wts/auth install --frozen-lockfile', 'RUN pnpm install --frozen-lockfile'],
  ['RUN pnpm --filter @wts/auth build', 'RUN pnpm build'],
  ['RUN pnpm --filter @wts/auth deploy --prod /prod/auth',
    'RUN pnpm prune --prod && mkdir -p /prod/auth && cp -a package.json node_modules dist migrations public scripts /prod/auth/'],
]);

function standaloneLine(line, availableFiles) {
  if (workspacePackageCopies.has(line)) return [];
  if (standaloneCommands.has(line)) return [standaloneCommands.get(line)];
  if (!line.startsWith('COPY ') || line.startsWith('COPY --')) return [line];
  const operands = line.slice(5).split(/\s+/);
  const target = operands.pop()?.replace(/^\.\/auth\//, './');
  if (!target || operands.some((path) => !availableFiles.includes(path) && !availableFiles.some((file) => file.startsWith(`${path}/`)))) {
    throw new Error(`Unknown Dockerfile source: ${line}`);
  }
  return [`COPY --from=source ${operands.map((path) => `/source/${path}`).join(' ')} ${target}`];
}

function coolifyDockerfile(runtimeImage, archive, withSource) {
  const encodedArchive = archive.toString('base64');
  const chunks = encodedArchive.match(/.{1,16000}/g);
  if (!chunks) throw new Error('The release archive is empty.');
  const archiveInput = chunks.map((chunk) => `  '${chunk}'`).join(' \\\n');
  const pinnedAssets = remoteSources.map((source) => `ADD --checksum=sha256:${source.sha256} ${source.url} /source/${source.path}`).join('\n');
  const dockerfile = `FROM ${runtimeImage} AS source\nWORKDIR /source\nRUN printf '%s' \\\n${archiveInput} \\\n  | base64 -d | tar -xz\n${pinnedAssets}\n\n${withSource}`;
  if (Buffer.byteLength(Buffer.from(dockerfile).toString('base64')) > 100000) throw new Error('The encoded Dockerfile exceeds the supported Coolify command size.');
  return dockerfile;
}

async function writeOnce(path, content) {
  try {
    await writeFile(path, content, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST' || await readFile(path, 'utf8') !== content) throw error;
  }
}

async function buildRelease(staging) {
  const exported = join(staging, 'export');
  const autoInstallPeers = await exportLockfile(exported);

  const archiveRoot = join(staging, 'source');
  await mkdir(archiveRoot);
  const generatedSources = await writeWorkspaceFiles(exported, archiveRoot, autoInstallPeers);
  const embeddedFiles = await copyEmbeddedFiles(archiveRoot);
  const archiveFiles = [...embeddedFiles, ...workspaceFiles].sort();
  const archive = checkedSpawn(spawnSync('tar', [
    '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner',
    '-czf', '-', '--', ...archiveFiles,
  ], { cwd: archiveRoot, maxBuffer: 16 * 1024 * 1024 }), (result) => `Release archive failed: ${result.stderr.toString()}`);
  const sourceDockerfile = await readFile(join(root, 'auth/Dockerfile'), 'utf8');
  const from = sourceDockerfile.split('\n')[0]?.match(/^FROM (\S+) AS build$/);
  if (!from) throw new Error('The auth Dockerfile must start with a pinned build stage.');
  const availableFiles = [...archiveFiles, ...remoteSources.map((source) => source.path)];
  const withSource = sourceDockerfile.split('\n').flatMap((line) => standaloneLine(line, availableFiles)).join('\n');
  const dockerfile = coolifyDockerfile(from[1], archive.stdout, withSource);
  const manifest = {
    formatVersion: 2,
    sourceDigest,
    dockerfileSha256: createHash('sha256').update(dockerfile).digest('hex'),
    runtimeImage: from[1],
    sources,
    generatedSources,
    remoteSources,
  };
  for (const [name, content] of [
    ['coolify.Dockerfile', dockerfile],
    ['manifest.json', `${JSON.stringify(manifest, null, 2)}\n`],
  ]) {
    await writeOnce(join(destination, name), content);
  }
  process.stdout.write(`${JSON.stringify({ directory: destination, sourceDigest, files: sources.length })}\n`);
}

await mkdir(destination, { recursive: true, mode: 0o700 });
const staging = await mkdtemp(join(destination, '.source-'));
try {
  await buildRelease(staging);
} finally {
  await rm(staging, { recursive: true, force: true });
}
