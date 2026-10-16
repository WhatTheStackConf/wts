import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

const fakeSet = {
  prefix: 'fake',
  icons: {
    plain: { body: '<p/>' },
    rot: { body: '<r/>', rotate: 2 },
    flipped: { body: '<f/>', hFlip: true },
    vflipped: { body: '<v/>', vFlip: true },
  },
  aliases: {
    'rot-cancel': { parent: 'rot', rotate: 2 },
    'rot-add': { parent: 'rot', rotate: 1 },
    'hflip-cancel': { parent: 'flipped', hFlip: true },
    'vflip-cancel': { parent: 'vflipped', vFlip: true },
    'hflip-keep': { parent: 'flipped', rotate: 1 },
    'chain-cancel': { parent: 'rot-add', rotate: 1, hFlip: true },
  },
};

async function generate(t, names) {
  const dir = await mkdtemp(join(tmpdir(), 'synthetic-icons-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const pkg = join(dir, 'node_modules/@iconify-json/fake');
  await mkdir(pkg, { recursive: true });
  await mkdir(join(dir, 'scripts'));
  await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: '@iconify-json/fake', version: '1.0.0' }));
  await writeFile(join(pkg, 'icons.json'), JSON.stringify(fakeSet));
  await writeFile(join(dir, 'scripts/icon-manifest.json'), JSON.stringify(names));
  await copyFile(new URL('./generate-icons.mjs', import.meta.url), join(dir, 'scripts/generate-icons.mjs'));
  await run(process.execPath, ['scripts/generate-icons.mjs'], { cwd: dir });
  const { localIcons } = await import(join(dir, 'src/generated/icons.ts'));
  return localIcons;
}

const box = { left: 0, top: 0, width: 16, height: 16 };

test('alias transforms that cancel the parent transform are removed', async (t) => {
  const icons = await generate(t, ['fake:rot-cancel', 'fake:hflip-cancel', 'fake:vflip-cancel', 'fake:chain-cancel']);
  assert.deepEqual(icons, {
    'fake:chain-cancel': { body: '<r/>', ...box, hFlip: true },
    'fake:hflip-cancel': { body: '<f/>', ...box },
    'fake:rot-cancel': { body: '<r/>', ...box },
    'fake:vflip-cancel': { body: '<v/>', ...box },
  });
});

test('alias transforms that do not cancel combine with the parent', async (t) => {
  const icons = await generate(t, ['fake:rot-add', 'fake:hflip-keep']);
  assert.deepEqual(icons, {
    'fake:hflip-keep': { body: '<f/>', ...box, rotate: 1, hFlip: true },
    'fake:rot-add': { body: '<r/>', ...box, rotate: 3 },
  });
});
