import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { acquireOwnership } from '../.output/checkin-runtime/runtime/checkin/host-ownership.js';

void test('process-lifetime lease survives cleanup and IPC disconnect while a worker lingers', async () => {
 const resource=`lifetime:${randomUUID()}`;
 const module=new URL('../.output/checkin-runtime/runtime/checkin/host-ownership.js',import.meta.url).href;
 const child=spawn(process.execPath,['--input-type=module','-e',`import { acquireOwnership } from ${JSON.stringify(module)}; const release=await acquireOwnership([${JSON.stringify(resource)}],true); await release(); process.once('disconnect',()=>console.log('disconnected')); setInterval(()=>{},1000);console.log('ready');`],{stdio:['ignore','pipe','pipe','ipc']});
 try {
  await once(child.stdout,'data');
  await assert.rejects(acquireOwnership([resource]),{category:'resource_owned'});
  const disconnected=once(child.stdout,'data');child.disconnect();await disconnected;
  await assert.rejects(acquireOwnership([resource]),{category:'resource_owned'});
  const exit=once(child,'exit');child.kill('SIGKILL');await exit;
  const release=await acquireOwnership([resource]);await release();
 } finally {child.kill('SIGKILL');}
});

void test('ownership rejects a second process and releases after owner crash', async () => {
  const resource = `test:${randomUUID()}`;
  const module = new URL('../.output/checkin-runtime/runtime/checkin/host-ownership.js', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import { acquireOwnership } from ${JSON.stringify(module)}; await acquireOwnership([${JSON.stringify(resource)}]); console.log('ready');`], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('exit', () => reject(new Error('owner exited before ready'))); });
    await assert.rejects(acquireOwnership([resource]), { category: 'resource_owned' });
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGKILL'); await exited;
    const release = await acquireOwnership([resource]); await release();
  } finally { child.kill('SIGKILL'); }
});

void test('a failed multi-resource acquisition releases its earlier locks', async () => {
  const occupied = `z:${randomUUID()}`; const available = `a:${randomUUID()}`;
  const release = await acquireOwnership([occupied]);
  try {
    await assert.rejects(acquireOwnership([available, occupied]), { category: 'resource_owned' });
    const releaseAvailable = await acquireOwnership([available]); await releaseAvailable();
  } finally { await release(); }
});
