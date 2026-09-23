import test from 'node:test';
import assert from 'node:assert/strict';
import * as ops from './feedback-ops.mjs';
import { prepareAudience, freezeAudience } from './feedback-ops.mjs';
import { mkdtemp, readFile, stat, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
// Synthetic dedicated manifest encryption key; never inherited production secrets.
process.env.FEEDBACK_MANIFEST_KEY = Buffer.alloc(32, 7).toString('base64');

async function privateTemp(t) {
  const root = process.env.TMPDIR;
  assert.ok(root, 'tests require TMPDIR (private scratch, not system temp)');
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'synthetic-feedback-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
function setupInput() {
  return { approved: true, key: 'synthetic-feedback', title: 'Synthetic feedback', version: '1', launchAt: '2026-09-23T12:00:00Z', mainDay: '2026-09-19', source: 'synthetic-approved-main-day-snapshot', sessions: [{ id: 'synthetic-talk', title: 'Synthetic talk', mainDay: '2026-09-19' }] };
}
async function disposableApi(t, survey) {
  // In-memory HTTP protocol double, NOT evidence of actual PocketBase behavior.
  const tables = { feedback_surveys: [survey], feedback_invitations: [], feedback_responses: [] };
  const state = { tables, writes: [], loseCreateResponse: false, unreachable: false };
  const server = createServer(async (req, res) => {
    if (state.unreachable) { res.writeHead(503).end(); return; }
    assert.equal(req.headers.authorization, 'synthetic-auth');
    const url = new URL(req.url, 'http://127.0.0.1');
    const [, , , collection, , rid] = url.pathname.split('/');
    const rows = tables[collection];
    if (!rows) { res.writeHead(404).end(); return; }
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET') {
      if (rid) { const row = rows.find(r => r.id === rid); res.writeHead(row ? 200 : 404).end(JSON.stringify(row ?? {})); return; }
      const filter = url.searchParams.get('filter');
      const match = filter?.match(/^survey = "([a-z0-9]+)"$/);
      const selected = match ? rows.filter(r => r.survey === match[1]) : rows;
      res.end(JSON.stringify({ page: 1, perPage: 100, totalPages: selected.length ? 1 : 0, totalItems: selected.length, items: selected })); return;
    }
    state.writes.push({ method: req.method, collection, rid });
    if (req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk;
      const row = JSON.parse(body);
      if (rows.some(r => r.id === row.id || r.survey === row.survey && r.source_key === row.source_key)) { res.writeHead(400).end('{}'); return; }
      rows.push(row);
      if (state.loseCreateResponse) { state.loseCreateResponse = false; state.unreachable = true; req.socket.destroy(); return; }
      res.writeHead(200).end(JSON.stringify(row)); return;
    }
    if (req.method === 'DELETE') { const i = rows.findIndex(r => r.id === rid); if (i < 0) { res.writeHead(404).end(); return; } rows.splice(i, 1); res.writeHead(204).end(); return; }
    res.writeHead(405).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  state.url = `http://127.0.0.1:${server.address().port}`;
  return state;
}

test('issuance persists secrets before uncertain create and resumes without another allowance', async t => {
  assert.equal(typeof ops.issueInvitations, 'function');
  const dir = await privateTemp(t);
  const setup = ops.prepareSurvey(setupInput());
  assert.equal(setup.survey.closes_at, '2026-10-03T12:00:00.000Z');
  assert.equal(setup.reminderAt, '2026-09-29T12:00:00.000Z');
  const api = await disposableApi(t, { ...setup.survey, id: 'syntheticsurvey' });
  const adapter = ops.createPocketBaseAdapter({ pbUrl: api.url, authToken: 'synthetic-auth' });
  const source = snapshot([attendee('1'), attendee('2')]);
  const frozen = freezeAudience(source, { approved: true, snapshotDigest: prepareAudience(source).snapshotDigest, decisions: {} });
  const options = { adapter, surveyId: 'syntheticsurvey', setup, frozen, now: '2026-09-23T12:00:00Z', manifestPath: join(dir, 'manifest.json') };
  const dry = await ops.issueInvitations(options);
  assert.equal(dry.planned, 2); assert.equal(api.writes.length, 0);
  await assert.rejects(readFile(options.manifestPath), { code: 'ENOENT' });
  api.loseCreateResponse = true;
  await assert.rejects(ops.issueInvitations({ ...options, apply: true }), /uncertain|HTTP|request/);
  const pending = await ops.readManifest(options.manifestPath);
  assert.equal(pending.entries.length, 2);
  const token = pending.entries[0].token;
  assert.equal((await readFile(options.manifestPath, 'utf8')).includes(token), false);
  assert.equal((await readFile(options.manifestPath, 'utf8')).includes('person-1@'), false);
  const originalKey = process.env.FEEDBACK_MANIFEST_KEY;
  process.env.FEEDBACK_MANIFEST_KEY = Buffer.alloc(32, 8).toString('base64');
  await assert.rejects(ops.readManifest(options.manifestPath), /authentication/);
  process.env.FEEDBACK_MANIFEST_KEY = originalKey;
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(api.tables.feedback_invitations[0].token_hash, createHash('sha256').update(token).digest('hex'));
  assert.equal('token' in api.tables.feedback_invitations[0], false);
  api.unreachable = false;
  const result = await ops.issueInvitations({ ...options, apply: true });
  assert.equal(result.verified, 2); assert.equal(api.tables.feedback_invitations.length, 2);
  assert.equal(api.writes.filter(w => w.method === 'POST').length, 2);
  const manifest = await ops.readManifest(options.manifestPath);
  assert.equal(manifest.entries[0].token, token);
  assert.equal((await stat(options.manifestPath)).mode & 0o777, 0o600);
  assert.equal((await stat(dir)).mode & 0o777, 0o700);
  await ops.issueInvitations({ ...options, apply: true });
  assert.equal(api.writes.filter(w => w.method === 'POST').length, 2);
  await assert.rejects(ops.issueInvitations({ ...options, manifestPath: join(dir, 'different-run.json'), apply: true }), /existing invitation/);
});

test('one day-six reminder reuses tokens, excludes used/revoked/new suppressions, never sends', async t => {
  assert.equal(typeof ops.prepareDelivery, 'function');
  const dir = await privateTemp(t), setup = ops.prepareSurvey(setupInput());
  const api = await disposableApi(t, { ...setup.survey, id: 'syntheticsurvey', open: true });
  const adapter = ops.createPocketBaseAdapter({ pbUrl: api.url, authToken: 'synthetic-auth' });
  const data = snapshot(['1', '2', '3', '4'].map(x => attendee(x)));
  const frozen = freezeAudience(data, { approved: true, snapshotDigest: prepareAudience(data).snapshotDigest, decisions: {} });
  const manifestPath = join(dir, 'manifest.json');
  await ops.issueInvitations({ adapter, surveyId: 'syntheticsurvey', setup, frozen, manifestPath, now: '2026-09-23T12:00:00Z', apply: true });
  api.tables.feedback_invitations[0].used = true;
  api.tables.feedback_invitations[1].revoked = true;
  const suppressions = { ...data.suppressions, emails: ['person-3@synthetic-fixture.net'] };
  const opts = { adapter, surveyId: 'syntheticsurvey', manifestPath, suppressions, now: '2026-09-29T13:00:00Z', publicOrigin: 'https://synthetic.test', outputPath: join(dir, 'reminder.json'), kind: 'reminder' };
  const dry = await ops.prepareDelivery(opts);
  assert.equal(dry.planned, 1);
  assert.deepEqual(dry.excluded, { used: 1, revoked: 1, suppressed: 1, expired: 0 });
  assert.equal((await ops.prepareDelivery({ ...opts, apply: true })).planned, 1);
  const payload = await ops.readPrivateJson(opts.outputPath);
  const manifest = await ops.readManifest(manifestPath);
  assert.equal(payload.recipients.length, 1);
  assert.equal(payload.recipients[0].url, `https://synthetic.test/feedback#token=${manifest.entries[3].token}`);
  assert.equal(payload.sent, false);
  assert.equal((await ops.prepareDelivery({ ...opts, apply: true })).alreadyPrepared, true);
  await assert.rejects(ops.prepareDelivery({ ...opts, outputPath: join(dir, 'second.json'), apply: true }), /already|different/);
  await assert.rejects(ops.prepareDelivery({ ...opts, now: '2026-09-28T13:00:00Z' }), /day six/);
  assert.equal(api.writes.filter(w => w.method !== 'POST').length, 0);
});

test('retention is dry-run first, uses close-based deadlines, exact survey, and deletes delivery secrets', async t => {
  assert.equal(typeof ops.retainFeedback, 'function');
  const dir = await privateTemp(t), setup = ops.prepareSurvey(setupInput());
  const api = await disposableApi(t, { ...setup.survey, id: 'syntheticsurvey', open: true });
  const adapter = ops.createPocketBaseAdapter({ pbUrl: api.url, authToken: 'synthetic-auth' });
  const data = snapshot([attendee('1')]);
  const frozen = freezeAudience(data, { approved: true, snapshotDigest: prepareAudience(data).snapshotDigest, decisions: {} });
  const manifestPath = join(dir, 'manifest.json'), outputPath = join(dir, 'initial.json');
  await ops.issueInvitations({ adapter, surveyId: 'syntheticsurvey', setup, frozen, manifestPath, now: '2026-09-23T12:00:00Z', apply: true });
  await ops.prepareDelivery({ adapter, surveyId: 'syntheticsurvey', manifestPath, outputPath, suppressions: data.suppressions, publicOrigin: 'https://synthetic.test', now: '2026-09-23T13:00:00Z', apply: true });
  api.tables.feedback_invitations.push({ id: 'unrelatedinvite', survey: 'unrelatedsurvey' });
  api.tables.feedback_responses.push({ id: 'syntheticanswer', survey: 'syntheticsurvey' }, { id: 'unrelatedanswer', survey: 'unrelatedsurvey' });
  const opts = { adapter, surveyId: 'syntheticsurvey', setup, manifestPath, target: 'invitations', now: '2026-11-02T12:00:00Z' };
  const dry = await ops.retainFeedback(opts);
  assert.equal(dry.dueAt, '2026-11-02T12:00:00.000Z'); assert.equal(dry.planned, 1);
  assert.equal(api.tables.feedback_invitations.length, 2);
  await assert.rejects(ops.retainFeedback({ ...opts, now: '2026-11-02T11:59:59Z', apply: true }), /not due/);
  assert.equal((await ops.retainFeedback({ ...opts, apply: true })).deleted, 1);
  await assert.rejects(readFile(manifestPath), { code: 'ENOENT' });
  await assert.rejects(readFile(outputPath), { code: 'ENOENT' });
  assert.deepEqual(api.tables.feedback_invitations.map(r => r.id), ['unrelatedinvite']);
  assert.equal(api.tables.feedback_responses.length, 2);
  const responses = { adapter, surveyId: 'syntheticsurvey', setup, target: 'responses', now: '2027-10-03T12:00:00Z' };
  assert.equal((await ops.retainFeedback(responses)).dueAt, '2027-10-03T12:00:00.000Z');
  assert.equal((await ops.retainFeedback({ ...responses, apply: true })).deleted, 1);
  assert.deepEqual(api.tables.feedback_responses.map(r => r.id), ['unrelatedanswer']);
  assert.equal(ops.retentionDeadline('2028-02-29T12:00:00Z', 'responses'), '2029-02-28T12:00:00.000Z');
});

test('private results omit identifiers/order metadata and report optional denominators/minimum-five session ratings', async t => {
  assert.equal(typeof ops.exportResults, 'function');
  const dir = await privateTemp(t), setup = ops.prepareSurvey(setupInput());
  const api = await disposableApi(t, { ...setup.survey, id: 'syntheticsurvey' });
  const adapter = ops.createPocketBaseAdapter({ pbUrl: api.url, authToken: 'synthetic-auth' });
  for (let i = 0; i < 6; i++) api.tables.feedback_responses.push({ id: `response000000${i}`, survey: 'syntheticsurvey', version: '1', created: 'sensitive-timestamp', email: 'must-not-export@synthetic-fixture.net', answers: { overall: 4, parts: i < 4 ? { content: i === 0 ? 'na' : 5 } : {}, keep: 'Synthetic private text', change: '', more: i === 0 ? ['demos'] : [], moreOther: '', sessions: i < 4 ? [{ sessionId: 'synthetic-talk', usefulness: 5, comment: 'Synthetic comment' }] : [] } });
  const opts = { adapter, surveyId: 'syntheticsurvey', setup, outputPath: join(dir, 'results.json'), includeRaw: true };
  const dry = await ops.exportResults(opts);
  assert.equal(dry.responses, 6); await assert.rejects(readFile(opts.outputPath), { code: 'ENOENT' });
  await ops.exportResults({ ...opts, apply: true });
  const result = await ops.readPrivateJson(opts.outputPath);
  assert.deepEqual(result.aggregate.parts.content, { rated: 3, notApplicable: 1, skipped: 2, mean: 5 });
  assert.deepEqual(result.aggregate.sessions[0], { sessionId: 'synthetic-talk', withheld: true });
  assert.equal(result.records.length, 6);
  const body = JSON.stringify(result);
  for (const forbidden of ['response000000', 'sensitive-timestamp', 'must-not-export', 'created', 'token', 'invitation', 'source_key']) assert.equal(body.includes(forbidden), false);
  assert.equal(api.writes.length, 0);
  api.tables.feedback_responses[4].answers.sessions = [{ sessionId: 'synthetic-talk', usefulness: 4, comment: '' }];
  const next = { ...opts, outputPath: join(dir, 'aggregate.json'), includeRaw: false, apply: true };
  await ops.exportResults(next);
  const aggregate = await ops.readPrivateJson(next.outputPath);
  assert.equal(aggregate.aggregate.sessions[0].rated, 5);
  assert.equal(aggregate.aggregate.sessions[0].mean, 4.8);
  assert.equal('records' in aggregate, false);
  assert.equal(JSON.stringify(aggregate).includes('Synthetic private text'), false);
});

async function cli(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [new URL('./feedback-ops.mjs', import.meta.url).pathname, ...args], { cwd, env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, FEEDBACK_MANIFEST_KEY: process.env.FEEDBACK_MANIFEST_KEY } });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

test('CLI defaults to dry-run, writes explicit private artifacts, rejects flags and never echoes input contacts', async t => {
  const dir = await privateTemp(t), input = join(dir, 'snapshot.json'), output = join(dir, 'plan.json');
  await ops.writePrivateJson(input, snapshot([attendee('1')]));
  const dry = await cli(['prepare', '--input', input, '--out', output], dir);
  assert.equal(dry.code, 0); assert.equal(JSON.parse(dry.stdout).dryRun, true);
  await assert.rejects(readFile(output), { code: 'ENOENT' });
  const apply = await cli(['prepare', '--input', input, '--out', output, '--apply'], dir);
  assert.equal(apply.code, 0); assert.equal((await ops.readPrivateJson(output)).counts.eligible, 1);
  assert.equal(apply.stdout.includes('person-1'), false);
  const invalid = await cli(['issue', '--token', 'secret-must-not-echo'], dir);
  assert.notEqual(invalid.code, 0); assert.equal(invalid.stderr.includes('secret-must-not-echo'), false);
  const help = await cli(['--help'], dir); assert.match(help.stdout, /No mail/);
});

test('invalid/placeholder contacts stay blocked and initial suppressions survive reminder refresh', async t => {
  for (const email of ['bad@@synthetic-fixture.net', '.bad@synthetic-fixture.net', 'bad..dot@synthetic-fixture.net', 'person@synthetic.test', 'person@-invalid.net', 'test@example.com']) {
    assert.equal(prepareAudience(snapshot([attendee('1', { email })])).counts.invalidEmail, 1);
  }
  const dir = await privateTemp(t), setup = ops.prepareSurvey(setupInput());
  const api = await disposableApi(t, { ...setup.survey, id: 'syntheticsurvey', open: true });
  const adapter = ops.createPocketBaseAdapter({ pbUrl: api.url, authToken: 'synthetic-auth' });
  const data = snapshot([attendee('1')]);
  const frozen = freezeAudience(data, { approved: true, snapshotDigest: prepareAudience(data).snapshotDigest, decisions: {} });
  const manifestPath = join(dir, 'manifest.json');
  await ops.issueInvitations({ adapter, surveyId: 'syntheticsurvey', setup, frozen, manifestPath, now: '2026-09-23T12:00:00Z', apply: true });
  await ops.prepareDelivery({ adapter, surveyId: 'syntheticsurvey', manifestPath, outputPath: join(dir, 'initial.json'), suppressions: { ...data.suppressions, attendeeIds: ['1'] }, publicOrigin: 'https://synthetic.test', now: '2026-09-23T13:00:00Z', apply: true });
  const reminder = await ops.prepareDelivery({ adapter, surveyId: 'syntheticsurvey', manifestPath, outputPath: join(dir, 'reminder.json'), suppressions: data.suppressions, publicOrigin: 'https://synthetic.test', now: '2026-09-29T13:00:00Z', kind: 'reminder' });
  assert.equal(reminder.planned, 0); assert.equal(reminder.excluded.suppressed, 1);
});

test('adapter normalizes PocketBase date wire format and rejects redirects without forwarding auth', async t => {
  const setup = ops.prepareSurvey(setupInput());
  const api = await disposableApi(t, { ...setup.survey, id: 'syntheticsurvey', opens_at: '2026-09-23 12:00:00.000Z', closes_at: '2026-10-03 12:00:00.000Z' });
  const adapter = ops.createPocketBaseAdapter({ pbUrl: api.url, authToken: 'synthetic-auth' });
  assert.equal((await adapter.survey('syntheticsurvey')).closes_at, '2026-10-03T12:00:00.000Z');
  let reached = false;
  const server = createServer((req, res) => { if (req.url === '/forbidden') reached = true; res.writeHead(302, { location: '/forbidden' }).end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const redirected = ops.createPocketBaseAdapter({ pbUrl: `http://127.0.0.1:${server.address().port}`, authToken: 'synthetic-auth' });
  await assert.rejects(redirected.survey('syntheticsurvey'), /request/); assert.equal(reached, false);
  assert.throws(() => ops.createPocketBaseAdapter({ pbUrl: 'https://unapproved.synthetic.test', authToken: 'synthetic-auth', productionApply: true }), /unapproved/);
});

test('source evidence cannot reuse check-in IDs or claim unordered complete pages; invalid calendar times fail', () => {
  const repeated = snapshot([attendee('1'), attendee('2')]);
  repeated.records[1].checkIn.id = repeated.records[0].checkIn.id;
  assert.throws(() => prepareAudience(repeated), /unique check-in/);
  assert.throws(() => prepareAudience(snapshot([attendee('2'), attendee('1')])), /ordered/);
  const invalidLaunch = setupInput(); invalidLaunch.launchAt = '2026-02-30T12:00:00Z';
  assert.throws(() => ops.prepareSurvey(invalidLaunch), /calendar/);
  const anotherDay = setupInput(); anotherDay.sessions[0].mainDay = '2026-09-18';
  assert.throws(() => ops.prepareSurvey(anotherDay), /main-day/);
});

// All fixtures are synthetic; no live source or credentials are used.
function snapshot(records = []) {
  return {
    version: 1, source: 'synthetic-hi-events', eventId: 'synthetic-event', listId: 'synthetic-main',
    mainDay: '2026-09-19', admissionProductIds: ['synthetic-entry'],
    provenance: { endpoint: '/events/synthetic-event/check-in-lists/synthetic-main/attendees', exportedAt: '2026-09-20T12:00:00Z', sort: 'id:asc', complete: true, total: records.length, pages: [{ page: 1, total: records.length, ids: records.map(r => r.id) }] },
    suppressions: { source: 'synthetic-suppression-review', reviewedAt: '2026-09-20T12:00:00Z', emails: [], attendeeIds: [] },
    records,
  };
}
function attendee(id, overrides = {}) {
  return { id, name: `Synthetic Person ${id}`, email: `person-${id}@synthetic-fixture.net`, eventId: 'synthetic-event', productId: 'synthetic-entry', ticketStatus: 'ACTIVE', orderStatus: 'COMPLETED', checkIn: { id: `check-${id}`, eventId: 'synthetic-event', listId: 'synthetic-main', attendeeId: id, checkedInAt: '2026-09-19T10:00:00Z' }, ...overrides };
}

test('complete exact-list audience keeps shared email allowances and holds duplicate people/status changes', () => {
  const data = snapshot([
    attendee('1', { email: 'shared@synthetic-fixture.net' }), attendee('2', { email: 'shared@synthetic-fixture.net' }),
    attendee('3', { name: 'Synthetic Duplicate' }), attendee('4', { name: 'Synthetic Duplicate' }),
    attendee('5', { ticketStatus: 'CANCELLED' }), attendee('6', { email: 'speaker@example.invalid' }),
    attendee('7'), attendee('8', { checkIn: null, checkedIn: true }),
    attendee('9', { checkIn: { ...attendee('9').checkIn, listId: 'synthetic-workshop' } }),
  ]);
  data.suppressions.emails.push('person-7@synthetic-fixture.net');
  const plan = prepareAudience(data);
  assert.deepEqual(plan.counts, { source: 9, eligible: 2, held: 3, suppressed: 1, invalidEmail: 1, notCheckedIn: 1, unknownAttendance: 1, distinctEligibleEmails: 1, sharedEmailRecords: 2 });
  assert.equal(plan.records.find(r => r.id === '3').reasons.includes('possible_duplicate_person'), true);
  assert.equal(plan.records.find(r => r.id === '5').reasons.includes('changed_ticket_or_order_status'), true);
  assert.throws(() => freezeAudience(data, { approved: true, snapshotDigest: plan.snapshotDigest, decisions: {} }), /review/);
  const frozen = freezeAudience(data, { approved: true, snapshotDigest: plan.snapshotDigest, decisions: { '3': 'include', '4': 'exclude', '5': 'include' } });
  assert.deepEqual(frozen.audience.map(r => r.id), ['1', '2', '3', '5']);
  assert.deepEqual(frozen.snapshot.suppressions, data.suppressions);
  const incomplete = structuredClone(data); incomplete.provenance.total++;
  assert.throws(() => prepareAudience(incomplete), /complete/);
  const repeated = snapshot([attendee('1'), attendee('1')]);
  assert.throws(() => prepareAudience(repeated), /unique/);
  const wrongList = structuredClone(data); wrongList.provenance.endpoint = '/events/synthetic-event/attendees';
  assert.throws(() => prepareAudience(wrongList), /exact-list/);
});
