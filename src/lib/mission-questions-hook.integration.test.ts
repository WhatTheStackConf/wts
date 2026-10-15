import { randomUUID } from 'node:crypto';
import type PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vite-plus/test';
import { startLiveQaPocketBase } from './live-qa-pocketbase-test-helper';
import { createGamificationAccountingStore } from './gamification-accounting-store';
import { GamificationOperationsService } from './gamification-operations';
import { QUESTION_COLLECTIONS as Q } from './mission-question-records';

const connection = vi.hoisted(() => ({ pb: null as unknown as PocketBase }));
vi.mock('~/lib/pocketbase-admin-service', () => ({ getAdminPB: () => ({
  getInstance: async () => connection.pb,
  fetchRecordById: (c: string, id: string) => connection.pb.collection(c).getOne(id),
  createRecord: (c: string, data: Record<string, unknown>) => connection.pb.collection(c).create(data),
  updateRecord: (c: string, id: string, data: Record<string, unknown>) => connection.pb.collection(c).update(id, data),
}) }));

const text = { kind: 'text', prompt: 'Say anything', acceptedAnswers: [] };
const choices = [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }];
const choice = { id: 'pick', kind: 'single_choice', prompt: 'Choose', acceptedAnswers: [] };

describe('questionnaire hook through real PocketBase', () => {
  let fixture: Awaited<ReturnType<typeof startLiveQaPocketBase>>;
  let actor: string;
  let operations: GamificationOperationsService;
  let drafts = 0;
  beforeAll(async () => {
    fixture = await startLiveQaPocketBase({ workspace: true });
    connection.pb = fixture.pb;
    actor = (await fixture.user('admin')).record.id;
    operations = new GamificationOperationsService(createGamificationAccountingStore(), 'disposable-question-hook-pepper');
  }, 60_000);
  afterAll(async () => { await fixture?.cleanup(); });
  async function save(question: Record<string, unknown>) {
    const activeFrom = new Date(Date.now() - 60_000).toISOString();
    const activeUntil = new Date(Date.now() + 3_600_000).toISOString();
    const activity = await operations.saveActivityDraft({ key: `qr.hook${drafts++}`, kind: 'qr', category: 'social', outcomeKey: 'completion', evidenceMode: 'single_code', perUserClaimLimit: 1, maxClaims: 100, activeFrom, activeUntil, enabled: true, reason: 'Synthetic fixture', operationId: randomUUID() }, { id: actor, role: 'admin' });
    return fixture.pb.collection(Q.definitions).create({
      activity: activity.id, version: randomUUID(), operation_id: randomUUID(), input_hash: 'synthetic', updated_by: actor, reason: 'Synthetic questions',
      definition: { policy: 'all_answered', questions: [question] },
    });
  }
  const rejected = (message: string) => ({ status: 400, response: { message } });

  it.each([['Bad Id'], [undefined], [['word']]])('rejects question id %j as an invalid question', async (id) => {
    await expect(save({ ...text, id })).rejects.toMatchObject(rejected('Invalid question.'));
  });
  it.each([['Bad Id'], [undefined], [['odd']]])('rejects choice id %j as an invalid choice', async (id) => {
    await expect(save({ ...choice, choices: [{ id, label: 'Odd' }, ...choices] })).rejects.toMatchObject(rejected('Invalid choice.'));
  });
  it('accepts string question and choice ids', async () => {
    await expect(save({ ...choice, choices })).resolves.toMatchObject({ definition: { questions: [{ id: 'pick', choices }] } });
  });
});
