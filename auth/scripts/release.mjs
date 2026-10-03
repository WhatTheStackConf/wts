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
await mkdir(destination, { recursive: true, mode: 0o700 });
const staging = await mkdtemp(join(destination, '.source-'));
try {
  const exported = join(staging, 'export');
  const deployment = spawnSync('pnpm', [
    '--filter', '@wts/auth', 'deploy', '--lockfile-only', '--ignore-scripts', exported,
  ], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  if (deployment.error) throw deployment.error;
  if (deployment.status !== 0) throw new Error(`Release lockfile export failed: ${deployment.stderr.toString()}`);
  const peerConfig = spawnSync('pnpm', ['config', 'get', 'autoInstallPeers', '--json'], { cwd: root });
  if (peerConfig.error) throw peerConfig.error;
  if (peerConfig.status !== 0) throw new Error('pnpm could not read the workspace peer setting.');
  const autoInstallPeers = JSON.parse(peerConfig.stdout.toString());
  if (typeof autoInstallPeers !== 'boolean') throw new Error('pnpm did not return a Boolean peer setting.');

  const archiveRoot = join(staging, 'source');
  await mkdir(archiveRoot);
  const generatedSources = [];
  for (const path of workspaceFiles) {
    let content;
    if (path === 'pnpm-workspace.yaml') {
      let settings = '';
      try {
        settings = await readFile(join(exported, path), 'utf8');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      content = Buffer.from(`packages:\n  - .\nautoInstallPeers: ${autoInstallPeers}\n${settings}`);
    } else {
      content = await readFile(join(exported, path));
    }
    await writeFile(join(archiveRoot, path), content);
    generatedSources.push({ path, sha256: createHash('sha256').update(content).digest('hex') });
  }
  const embeddedFiles = files.filter((path) =>
    path !== 'auth/Dockerfile' && path !== 'auth/package.json' &&
    !remoteSources.some((source) => source.path === path));
  for (const path of embeddedFiles) {
    await mkdir(dirname(join(archiveRoot, path)), { recursive: true });
    await copyFile(join(root, path), join(archiveRoot, path));
  }
  const archiveFiles = [...embeddedFiles, ...workspaceFiles].sort();
  const archive = spawnSync('tar', [
    '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner',
    '-czf', '-', '--', ...archiveFiles,
  ], { cwd: archiveRoot, maxBuffer: 16 * 1024 * 1024 });
  if (archive.error) throw archive.error;
  if (archive.status !== 0) throw new Error(`Release archive failed: ${archive.stderr.toString()}`);
  const sourceDockerfile = await readFile(join(root, 'auth/Dockerfile'), 'utf8');
  const from = sourceDockerfile.split('\n')[0]?.match(/^FROM (\S+) AS build$/);
  if (!from) throw new Error('The auth Dockerfile must start with a pinned build stage.');
  const standaloneCommands = new Map([
    ['RUN pnpm --filter @wts/auth install --frozen-lockfile', 'RUN pnpm install --frozen-lockfile'],
    ['RUN pnpm --filter @wts/auth build', 'RUN pnpm build'],
    ['RUN pnpm --filter @wts/auth deploy --prod /prod/auth',
      'RUN pnpm prune --prod && mkdir -p /prod/auth && cp -a package.json node_modules dist migrations public scripts /prod/auth/'],
  ]);
  const withSource = sourceDockerfile.split('\n').flatMap((line) => {
    if (line === 'COPY auth/package.json ./auth/package.json' || line === 'COPY blog/package.json ./blog/package.json') return [];
    if (standaloneCommands.has(line)) return [standaloneCommands.get(line)];
    if (!line.startsWith('COPY ') || line.startsWith('COPY --')) return [line];
    const operands = line.slice(5).split(/\s+/);
    const target = operands.pop()?.replace(/^\.\/auth\//, './');
    const availableFiles = [...archiveFiles, ...remoteSources.map((source) => source.path)];
    if (!target || operands.some((path) => !availableFiles.includes(path) && !availableFiles.some((file) => file.startsWith(`${path}/`)))) {
      throw new Error(`Unknown Dockerfile source: ${line}`);
    }
    return [`COPY --from=source ${operands.map((path) => `/source/${path}`).join(' ')} ${target}`];
  }).join('\n');
  const encodedArchive = archive.stdout.toString('base64');
  const chunks = encodedArchive.match(/.{1,16000}/g);
  if (!chunks) throw new Error('The release archive is empty.');
  const archiveInput = chunks.map((chunk) => `  '${chunk}'`).join(' \\\n');
  const pinnedAssets = remoteSources.map((source) => `ADD --checksum=sha256:${source.sha256} ${source.url} /source/${source.path}`).join('\n');
  const dockerfile = `FROM ${from[1]} AS source\nWORKDIR /source\nRUN printf '%s' \\\n${archiveInput} \\\n  | base64 -d | tar -xz\n${pinnedAssets}\n\n${withSource}`;
  if (Buffer.byteLength(Buffer.from(dockerfile).toString('base64')) > 100000) throw new Error('The encoded Dockerfile exceeds the supported Coolify command size.');
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
    const path = join(destination, name);
    try {
      await writeFile(path, content, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error.code !== 'EEXIST' || await readFile(path, 'utf8') !== content) throw error;
    }
  }
  process.stdout.write(`${JSON.stringify({ directory: destination, sourceDigest, files: sources.length })}\n`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
