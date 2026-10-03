// Run: node --experimental-strip-types cfp/tests/container-proof.mjs IMAGE
// Requires Node >=24.15.0, installed CFP dependencies, working Podman, and a local Docker-format CFP image.
// Local domain code prepares synthetic records. Image proof uses only packaged storage/model code.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const runId = `wts-cfp-container-${Date.now()}-${randomBytes(6).toString('hex')}`;
const assertions = [];
const containers = [];
const volumes = [];
const children = new Set();
let interrupted = false;
let stage = 'Validate the image argument';
let failure;
let image;
let sequence = 0;
let privateRoot;
const originalEnvironment = new Map(['CFP_DATA_DIR', 'CFP_EDITION_ID'].map((key) => [key, process.env[key]]));
const edition = '2027';
const signal = () => {
  interrupted = true;
  for (const child of children) child.kill('SIGTERM');
};
process.on('SIGINT', signal);
process.on('SIGTERM', signal);

function check(name, action, evidence = {}) {
  stage = name;
  action();
  assertions.push({ assertion: name, passed: true, ...evidence });
}

function command(args, { input, allowFailure = false, cleanup = false, timeout = 60_000 } = {}) {
  if (interrupted && !cleanup) throw new Error('The proof was interrupted.');
  return new Promise((resolve, reject) => {
    const child = spawn('podman', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    children.add(child);
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    child.stdout.on('data', (bytes) => stdout.push(bytes));
    child.stderr.on('data', (bytes) => stderr.push(bytes));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    child.once('error', () => {
      clearTimeout(timer);
      children.delete(child);
      reject(new Error('Podman could not start.'));
    });
    child.once('close', (code, exitSignal) => {
      clearTimeout(timer);
      children.delete(child);
      const result = { code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') };
      if (timedOut) reject(new Error('The Podman command timed out.'));
      else if (interrupted && !cleanup) reject(new Error('The proof was interrupted.'));
      else if (code === 0 || allowFailure) resolve(result);
      else reject(new Error(`Podman exited with code ${code ?? exitSignal}.`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function until(read, name, timeout = 30_000) {
  stage = name;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (interrupted) throw new Error('The proof was interrupted.');
    const result = await read();
    if (result) return result;
    await sleep(150);
  }
  throw new Error('The container observation timed out.');
}

async function newVolume(suffix) {
  stage = `Create the run-owned ${suffix} volume`;
  const name = `${runId}-${suffix}`;
  const existing = await command(['volume', 'exists', name], { allowFailure: true });
  assert.equal(existing.code, 1, 'The volume name must be unused.');
  volumes.push(name);
  await command(['volume', 'create', '--label', `wts.cfp.container-proof=${runId}`, name]);
  return name;
}

async function run(args, options = {}) {
  const name = `${runId}-${++sequence}`;
  const existing = await command(['container', 'exists', name], { allowFailure: true });
  assert.equal(existing.code, 1, 'The container name must be unused.');
  containers.push(name);
  const result = await command(['run', '--pull=never', '--name', name, '--label', `wts.cfp.container-proof=${runId}`, ...args], options);
  return { name, ...result };
}

const baseEnv = ['--env', `CFP_EDITION_ID=${edition}`];
const mount = (volume, path = '/app/data', readOnly = false) => ['--volume', `${volume}:${path}:${readOnly ? 'ro' : 'rw'}`];

async function cli(volume, args, extraMounts = [], dataDir = '/app/data') {
  stage = `Run the image maintenance CLI: ${args[0]}`;
  return run(['--network=none', '--no-healthcheck', ...baseEnv, '--env', `CFP_DATA_DIR=${dataDir}`,
    ...mount(volume), ...extraMounts, '--entrypoint', 'node', image,
    '--experimental-strip-types', 'scripts/cfp-data.ts', ...args]);
}

const storageImports = `
import { openCfpDatabase } from '/app/src/server/storage.ts';
import { speakerProfileSchema, applicantSettingsSchema, presentationSchema, submissionReceiptSchema } from '/app/src/lib/cfp-model.ts';
`;

function program(body, imports = storageImports) {
  return `import assert from 'node:assert/strict';
${imports}
const checks = [];
let active = 'Load the image proof program';
function check(name, action, evidence = {}) { active = name; action(); checks.push({ assertion: name, passed: true, ...evidence }); }
try {
  const result = await (async () => { ${body}\n })();
  console.log(JSON.stringify({ ok: true, assertions: checks, result }));
} catch {
  console.log(JSON.stringify({ ok: false, assertions: checks, failedAssertion: active }));
  process.exitCode = 1;
}
`;
}

async function evaluate(volume, body, { dataDir = '/app/data', container, imports } = {}) {
  const input = program(body, imports);
  const result = container
    ? await command(['exec', '-i', container, 'node', '--experimental-strip-types', '--input-type=module', '-'], { input, allowFailure: true })
    : await run(['--interactive', '--network=none', '--no-healthcheck', ...baseEnv,
      '--env', `CFP_DATA_DIR=${dataDir}`, ...mount(volume), '--entrypoint', 'node', image,
      '--experimental-strip-types', '--input-type=module', '-'], { input, allowFailure: true });
  let payload;
  try { payload = JSON.parse(result.stdout.trim()); }
  catch { throw new Error(`The image proof program returned no JSON evidence (exit ${result.code}).`); }
  assert.ok(Array.isArray(payload.assertions));
  assertions.push(...payload.assertions);
  if (result.code !== 0 || payload.ok !== true) {
    stage = payload.failedAssertion ?? stage;
    throw new Error(`The image proof assertion failed (exit ${result.code}).`);
  }
  return payload.result;
}

async function inspect(name) {
  const result = await command(['container', 'inspect', name]);
  return JSON.parse(result.stdout)[0];
}

const sessionKey = randomBytes(32).toString('base64url');
async function startRuntime(volume, dataDir = '/app/data') {
  stage = 'Start the actual CFP image';
  const result = await run(['--detach', ...baseEnv, ...mount(volume),
    '--publish', '127.0.0.1::3000', '--env', `CFP_DATA_DIR=${dataDir}`,
    '--env', 'CFP_ORIGIN=https://cfp.acceptance.localhost', '--env', 'CFP_TRUST_PROXY=false',
    '--env', 'OIDC_ISSUER=https://127.0.0.1:1', '--env', 'OIDC_CLIENT_ID=synthetic-container-proof',
    '--env', 'OIDC_CLIENT_SECRET=synthetic-container-proof-secret', '--env', `CFP_SESSION_KEY=${sessionKey}`,
    image]);
  const published = await command(['port', result.name, '3000/tcp']);
  const match = /^127\.0\.0\.1:(\d+)\s*$/.exec(published.stdout);
  check('The runtime port binds only to IPv4 loopback', () => assert.ok(match));
  const origin = `http://127.0.0.1:${match[1]}`;
  await until(async () => {
    const state = await inspect(result.name);
    if (!state.State.Running) throw new Error('The actual CFP image exited before readiness.');
    try {
      const response = await fetch(`${origin}/readyz`, { redirect: 'manual', signal: AbortSignal.timeout(2_000) });
      if (response.status !== 200) { await response.body?.cancel(); return false; }
      const body = await response.json();
      return body.ready === true;
    } catch { return false; }
  }, 'The actual CFP image must become ready');
  return { name: result.name, origin };
}

async function observeRuntime(runtime, label) {
  stage = `Observe ${label} readiness`;
  const response = await fetch(`${runtime.origin}/readyz`, { redirect: 'manual', signal: AbortSignal.timeout(5_000) });
  const ready = await response.json();
  check(`${label}: /readyz returns HTTP 200 and ready=true`, () => {
    assert.equal(response.status, 200);
    assert.deepEqual(ready, { ready: true });
  }, { status: response.status, ready: ready.ready });
  stage = `Observe ${label} anonymous homepage`;
  const home = await fetch(`${runtime.origin}/`, {
    headers: { Accept: 'text/html' }, redirect: 'manual', signal: AbortSignal.timeout(10_000),
  });
  const html = await home.text();
  check(`${label}: the anonymous homepage shows CFP access without a provider`, () => {
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type') ?? '', /text\/html/);
    assert.match(html, /Call for Papers/);
    assert.match(html, /Sign in to continue/);
    assert.match(html, /\/auth\/login\?returnTo=%2Fapplications/);
    assert.equal(home.headers.get('location'), null);
    assert.equal(home.headers.get('set-cookie'), null);
    assert.equal(html.includes('Synthetic Recovery Speaker'), false);
    assert.equal(html.includes('Synthetic recovery application'), false);
    assert.equal(html.includes('synthetic-container-proof-secret'), false);
    assert.equal(html.includes(sessionKey), false);
  }, { status: home.status, provider: 'unavailable container loopback', redirects: 0 });
  const configured = await inspect(runtime.name);
  check(`${label}: the image retains its native healthcheck`, () => {
    const test = configured.Config.Healthcheck?.Test;
    assert.ok(Array.isArray(test) && test.length > 1 && test[0] !== 'NONE');
    assert.match(test.join(' '), /readyz/);
  });
  stage = `Run ${label} native healthcheck`;
  await command(['healthcheck', 'run', runtime.name]);
  const healthy = await inspect(runtime.name);
  check(`${label}: the native healthcheck reports healthy`, () => assert.equal(healthy.State.Health?.Status, 'healthy'), { status: healthy.State.Health?.Status });
}

const account = {
  wtsUserId: 'synthetic-recovery-user', email: 'recovery@example.test', emailVerified: true,
  accountUrl: 'https://127.0.0.1:1/account',
  profile: { version: 1, wtsUserId: 'synthetic-recovery-user', name: 'Synthetic Initial Name', avatarUrl: null,
    preferredLanguage: null, username: 'synthetic-recovery', emailVisibility: false, revision: 1 },
};
const speaker = { fullName: 'Synthetic Recovery Speaker', affiliation: 'Synthetic Organization', bio: 'Synthetic systems engineer',
  socialHandles: ['@synthetic'], previousTalks: 'Synthetic previous talk' };
const settings = { preferredContactMethod: 'Email', companyCoverExpenses: 'Other' };
const presentation = { title: 'Synthetic recovery application', abstract: '<p>Synthetic recovery abstract</p>',
  keyTakeaways: '<ul><li>Recover durable work</li></ul>', technicalRequirements: 'Synthetic HDMI',
  previousPresentation: 'Never', organizerNotes: 'Synthetic private note', additionalInfo: 'Synthetic workshop' };
const durableTables = ['cfp_accounts', 'oidc_bindings', 'speaker_profiles', 'applicant_settings', 'drafts', 'applications', 'submission_receipts', 'schema_migrations'];
function durable(db) { return Object.fromEntries(durableTables.map((table) => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY 1').all().map((row) => ({ ...row }))])); }
const recordsCode = `const durableTables = ${JSON.stringify(durableTables)};
${durable.toString()}
`;

function recoveryCode(snapshot, label) {
  return `${recordsCode}
const expected = ${JSON.stringify(snapshot)};
const db = openCfpDatabase();
try {
  check('${label}: every durable record and binding matches the native snapshot', () => assert.deepEqual(durable(db), expected.durable),
    { accounts: 1, bindings: 1, profiles: 1, settings: 1, drafts: 2, applications: 1, receipts: 1 });
  check('${label}: sessions and OIDC flows are empty', () => {
    assert.equal(db.prepare('SELECT count(*) AS count FROM cfp_sessions').get().count, 0);
    assert.equal(db.prepare('SELECT count(*) AS count FROM oidc_flows').get().count, 0);
  }, { sessions: 0, flows: 0 });
  check('${label}: the restored edition is closed', () => assert.deepEqual(
    db.prepare('SELECT edition_id, cfp_open FROM editions ORDER BY edition_id').all().map((row) => ({ ...row })),
    [{ edition_id: '2027', cfp_open: 0 }]), { edition: '2027', cfpOpen: false });
  check('${label}: database integrity and foreign keys remain valid', () => {
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  });
  check('${label}: packaged model schemas read the saved profile, settings, presentation and receipt', () => {
    assert.deepEqual(speakerProfileSchema.parse(JSON.parse(db.prepare('SELECT value_json FROM speaker_profiles').get().value_json)), expected.application.speaker.value);
    assert.deepEqual(applicantSettingsSchema.parse(JSON.parse(db.prepare('SELECT value_json FROM applicant_settings').get().value_json)), expected.application.settings.value);
    assert.deepEqual(presentationSchema.parse(JSON.parse(db.prepare('SELECT presentation_json FROM applications').get().presentation_json)), expected.application.application.presentation);
    assert.deepEqual(presentationSchema.parse(JSON.parse(db.prepare('SELECT presentation_json FROM drafts WHERE draft_id=?').get(expected.active.draft.id).presentation_json)), expected.active.draft.state.presentation);
    assert.deepEqual(submissionReceiptSchema.parse(JSON.parse(db.prepare('SELECT receipt_json FROM submission_receipts').get().receipt_json)), expected.receipt);
  });
} finally { db.close(); }
`;
}

async function carrier(volume) {
  stage = 'Start a run-owned volume transfer container';
  return run(['--detach', '--network=none', '--no-healthcheck', ...mount(volume),
    '--entrypoint', 'node', image, '-e', 'setInterval(() => {}, 1000)']);
}

async function proveDomainSnapshot(restoredVolume, backupVolume, transfer, snapshot, label, storage, domain) {
  const directory = `${label}-snapshot`;
  await cli(backupVolume, ['backup', `/app/data/${directory}`], mount(restoredVolume, '/app/source'), '/app/source/restored');
  const copied = join(privateRoot, `${label}-image-backup`);
  const recovered = join(privateRoot, `${label}-domain`);
  stage = `Copy the ${label} image-produced online backup into a new private host directory`;
  assert.equal(existsSync(copied), false);
  assert.equal(existsSync(recovered), false);
  await command(['cp', `${transfer.name}:/app/data/${directory}`, copied]);
  stage = `Validate the ${label} image backup with local migration checksums`;
  await storage.restore(copied, recovered);
  process.env.CFP_DATA_DIR = recovered;
  const db = storage.openCfpDatabase(recovered);
  try {
    check(`${label}: the image-produced snapshot preserves every durable record under local migration validation`,
      () => assert.deepEqual(durable(db), snapshot.durable));
  } finally { db.close(); }
  check(`${label}: local domain reads recover the saved profile, settings, application and private draft`, () => {
    assert.deepEqual(domain.getWorkspace(account), { ...snapshot.workspace, cfpOpen: false });
    assert.deepEqual(domain.getApplication(account, snapshot.receipt.applicationId), { ...snapshot.application, cfpOpen: false });
    assert.deepEqual(domain.getDraft(account, snapshot.active.draft.id), { ...snapshot.active, cfpOpen: false });
    assert.deepEqual(domain.getDraft(account, snapshot.command.draftId), { ...snapshot.committed, cfpOpen: false });
  });
  check(`${label}: closed-edition receipt replay returns the original receipt from the image snapshot`,
    () => assert.deepEqual(domain.submitDraft(account, snapshot.command), snapshot.receipt));
  check(`${label}: the recovered domain rejects new drafts while the edition is closed`, () => assert.throws(
    () => domain.startDraft(account, { requestId: randomUUID(), intent: { kind: 'new' } }), (error) => error.code === 'cfp_closed'));
}

async function cleanup() {
  const failures = [];
  for (const name of containers.toReversed()) {
    try {
      const result = await command(['rm', '--force', '--ignore', '--time', '5', name], { cleanup: true, allowFailure: true });
      const exists = await command(['container', 'exists', name], { cleanup: true, allowFailure: true });
      if (result.code !== 0 || exists.code !== 1) failures.push({ resource: 'container', name, removeExit: result.code, existsExit: exists.code });
    } catch (error) { failures.push({ resource: 'container', name, error: error.message }); }
  }
  for (const name of volumes.toReversed()) {
    try {
      const result = await command(['volume', 'rm', '--force', name], { cleanup: true, allowFailure: true });
      const exists = await command(['volume', 'exists', name], { cleanup: true, allowFailure: true });
      if (result.code !== 0 || exists.code !== 1) failures.push({ resource: 'volume', name, removeExit: result.code, existsExit: exists.code });
    } catch (error) { failures.push({ resource: 'volume', name, error: error.message }); }
  }
  if (privateRoot) {
    try {
      await rm(privateRoot, { recursive: true, force: true });
      if (existsSync(privateRoot)) failures.push({ resource: 'temporary-directory', error: 'The private proof directory remains.' });
    } catch { failures.push({ resource: 'temporary-directory', error: 'The private proof directory did not close.' }); }
  }
  return failures;
}

try {
  const args = process.argv.slice(2);
  assert.equal(args.length, 1);
  assert.match(args[0], /^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/);
  stage = 'Find the prebuilt local CFP image';
  const found = await command(['image', 'inspect', args[0]]);
  const metadata = JSON.parse(found.stdout)[0];
  image = metadata.Id;
  check('The proof uses one prebuilt local image without builds or pulls', () => assert.match(image, /^(?:sha256:)?[a-f0-9]{64}$/));
  const sourceVolume = await newVolume('source');
  const backupVolume = await newVolume('backup');
  const restoredVolume = await newVolume('restored');
  const emptyVolume = await newVolume('empty');

  await cli(sourceVolume, ['init', edition]);
  const imageMigrations = await evaluate(sourceVolume, `
    const db = openCfpDatabase();
    try {
      check('CLI initialization starts the fresh edition closed', () => assert.equal(
        db.prepare('SELECT cfp_open FROM editions WHERE edition_id=?').get('2027').cfp_open, 0));
      return db.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all().map((row) => ({ ...row }));
    } finally { db.close(); }
  `);
  stage = 'Create a private synthetic database with local domain and storage code';
  privateRoot = await mkdtemp(join(tmpdir(), `${runId}-`));
  const localData = join(privateRoot, 'source');
  const nativeSnapshot = join(privateRoot, 'native-snapshot');
  process.env.CFP_DATA_DIR = localData;
  process.env.CFP_EDITION_ID = edition;
  const storage = await import('../src/server/storage.ts');
  const domain = await import('../src/server/applicants.ts');
  const { getApplication, getCfpStatus, getDraft, getWorkspace, saveApplicant, saveDraft, startDraft, submitDraft } = domain;
  storage.initializeEdition(edition, localData);
  const localDatabase = storage.openCfpDatabase(localData);
  try {
    const localMigrations = localDatabase.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all().map((row) => ({ ...row }));
    check('Local and image migration versions, names and checksums match exactly', () => assert.deepEqual(localMigrations, imageMigrations),
      { migrations: imageMigrations });
  } finally { localDatabase.close(); }
  await cli(sourceVolume, ['open', edition]);
  await evaluate(sourceVolume, `
    const db = openCfpDatabase();
    try { check('The image CLI opens the initialized edition', () => assert.equal(db.prepare('SELECT cfp_open FROM editions WHERE edition_id=?').get('2027').cfp_open, 1)); }
    finally { db.close(); }
  `);
  storage.setCfpOpen(edition, true, localData);
  stage = 'Populate synthetic records through the local domain and storage interfaces';
  const snapshot = (() => {
    check('The synthetic domain edition is open before data creation', () => assert.deepEqual(getCfpStatus(), { editionId: '2027', cfpOpen: true }));
    const initial = getWorkspace(account);
    const saved = saveApplicant(account, { speaker: { expectedRevision: initial.speaker.revision, changes: speaker }, settings: { expectedRevision: initial.settings.revision, changes: settings } });
    check('Domain operations save the complete synthetic speaker and settings', () => { assert.deepEqual(saved.speaker.value, speaker); assert.deepEqual(saved.settings.value, settings); });
    const started = startDraft(account, { requestId: randomUUID(), intent: { kind: 'new' } });
    const ready = saveDraft(account, { draftId: started.draft.id, expectedDraftRevision: started.draft.revision, presentation });
    const command = { draftId: ready.draft.id, expected: { draft: ready.draft.revision, speaker: ready.speaker.revision, settings: ready.settings.revision } };
    const receipt = submitDraft(account, command);
    const application = getApplication(account, receipt.applicationId);
    const committed = getDraft(account, ready.draft.id);
    check('Domain submission creates the application and its durable receipt', () => {
      assert.deepEqual(application.application.presentation, presentation);
      assert.deepEqual(committed.draft.state, { kind: 'committed', receipt });
      assert.equal(receipt.operation, 'created'); assert.equal(receipt.applicationRevision, 1);
    });
    const edit = startDraft(account, { requestId: randomUUID(), intent: { kind: 'edit', applicationId: receipt.applicationId, expectedRevision: 1 } });
    const active = saveDraft(account, { draftId: edit.draft.id, expectedDraftRevision: edit.draft.revision, presentation: { title: 'Synthetic private recovery edit' } });
    check('A saved edit remains private from the submitted application', () => {
      assert.equal(active.draft.state.presentation.title, 'Synthetic private recovery edit');
      assert.equal(getApplication(account, receipt.applicationId).application.presentation.title, 'Synthetic recovery application');
    });
    const db = storage.openCfpDatabase(localData);
    try {
      const now = Date.now();
      db.prepare('INSERT INTO oidc_bindings VALUES (?, ?, ?, ?)').run('https://127.0.0.1:1', 'synthetic-recovery-subject', account.wtsUserId, now);
      db.prepare('INSERT INTO cfp_sessions VALUES (?, ?, ?, ?, ?, ?)').run('synthetic-session-hash', 'https://127.0.0.1:1', 'synthetic-recovery-subject', 'synthetic-encrypted-token', now, now + 300000);
      db.prepare('INSERT INTO oidc_flows VALUES (?, ?, ?, ?, ?)').run('synthetic-state-hash', 'synthetic-browser-hash', 'synthetic-encrypted-flow', '/applications', now + 300000);
      check('The source has one identity binding, session and OIDC flow', () => {
        for (const table of ['oidc_bindings', 'cfp_sessions', 'oidc_flows']) assert.equal(db.prepare('SELECT count(*) AS count FROM ' + table).get().count, 1);
      }, { bindings: 1, sessions: 1, flows: 1 });
      return { workspace: getWorkspace(account), application, active, committed, command, receipt, durable: durable(db) };
    } finally { db.close(); }
  })();
  stage = 'Create a consistent native online-backup snapshot for image startup';
  await storage.backup(nativeSnapshot, localData);
  const sourceTransfer = await carrier(sourceVolume);
  await evaluate(sourceVolume, `
    check('The initialized image database has no sidecars before snapshot transfer', () => {
      for (const suffix of ['-wal', '-shm', '-journal']) assert.equal(existsSync('/app/data/cfp.sqlite' + suffix), false);
    });
  `, { imports: "import { existsSync } from 'node:fs';" });
  stage = 'Transfer only the consistent synthetic database into the source image volume';
  await command(['cp', join(nativeSnapshot, 'cfp.sqlite'), `${sourceTransfer.name}:/app/data/cfp.sqlite`]);
  await command(['rm', '--force', '--time', '5', sourceTransfer.name]);
  await evaluate(sourceVolume, `${recordsCode}
    const expected = ${JSON.stringify(snapshot.durable)};
    const db = openCfpDatabase();
    try { check('The image validates the transferred native snapshot and every durable synthetic record', () => assert.deepEqual(durable(db), expected)); }
    finally { db.close(); }
  `);
  const backupTransfer = await carrier(backupVolume);

  const sourceRuntime = await startRuntime(sourceVolume);
  await observeRuntime(sourceRuntime, 'Source runtime');
  await cli(backupVolume, ['backup', '/app/data/backup'], mount(sourceVolume, '/app/source'), '/app/source');
  stage = 'Verify the online backup manifest';
  await evaluate(backupVolume, `
    const root = '/app/data/backup';
    const bytes = readFileSync(root + '/cfp.sqlite');
    const manifest = JSON.parse(readFileSync(root + '/manifest.json', 'utf8'));
    check('Online backup writes a matching SHA-256 manifest and no SQLite sidecars', () => {
      assert.deepEqual(manifest, { schemaVersion: 1, databaseSha256: createHash('sha256').update(bytes).digest('hex') });
      for (const suffix of ['-wal', '-shm', '-journal']) assert.equal(existsSync(root + '/cfp.sqlite' + suffix), false);
    }, { schemaVersion: manifest.schemaVersion, checksumMatches: true, sidecars: 0 });
  `, { imports: "import { readFileSync, existsSync } from 'node:fs'; import { createHash } from 'node:crypto';" });
  await observeRuntime(sourceRuntime, 'Source runtime after online backup');
  await evaluate(sourceVolume, `${recordsCode}
    const expected = ${JSON.stringify(snapshot)};
    const db = openCfpDatabase();
    try {
      check('Online backup leaves source records, sessions, flows and the open gate unchanged', () => {
        assert.deepEqual(durable(db), expected.durable);
        assert.equal(db.prepare('SELECT count(*) AS count FROM cfp_sessions').get().count, 1);
        assert.equal(db.prepare('SELECT count(*) AS count FROM oidc_flows').get().count, 1);
        assert.equal(db.prepare('SELECT cfp_open FROM editions WHERE edition_id=?').get('2027').cfp_open, 1);
      });
    } finally { db.close(); }
  `);

  await cli(restoredVolume, ['restore', '/app/backup/backup', '/app/data/restored'], mount(backupVolume, '/app/backup', true));
  stage = 'Verify recovery through packaged image storage and model interfaces';
  await evaluate(restoredVolume, recoveryCode(snapshot, 'Restored volume'), { dataDir: '/app/data/restored' });
  const restoredRuntime = await startRuntime(restoredVolume, '/app/data/restored');
  await observeRuntime(restoredRuntime, 'Restored runtime');
  await proveDomainSnapshot(restoredVolume, backupVolume, backupTransfer, snapshot, 'restored', storage, domain);
  stage = 'Verify the actual runtime user and installed dependencies';
  await evaluate(restoredVolume, `
    const uid = process.getuid();
    const pidOneUid = Number(/^Uid:\\s+(\\d+)/m.exec(readFileSync('/proc/1/status', 'utf8'))?.[1]);
    check('The runtime process and PID 1 use the same nonroot UID', () => { assert.ok(uid > 0); assert.equal(process.geteuid(), uid); assert.equal(pidOneUid, uid); }, { uid, pidOneUid });
    const forbidden = /^(?:pocketbase|sqlite3|serialport|@serialport\\/.*)$/;
    const visited = new Set();
    let packages = 0;
    function inspectDirectory(path) {
      if (!existsSync(path)) return;
      const real = realpathSync(path);
      if (visited.has(real)) return;
      visited.add(real);
      const manifestPath = path + '/package.json';
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        packages += 1;
        assert.equal(forbidden.test(manifest.name ?? ''), false);
        for (const name of Object.keys(manifest.dependencies ?? {})) assert.equal(forbidden.test(name), false);
        for (const name of Object.keys(manifest.optionalDependencies ?? {})) assert.equal(forbidden.test(name), false);
      }
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        const child = path + '/' + entry.name;
        if (entry.isDirectory() || (entry.isSymbolicLink() && statSync(child).isDirectory())) inspectDirectory(child);
      }
    }
    check('Runtime dependency trees contain no PocketBase, sqlite3 or serialport packages', () => {
      inspectDirectory('/app/node_modules'); inspectDirectory('/app/.output/server/node_modules');
      for (const base of ['/app', '/usr/local/bin', '/usr/bin', '/bin']) assert.equal(existsSync(base + '/pocketbase'), false);
      assert.ok(packages > 0);
    });
    return { uid, packagesInspected: packages, forbiddenPackages: 0 };
  `, { container: restoredRuntime.name, imports: "import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';" });
  stage = 'Remove the restored runtime before replacement';
  await command(['rm', '--force', '--time', '5', restoredRuntime.name]);
  const removed = await command(['container', 'exists', restoredRuntime.name], { allowFailure: true });
  check('Replacement removes the previous runtime container', () => assert.equal(removed.code, 1));
  const replacement = await startRuntime(restoredVolume, '/app/data/restored');
  check('Replacement uses a distinct runtime container on the same restored volume', () => assert.notEqual(replacement.name, restoredRuntime.name));
  await observeRuntime(replacement, 'Replacement runtime');
  await evaluate(restoredVolume, recoveryCode(snapshot, 'Replacement runtime'), { container: replacement.name });
  await proveDomainSnapshot(restoredVolume, backupVolume, backupTransfer, snapshot, 'replacement', storage, domain);

  const uninitialized = await startUninitialized(emptyVolume);
  const exited = await until(async () => {
    const state = await inspect(uninitialized);
    return state.State.Status === 'exited' ? state : false;
  }, 'The uninitialized volume must fail startup');
  check('An uninitialized volume exits startup with a nonzero status', () => assert.ok(exited.State.ExitCode > 0), { exitCode: exited.State.ExitCode });
  const logs = await command(['logs', uninitialized]);
  check('Uninitialized startup fails because the CFP database is absent', () => assert.match(logs.stdout + logs.stderr, /ENOENT[^\n]*cfp\.sqlite|cfp\.sqlite[^\n]*ENOENT/));
  await evaluate(emptyVolume, `check('Failed startup does not initialize a database implicitly', () => assert.equal(existsSync('/app/data/cfp.sqlite'), false));`, { imports: "import { existsSync } from 'node:fs';" });
} catch (error) {
  failure = { assertion: stage, error: stage === 'Validate the image argument'
    ? 'Use node --experimental-strip-types cfp/tests/container-proof.mjs IMAGE.'
    : error instanceof assert.AssertionError ? 'The proof assertion failed.' : error.message };
} finally {
  const cleanupFailures = await cleanup();
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  process.off('SIGINT', signal);
  process.off('SIGTERM', signal);
  console.log(JSON.stringify({ ok: !failure && cleanupFailures.length === 0, runId, image, assertions,
    ...(failure ? { failure } : {}), cleanup: { containers: containers.length, volumes: volumes.length, temporaryDirectories: privateRoot ? 1 : 0, failures: cleanupFailures } }));
  if (failure || cleanupFailures.length) process.exitCode = 1;
}

async function startUninitialized(volume) {
  stage = 'Start the actual image on an uninitialized volume';
  const result = await run(['--detach', '--network=none', '--no-healthcheck', ...baseEnv, ...mount(volume),
    '--env', 'CFP_DATA_DIR=/app/data', '--env', 'CFP_ORIGIN=https://cfp.acceptance.localhost', image]);
  return result.name;
}
