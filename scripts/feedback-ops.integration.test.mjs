import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { startFeedbackPocketBase } from '../src/lib/feedback-pocketbase-test-helper.ts';
import { prepareAudience, freezeAudience, prepareSurvey, createPocketBaseAdapter, issueInvitations, readManifest, prepareDelivery, readPrivateJson, exportResults, retainFeedback, retentionDeadline } from './feedback-ops.mjs';

// The real CLI adapter + real PocketBase migration/hooks, no HTTP protocol mocks.
test('real PocketBase: issue, resume, submit, prepare same-token reminder, export and retain', async t => {
  const fixture = await startFeedbackPocketBase();
  const dir = await mkdtemp(join(tmpdir(), 'wts-feedback-ops-integration-'));
  const previousKey = process.env.FEEDBACK_MANIFEST_KEY;
  process.env.FEEDBACK_MANIFEST_KEY = randomBytes(32).toString('base64');
  t.after(async () => {
    if (previousKey === undefined) delete process.env.FEEDBACK_MANIFEST_KEY;
    else process.env.FEEDBACK_MANIFEST_KEY = previousKey;
    await fixture.cleanup();
    await rm(dir, { recursive: true, force: true });
  });
  const launchAt = new Date(Date.now() - 60_000).toISOString();
  const mainDay = launchAt.slice(0, 10);
  const setup = prepareSurvey({ approved: true, source: 'synthetic-approved-programme', key: 'synthetic-real-pb', title: 'Synthetic feedback', version: 'v1', launchAt, mainDay, sessions: [{ id: 'synthetic-talk', title: 'Synthetic talk', mainDay }] });
  const survey = await fixture.pb.collection('feedback_surveys').create({ ...setup.survey, open: true });
  const snapshot = {
    version: 1, source: 'synthetic-hi-events', eventId: '5', listId: '701', mainDay, admissionProductIds: ['2'],
    provenance: { endpoint: '/events/5/check-in-lists/701/attendees', exportedAt: launchAt, sort: 'id:asc', complete: true, total: 2, pages: [{ page: 1, total: 2, ids: ['1', '2'] }] },
    suppressions: { source: 'synthetic-suppressions', reviewedAt: launchAt, emails: [], attendeeIds: [] },
    records: ['1', '2'].map(id => ({ id, name: `Synthetic person ${id}`, email: 'shared@synthetic-fixture.net', eventId: '5', productId: '2', ticketStatus: 'ACTIVE', orderStatus: 'COMPLETED', checkIn: { id: `check-${id}`, eventId: '5', listId: '701', attendeeId: id, checkedInAt: launchAt } })),
  };
  const frozen = freezeAudience(snapshot, { approved: true, snapshotDigest: prepareAudience(snapshot).snapshotDigest, decisions: {} });
  const adapter = createPocketBaseAdapter({ pbUrl: fixture.baseUrl, authToken: fixture.pb.authStore.token });
  const manifestPath = join(dir, 'manifest.json');
  const issue = { adapter, surveyId: survey.id, setup, frozen, manifestPath, now: launchAt };
  assert.deepEqual(await issueInvitations(issue), { dryRun: true, planned: 2, verified: 0 });
  assert.equal((await adapter.invitations(survey.id)).length, 0);
  assert.equal((await issueInvitations({ ...issue, apply: true })).verified, 2);
  assert.equal((await issueInvitations({ ...issue, apply: true })).verified, 2);
  assert.equal((await adapter.invitations(survey.id)).length, 2);
  const manifest = await readManifest(manifestPath);
  assert.equal((await readFile(manifestPath, 'utf8')).includes(manifest.entries[0].token), false);
  const first = await fetch(`${fixture.baseUrl}/api/wts/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'submit', token: manifest.entries[0].token, version: 'v1', answers: { overall: 5, sessions: [{ sessionId: 'synthetic-talk', usefulness: 4, comment: 'Synthetic comment.' }] } }) });
  assert.deepEqual(await first.json(), { state: 'submitted' });
  const reminderPath = join(dir, 'reminder.json');
  const reminder = { adapter, surveyId: survey.id, manifestPath, suppressions: snapshot.suppressions, now: setup.reminderAt, publicOrigin: 'https://synthetic.test', outputPath: reminderPath, kind: 'reminder', apply: true };
  assert.equal((await prepareDelivery(reminder)).planned, 1);
  const delivery = await readPrivateJson(reminderPath);
  assert.deepEqual(delivery.recipients, [{ email: 'shared@synthetic-fixture.net', url: `https://synthetic.test/feedback#token=${manifest.entries[1].token}` }]);
  assert.equal(delivery.sent, false);
  assert.equal((await prepareDelivery(reminder)).alreadyPrepared, true);
  const exportPath = join(dir, 'results.json');
  await exportResults({ adapter, surveyId: survey.id, setup, outputPath: exportPath, includeRaw: true, apply: true });
  const exported = await readPrivateJson(exportPath);
  assert.equal(exported.aggregate.responses, 1);
  assert.deepEqual(exported.aggregate.sessions, [{ sessionId: 'synthetic-talk', withheld: true }]);
  assert.equal(exported.records[0].overall, 5);
  assert.equal(JSON.stringify(exported).includes('shared@'), false);
  const other = await fixture.invitation();
  const retain = { adapter, surveyId: survey.id, setup, target: 'invitations', manifestPath, now: retentionDeadline(setup.survey.closes_at, 'invitations') };
  assert.equal((await retainFeedback(retain)).planned, 2);
  assert.equal((await retainFeedback({ ...retain, apply: true })).deleted, 2);
  assert.equal((await adapter.responses(survey.id)).length, 1);
  assert.equal((await adapter.invitations(other.survey.id)).length, 1);
  await assert.rejects(readFile(manifestPath), { code: 'ENOENT' });
  await assert.rejects(readFile(reminderPath), { code: 'ENOENT' });
  assert.equal((await retainFeedback({ adapter, surveyId: survey.id, setup, target: 'responses', now: retentionDeadline(setup.survey.closes_at, 'responses'), apply: true })).deleted, 1);
  assert.equal((await adapter.responses(survey.id)).length, 0);
  console.log(`Real operations adapter verified against ${fixture.version}; synthetic records only, no sends.`);
});
