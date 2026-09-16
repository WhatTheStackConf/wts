import { randomUUID } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vite-plus/test';
import { startLiveQaPocketBase } from './live-qa-pocketbase-test-helper';
import { createGamificationAccountingStore } from './gamification-accounting-store';
import { GAMIFICATION_COLLECTIONS as C, GamificationAccountingService } from './gamification-accounting';
import { GamificationOperationsService } from './gamification-operations';
import { MissionQuestionAdminService } from './mission-question-admin';
import { DatabaseMissionCodeRateLimiter, MissionCodeRedemptionService } from './mission-code-redemption';
import { QUESTION_COLLECTIONS as Q } from './mission-question-records';
import type { QuestionnaireDefinition } from './mission-questions';
import { createMissionCodeGeneration } from './mission-code-crypto';

// Only inject the disposable client into the production adapter: filters, batching,
// distributed locks and every validation hook remain the real implementation.
const connection = vi.hoisted(() => ({ pb: null as unknown as PocketBase }));
vi.mock('~/lib/pocketbase-admin-service', () => ({ getAdminPB: () => ({
  getInstance: async () => connection.pb,
  fetchRecordById: (c: string, id: string) => connection.pb.collection(c).getOne(id),
  createRecord: (c: string, data: Record<string, unknown>) => connection.pb.collection(c).create(data),
  updateRecord: (c: string, id: string, data: Record<string, unknown>) => connection.pb.collection(c).update(id, data),
}) }));
const definition: QuestionnaireDefinition = { policy: 'all_correct', questions: [
  { id: 'word', kind: 'text', prompt: 'Say the secret word', acceptedAnswers: ['Synthetic Secret'] },
  { id: 'choice', kind: 'single_choice', prompt: 'Choose', choices: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }], acceptedAnswers: ['yes'] },
] };
const answers = { word: ' synthetic secret ', choice: 'yes' };
const pepper = 'disposable-question-tests-only-pepper';
describe('question rewards through real PocketBase and public services', () => {
  let fixture: Awaited<ReturnType<typeof startLiveQaPocketBase>>;
  let actor: { id: string; role: 'admin' };
  let store: ReturnType<typeof createGamificationAccountingStore>;
  let operations: GamificationOperationsService;
  let admin: MissionQuestionAdminService;
  let service: MissionCodeRedemptionService;
  let schedule: string;
  let from: string, until: string;
  const configs: Record<string, { activityId: string; codeId: string; rawCode: string }> = {};
  beforeAll(async () => {
    fixture = await startLiveQaPocketBase({ workspace: true });
    connection.pb = fixture.pb;
    expect(fixture.version).toMatch(/0\.(30\.4|34\.0)/);
    expect(fixture.hooks).toContain('gamification_questions.pb.js');
    expect(fixture.migrations).toContain('1786000012_create_gamification_questions.js');
    actor = { id: (await fixture.user('admin')).record.id, role: 'admin' };
    store = createGamificationAccountingStore();
    operations = new GamificationOperationsService(store, pepper);
    admin = new MissionQuestionAdminService(store, pepper);
    service = new MissionCodeRedemptionService(store, pepper, { rateLimiter: new DatabaseMissionCodeRateLimiter(store) });
    from = new Date(Date.now() - 60_000).toISOString();
    until = new Date(Date.now() + 3_600_000).toISOString();
    schedule = (await operations.createScoreScheduleDraft({ key: 'questions-fixture', effectiveAt: from, operationId: randomUUID(), reason: 'Synthetic fixture' }, actor)).id;
    const mission = await operations.saveMissionDraft({ key: 'qr-fixture', slug: 'qr-fixture', title: 'Synthetic QR Mission', summary: 'Disposable integration test', category: 'social', visibility: 'public', startsAt: from, endsAt: until, suggested: true, sortOrder: 0, operationId: randomUUID() }, actor);
    await operations.activateDefinition('mission', { id: mission.id, confirmation: true, reason: 'Synthetic fixture', operationId: randomUUID() }, actor);
    for (const key of ['direct', 'correct', 'answered', 'disabled', 'expired', 'cap']) {
      const input = { key: `qr.${key}`, missionId: mission.id, kind: 'qr' as const, category: 'social' as const, outcomeKey: 'completion', evidenceMode: 'single_code' as const, perUserClaimLimit: 1, maxClaims: 100, activeFrom: from, activeUntil: until, enabled: true, reason: 'Synthetic fixture' };
      const activity = await operations.saveActivityDraft({ ...input, operationId: randomUUID() }, actor);
      await operations.saveActivityDraft({ ...input, id: activity.id, operationId: randomUUID(), scorePolicy: { scheduleId: schedule, policyKey: `qr.${key}`, enabled: true, totalXp: 7, leaderboardXp: 3, capMembership: [{ dimension: 'activity', key: activity.id }, { dimension: 'category', key: 'social' }, { dimension: 'conference', key: 'conference' }] } }, actor);
      if (key !== 'direct') await admin.save({ activityId: activity.id, expectedVersion: '', operationId: randomUUID(), reason: 'Synthetic questions', definition: { ...definition, policy: key === 'answered' ? 'all_answered' : 'all_correct' } }, actor);
      await operations.activateDefinition('activity', { id: activity.id, confirmation: true, reason: 'Synthetic fixture', operationId: randomUUID() }, actor);
      configs[key] = { activityId: activity.id, codeId: '', rawCode: '' };
    }
    await operations.activateScoreSchedule(schedule, { id: schedule, confirmation: true, reason: 'Synthetic fixture', operationId: randomUUID() }, actor);
    for (const [key, config] of Object.entries(configs)) {
      const batch = await operations.generateCodes({ activityId: config.activityId, label: key, quantity: 1, evidenceRole: 'single', startsAt: from, endsAt: until, maxRedemptions: key === 'cap' ? 1 : 100, perUserLimit: 1, operationId: randomUUID() }, actor);
      expect(batch.codes).toHaveLength(1);
      config.codeId = batch.codes![0].id;
      config.rawCode = batch.codes![0].rawCode;
    }
  }, 60_000);
  afterAll(async () => { await fixture?.cleanup(); });
  const scan = (user: { id: string }, key = 'correct', instance = service) => instance.redeem({ user, rawCode: configs[key].rawCode, requestFingerprint: 'shared-event-wifi', sourceHint: 'qr' });
  const submit = (user: { id: string }, challengeId: string, value: unknown = answers, operationId = randomUUID(), instance = service) => instance.submitAnswers({ user, challengeId, operationId, answers: value, requestFingerprint: 'shared-event-wifi' });
  async function counts(user: string) {
    const rows = await Promise.all([C.codeRedemptions, C.activityClaims, C.xpEvents].map(c => store.list(c, { user })));
    return rows.map(row => row.length);
  }
  it('enforces actual unique distributed lock keys in PocketBase', async () => {
    const data = { key: 'question-concurrency-proof', owner: randomUUID(), expires_at: new Date(Date.now() + 60_000).toISOString() };
    const first = await fixture.pb.collection('gamification_operation_locks').create(data);
    try {
      await expect(fixture.pb.collection('gamification_operation_locks').create({ ...data, owner: randomUUID() })).rejects.toMatchObject({ status: 400 });
    } finally { await fixture.pb.collection('gamification_operation_locks').delete(first.id); }
  });
  it('keeps direct scans unchanged and gates questions without accepted redemptions or XP; never leaks keys', async () => {
    const user = (await fixture.user()).record;
    expect(await scan(user, 'direct')).toMatchObject({ status: 'accepted', xpAwarded: 7, leaderboardXpAwarded: 3 });
    expect(await scan(user, 'direct')).toMatchObject({ status: 'already_redeemed', xpAwarded: 0 });
    const second = (await fixture.user()).record;
    const gate = await scan(second);
    expect(gate.status).toBe('questions_required');
    expect(gate.xpAwarded ?? 0).toBe(0);
    expect(JSON.stringify(gate)).not.toMatch(/acceptedAnswers|Synthetic Secret|answer_hash|code_hash/);
    expect(await counts(second.id)).toEqual([0, 0, 0]);
    expect(await scan(second)).toMatchObject({ questionnaire: { challengeId: gate.questionnaire!.challengeId } });
  });
  it('wrong, incomplete and malformed answers award nothing; fresh scan retries can succeed', async () => {
    const user = (await fixture.user()).record;
    for (const [value, status] of [[{ ...answers, word: 'wrong' }, 'questions_incorrect'], [{ word: 'ok' }, 'questions_incomplete'], [{ ...answers, extra: 'x' }, 'questions_malformed']] as const) {
      const gate = await scan(user);
      expect(await submit(user, gate.questionnaire!.challengeId, value)).toMatchObject({ status });
      expect(await counts(user.id)).toEqual([0, 0, 0]);
    }
    const gate = await scan(user);
    expect(await submit(user, gate.questionnaire!.challengeId)).toMatchObject({ status: 'accepted', xpAwarded: 7 });
    expect(await counts(user.id)).toEqual([1, 1, 1]);
  });
  it('all_answered accepts non-key text but still requires offered choices', async () => {
    const user = (await fixture.user()).record;
    const gate = await scan(user, 'answered');
    expect(await submit(user, gate.questionnaire!.challengeId, { word: 'any text', choice: 'no' })).toMatchObject({ status: 'accepted', xpAwarded: 7 });
    expect(await counts(user.id)).toEqual([1, 1, 1]);
  });
  it('repairs an interruption after approval before the first accepted redemption', async () => {
    const user = (await fixture.user()).record;
    const gate = await scan(user);
    const operation = randomUUID();
    let interrupt = true;
    const interruptedStore = { ...store, create: async <T>(collection: string, data: Record<string, unknown>): Promise<T> => {
      if (collection === C.codeRedemptions && interrupt) { interrupt = false; throw new Error('Synthetic interrupted acceptance'); }
      return store.create<T>(collection, data);
    } };
    const interrupted = new MissionCodeRedemptionService(interruptedStore, pepper);
    expect(await submit(user, gate.questionnaire!.challengeId, answers, operation, interrupted)).toMatchObject({ status: 'unavailable' });
    expect(await store.list(Q.attempts, { user: user.id, status: 'passed' })).toHaveLength(1);
    expect(await counts(user.id)).toEqual([0, 0, 0]);
    expect(await submit(user, gate.questionnaire!.challengeId, answers, operation)).toMatchObject({ status: 'accepted', xpAwarded: 7 });
    expect(await submit(user, gate.questionnaire!.challengeId, answers, operation)).toMatchObject({ status: 'already_redeemed', xpAwarded: 0 });
    expect(await counts(user.id)).toEqual([1, 1, 1]);
  });
  it('fresh passed evidence is not shadowed by an older expired passed attempt', async () => {
    const user = (await fixture.user()).record;
    const first = await scan(user);
    const unavailableStore = { ...store, create: async <T>(collection: string, data: Record<string, unknown>): Promise<T> => {
      if (collection === C.codeRedemptions) throw new Error('Synthetic interrupted acceptance');
      return store.create<T>(collection, data);
    } };
    expect(await submit(user, first.questionnaire!.challengeId, answers, randomUUID(), new MissionCodeRedemptionService(unavailableStore, pepper))).toMatchObject({ status: 'unavailable' });
    const later = new MissionCodeRedemptionService(store, pepper, { clock: () => new Date(Date.now() + 16 * 60_000).toISOString() });
    const fresh = await scan(user, 'correct', later);
    expect(fresh.status).toBe('questions_required');
    expect(fresh.questionnaire!.challengeId).not.toBe(first.questionnaire!.challengeId);
    expect(await scan(user, 'correct', later)).toMatchObject({ questionnaire: { challengeId: fresh.questionnaire!.challengeId } });
    expect(await submit(user, fresh.questionnaire!.challengeId, answers, randomUUID(), later)).toMatchObject({ status: 'accepted', xpAwarded: 7 });
    expect(await counts(user.id)).toEqual([1, 1, 1]);
  });
  it('concurrent identical commands and response-loss replay produce exactly one accounting chain', async () => {
    const user = (await fixture.user()).record;
    const gate = await scan(user);
    const id = randomUUID();
    const results = await Promise.all([submit(user, gate.questionnaire!.challengeId, answers, id), submit(user, gate.questionnaire!.challengeId, answers, id)]);
    expect(results.map(r => r.status).sort()).toEqual(['accepted', 'already_redeemed']);
    await fixture.restart();
    expect(await submit(user, gate.questionnaire!.challengeId, answers, id)).toMatchObject({ status: 'already_redeemed', xpAwarded: 0 });
    expect(await submit(user, gate.questionnaire!.challengeId, { ...answers, word: 'changed' }, id)).toMatchObject({ status: 'question_conflict' });
    expect(await counts(user.id)).toEqual([1, 1, 1]);
    expect(await store.list(Q.attempts, { user: user.id, status: 'passed' })).toHaveLength(1);
  });
  it('denies foreign challenges, disabled codes and expired challenges without awards', async () => {
    const owner = (await fixture.user()).record, foreign = (await fixture.user()).record;
    const gate = await scan(owner);
    expect(await submit(foreign, gate.questionnaire!.challengeId)).toMatchObject({ status: 'invalid' });
    const disabled = await scan(owner, 'disabled');
    await operations.invalidateCode({ codeId: configs.disabled.codeId, confirmation: true, reason: 'Synthetic disable', operationId: randomUUID() }, actor);
    expect(await submit(owner, disabled.questionnaire!.challengeId)).toMatchObject({ status: 'disabled' });
    const expired = await scan(owner, 'expired');
    const later = new MissionCodeRedemptionService(store, pepper, { clock: () => new Date(Date.now() + 16 * 60_000).toISOString() });
    expect(await submit(owner, expired.questionnaire!.challengeId, answers, randomUUID(), later)).toMatchObject({ status: 'expired' });
    expect(await counts(owner.id)).toEqual([0, 0, 0]);
    expect(await counts(foreign.id)).toEqual([0, 0, 0]);
  });
  it('revalidates global limits after questions; unrelated users sharing a fingerprint are unaffected', async () => {
    const a = (await fixture.user()).record, b = (await fixture.user()).record;
    const ga = await scan(a, 'cap'), gb = await scan(b, 'cap');
    expect(await submit(a, ga.questionnaire!.challengeId)).toMatchObject({ status: 'accepted' });
    expect(await submit(b, gb.questionnaire!.challengeId)).toMatchObject({ status: 'global_limit' });
    for (let i = 0; i < 5; i++) await service.redeem({ user: a, rawCode: 'invalid', requestFingerprint: 'shared-event-wifi' });
    expect(await scan(a)).toMatchObject({ status: 'rate_limited' });
    expect(await scan(b)).toMatchObject({ status: 'questions_required' });
    expect(await counts(b.id)).toEqual([0, 0, 0]);
  });
  it('registers exact printed codes with repeatable receipts after real JSON persistence', async () => {
    const rawCode = createMissionCodeGeneration('synthetic-reservation-only').rawCode;
    const input = { activityId: configs.direct.activityId, label: 'Printed fixture', rawCodes: [rawCode], evidenceRole: 'single' as const, startsAt: from, endsAt: until, maxRedemptions: 100, perUserLimit: 1, operationId: randomUUID() };
    const first = await operations.registerCodes(input, actor);
    expect(await operations.registerCodes(input, actor)).toEqual(first);
    expect(JSON.stringify(first)).not.toContain(rawCode);
    const user = (await fixture.user()).record;
    expect(await service.redeem({ user, rawCode, requestFingerprint: 'shared-event-wifi' })).toMatchObject({ status: 'accepted', xpAwarded: 7 });
    const before = (await fixture.pb.collection(C.codes).getList(1, 1)).totalItems;
    await expect(operations.registerCodes({ ...input, operationId: randomUUID(), rawCodes: [createMissionCodeGeneration('another-reservation').rawCode, rawCode] }, actor)).rejects.toThrow(/already registered/);
    expect((await fixture.pb.collection(C.codes).getList(1, 1)).totalItems).toBe(before);
  });
  it('locks live definitions in service and hooks, retains evidence and denies private REST APIs', async () => {
    const row = await store.findOne<{ id: string; version: string }>(Q.definitions, { activity: configs.correct.activityId });
    await expect(admin.save({ activityId: configs.correct.activityId, expectedVersion: row!.version, operationId: randomUUID(), reason: 'Mutation', definition }, actor)).rejects.toThrow(/draft/);
    await expect(fixture.pb.collection(Q.definitions).update(row!.id, { definition, version: randomUUID(), operation_id: randomUUID() })).rejects.toMatchObject({ status: 400 });
    await expect(fixture.pb.collection(Q.definitions).delete(row!.id)).rejects.toMatchObject({ status: 400 });
    await expect(fixture.pb.collection(C.activities).update(configs.correct.activityId, { status: 'draft' })).rejects.toMatchObject({ status: 400 });
    const user = await fixture.user();
    for (const client of [new PocketBase(fixture.baseUrl), user.client]) for (const collection of [Q.definitions, Q.attempts]) {
      await expect(client.collection(collection).getList()).rejects.toMatchObject({ status: 403 });
      await expect(client.collection(collection).create({})).rejects.toMatchObject({ status: 403 });
    }
    await expect(user.client.collection(Q.definitions).getOne(row!.id)).rejects.toMatchObject({ status: 403 });
    expect(JSON.stringify(await admin.list())).not.toMatch(/acceptedAnswers|Synthetic Secret/);
  });
  it('uses actual availability counts and stops suggesting disabled code inventory', async () => {
    const user = (await fixture.user()).record;
    const accounting = new GamificationAccountingService(store);
    expect((await accounting.summaryForUser(user)).suggestedMissions).toHaveLength(1);
    const codes = await store.list<{ id: string }>(C.codes, { status: 'active', enabled: true });
    for (const code of codes) await operations.invalidateCode({ codeId: code.id, reason: 'Synthetic catalogue closure', confirmation: true, operationId: randomUUID() }, actor);
    expect((await accounting.summaryForUser(user)).suggestedMissions).toEqual([]);
  });
});
